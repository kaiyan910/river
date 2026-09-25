import {
  type InterpretProcessInput,
  TASK_COMPLETED_SIGNAL,
  type TaskCompletedSignal,
} from '@river/contracts/workflow';
import type { ProcessNode } from '@river/dsl';
import {
  ApplicationFailure,
  condition,
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

/**
 * 通用的 interpreter：讀取 Process Version 的 DSL，從「開始」沿著連線走到「結束」。
 * 審批與填表節點建立 Task，等到 API 送來這個 Task 的 taskCompleted Signal 才往下走。
 * 填表的資料由 API 存進 Postgres，workflow 只知道 Task 完成了。
 *
 * Signal 冪等：只記錄完成過的 taskId，workflow 只等「目前這個」Task，
 * 所以重複的 Signal、或早就處理過的 Task 的 Signal 都不會有任何影響。
 */
export async function interpretProcess({
  requestId,
  processVersionId,
}: InterpretProcessInput): Promise<void> {
  const completed = new Set<string>();
  setHandler(taskCompletedSignal, ({ taskId }) => {
    completed.add(taskId);
  });

  const dsl = await loadProcessVersion(processVersionId);
  const byId = new Map(dsl.nodes.map((n) => [n.id, n]));
  const next = (node: ProcessNode) => {
    const edge = dsl.edges.find((e) => e.source === node.id);
    return edge && byId.get(edge.target);
  };

  let node: ProcessNode | undefined = dsl.nodes.find((n) => n.type === 'start');
  while (node && node.type !== 'end') {
    if (node.type === 'approval' || node.type === 'form') {
      // 發佈前檢查（APPROVAL_NO_ASSIGNEE、FORM_NODE_NO_ASSIGNEE）已經擋下；
      // 萬一出現，寧可讓 workflow 失敗也不要跳過這一步。
      if (!node.assignee)
        throw ApplicationFailure.nonRetryable(`節點「${node.name}」沒有指派處理人`);
      const taskId = uuid4();
      await createTask({
        requestId,
        taskId,
        nodeId: node.id,
        nodeName: node.name,
        kind: node.type,
        assigneeId: node.assignee.participantId,
      });
      await condition(() => completed.has(taskId));
    }
    node = next(node);
  }
  await completeRequest(requestId);
}
