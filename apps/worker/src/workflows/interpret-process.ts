import {
  type InterpretProcessInput,
  RESUBMITTED_SIGNAL,
  type ResubmittedSignal,
  TASK_COMPLETED_SIGNAL,
  type TaskCompletedSignal,
  WITHDRAW_SIGNAL,
} from '@river/contracts/workflow';
import type { ProcessNode } from '@river/dsl';
import {
  ApplicationFailure,
  condition,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
  uuid4,
} from '@temporalio/workflow';
import type { Activities } from '../activities.js';

const { loadProcessVersion, createTask, completeRequest } = proxyActivities<Activities>({
  startToCloseTimeout: '30 seconds',
});

export const taskCompletedSignal = defineSignal<[TaskCompletedSignal]>(TASK_COMPLETED_SIGNAL);
export const resubmittedSignal = defineSignal<[ResubmittedSignal]>(RESUBMITTED_SIGNAL);
export const withdrawSignal = defineSignal(WITHDRAW_SIGNAL);

/**
 * 通用的 interpreter：讀取 Process Version 的 DSL，從「開始」沿著連線走到「結束」。
 * 審批與填表節點建立 Task，等到 API 送來這個 Task 的 taskCompleted Signal 才往下走。
 * 填表的資料由 API 存進 Postgres，workflow 只知道 Task 完成了。
 *
 * Return、重新送出與 Withdraw 的狀態變化都由 API 在同一個 transaction 寫進 Postgres，workflow 只負責流轉：
 * - Task 被 Return：停下來，等發起人重新送出或 Withdraw。
 * - 重新送出：以 continueAsNew 帶著新的輪次從「開始」重新執行，history 不會隨 Return 次數變大。
 * - Withdraw：直接結束。
 *
 * Signal 冪等：只記錄完成過的 taskId，workflow 只等「目前這個」Task，
 * 所以重複的 Signal、或早就處理過的 Task 的 Signal 都不會有任何影響；
 * resubmitted 只在輪次比目前新時才重新開始，withdraw 重複送出也一樣結束。
 */
export async function interpretProcess({
  requestId,
  processVersionId,
  round = 1,
}: InterpretProcessInput): Promise<void> {
  const outcomes = new Map<string, TaskCompletedSignal['outcome']>();
  let latestRound = round;
  let withdrawn = false;
  setHandler(taskCompletedSignal, ({ taskId, outcome }) => {
    if (!outcomes.has(taskId)) outcomes.set(taskId, outcome);
  });
  setHandler(resubmittedSignal, (signal) => {
    latestRound = Math.max(latestRound, signal.round);
  });
  setHandler(withdrawSignal, () => {
    withdrawn = true;
  });
  // 萬一 Return 的 Signal 沒送到，收到重新送出一樣從頭開始。
  const interrupted = () => withdrawn || latestRound > round;

  const dsl = await loadProcessVersion(processVersionId);
  const byId = new Map(dsl.nodes.map((n) => [n.id, n]));
  const next = (node: ProcessNode) => {
    const edge = dsl.edges.find((e) => e.source === node.id);
    return edge && byId.get(edge.target);
  };

  let node: ProcessNode | undefined = dsl.nodes.find((n) => n.type === 'start');
  while (node && node.type !== 'end' && !interrupted()) {
    if (node.type === 'approval' || node.type === 'form') {
      // 發佈前檢查（APPROVAL_NO_ASSIGNEE、FORM_NODE_NO_ASSIGNEE）已經擋下；
      // 萬一出現，寧可讓 workflow 失敗也不要跳過這一步。
      if (!node.assignee)
        throw ApplicationFailure.nonRetryable(`節點「${node.name}」沒有指派處理人`);
      const taskId = uuid4();
      const created = await createTask({
        requestId,
        taskId,
        nodeId: node.id,
        nodeName: node.name,
        kind: node.type,
        ...(node.assignee.type === 'participant'
          ? { assigneeId: node.assignee.participantId }
          : { roleId: node.assignee.roleId }),
      });
      // Request 已經不是 running（被 Withdraw 但 Signal 沒送到）：沒有 Task 可等，直接結束。
      // 舊版 activity 沒有回傳值（undefined），所以只認 false，重播舊 history 時行為不變。
      if (created === false) return;
      await condition(() => outcomes.has(taskId) || interrupted());
      if (outcomes.get(taskId) === 'returned') await condition(interrupted);
    }
    if (!interrupted()) node = next(node);
  }

  if (withdrawn) return;
  if (latestRound > round)
    return continueAsNew<typeof interpretProcess>({
      requestId,
      processVersionId,
      round: latestRound,
    });
  await completeRequest(requestId);
}
