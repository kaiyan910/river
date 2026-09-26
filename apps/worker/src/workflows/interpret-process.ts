import {
  type InterpretProcessInput,
  RESUBMITTED_SIGNAL,
  type ResubmittedSignal,
  TASK_COMPLETED_SIGNAL,
  type TaskCompletedSignal,
  WITHDRAW_SIGNAL,
} from '@river/contracts/workflow';
import type { Assignee, ProcessNode } from '@river/dsl';
import {
  ApplicationFailure,
  condition,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
  uuid4,
} from '@temporalio/workflow';
import type { Activities, CreateTaskInput } from '../activities.js';

const { loadProcessVersion, createTask, evaluateCondition, evaluateAutoApproval, completeRequest } =
  proxyActivities<Activities>({
    startToCloseTimeout: '30 seconds',
  });

export const taskCompletedSignal = defineSignal<[TaskCompletedSignal]>(TASK_COMPLETED_SIGNAL);
export const resubmittedSignal = defineSignal<[ResubmittedSignal]>(RESUBMITTED_SIGNAL);
export const withdrawSignal = defineSignal(WITHDRAW_SIGNAL);

/**
 * 通用的 interpreter：讀取 Process Version 的 DSL，從「開始」沿著連線走到「結束」。
 * 審批與填表節點建立 Task，等到 API 送來這個 Task 的 taskCompleted Signal 才往下走。
 * 填表的資料由 API 存進 Postgres，workflow 只知道 Task 完成了。
 * 條件節點交給 evaluateCondition activity 讀取資料、執行 JSONata，workflow 只拿到選中的出邊 ID。
 * 設定了 Auto-approval 的審批節點先交給 evaluateAutoApproval：成立時不建立 Task，直接往下走；
 * 不成立或無法判斷時照常建立 Task。重新送出後從頭再跑一次，所以每一輪都重新判斷。
 * 並行分支（parallelSplit）的各條分支同時走，每一條都走到配對的 parallelJoin 後才繼續（見 walk）。
 *
 * Return、重新送出與 Withdraw 的狀態變化都由 API 在同一個 transaction 寫進 Postgres，workflow 只負責流轉：
 * - Task 被 Return：停下來，等發起人重新送出或 Withdraw；並行的其他分支也一起停下來。
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

  // createTask 發現 Request 已經不是 running：在哪裡發現的（見 walk 裡 createTask 之後的說明）。
  let notRunning: 'outsideBranch' | 'inBranch' | null = null;
  const stopped = () => notRunning !== null || interrupted();
  // 這一輪每個節點走到第幾次；evaluateCondition 與 evaluateAutoApproval 重試時用來找回當時的結果。
  const visits = new Map<string, number>();
  const visit = (nodeId: string) => {
    const count = (visits.get(nodeId) ?? 0) + 1;
    visits.set(nodeId, count);
    return count;
  };

  const dsl = await loadProcessVersion(processVersionId);
  const byId = new Map(dsl.nodes.map((n) => [n.id, n]));
  const next = (node: ProcessNode, edgeId?: string) => {
    const edge = dsl.edges.find((e) =>
      edgeId === undefined ? e.source === node.id : e.id === edgeId,
    );
    return edge && byId.get(edge.target);
  };

  /**
   * 從 node 沿著連線走，直到「結束」或第一個遇到的 parallelJoin（回傳它），或 Request 停下來（回傳 undefined）。
   * parallelSplit 的每一條出邊各自同時走一次，每一條都走到匯合點後才從匯合點往下走；
   * 內層的並行分支在遞迴裡整段走完，所以一條分支第一個遇到的 join 一定是自己的（發佈前檢查已經確認配對）。
   * 任一分支被 Return 時，API 把其他分支的 Task 作廢，那些分支和被 Return 的分支一樣等到重新送出或 Withdraw。
   * 沒有並行分支的流程走的路線與呼叫的 activity 和原本完全一樣。
   */
  const walk = async (
    from: ProcessNode | undefined,
    inBranch = false,
  ): Promise<ProcessNode | undefined> => {
    let node = from;
    while (node && node.type !== 'end' && node.type !== 'parallelJoin' && !stopped()) {
      // 並行分支是新的節點類型，舊的 history 裡不會出現，所以不需要 patched()。
      if (node.type === 'parallelSplit') {
        const branches = dsl.edges.filter((e) => e.source === node?.id);
        const joins = await Promise.all(branches.map((e) => walk(byId.get(e.target), true)));
        if (stopped()) return undefined;
        const [join] = joins;
        if (!join || joins.some((j) => j !== join))
          throw ApplicationFailure.nonRetryable(
            `並行分支「${node.name}」的分支沒有回到同一個匯合點`,
          );
        node = next(join);
        continue;
      }
      // 條件節點是新的節點類型，舊的 history 裡不會出現，所以不需要 patched()。
      if (node.type === 'condition') {
        const edgeId = await evaluateCondition({
          requestId,
          processVersionId,
          nodeId: node.id,
          visit: visit(node.id),
        });
        if (!stopped()) node = next(node, edgeId);
        continue;
      }
      // 審批節點的 autoApprove 是新的設定，舊的 history 裡不會出現；沒有設定的節點不會多呼叫 activity，
      // 行為和原本完全一樣，所以不需要 patched()。
      if (node.type === 'approval' && node.autoApprove) {
        const approved = await evaluateAutoApproval({
          requestId,
          processVersionId,
          nodeId: node.id,
          visit: visit(node.id),
        });
        if (approved) {
          if (!stopped()) node = next(node);
          continue;
        }
      }
      if (node.type === 'approval' || node.type === 'form') {
        // 發佈前檢查（APPROVAL_NO_ASSIGNEE、FORM_NODE_NO_ASSIGNEE）已經擋下；
        // 萬一出現，寧可讓 workflow 失敗也不要跳過這一步。
        // 指派給 Manager 卻沒有 Fallback Role（MANAGER_NO_FALLBACK_ROLE）也一樣。
        const assignment = node.assignee && assignmentOf(node.assignee);
        if (!assignment)
          throw ApplicationFailure.nonRetryable(`節點「${node.name}」沒有指派處理人`);
        const taskId = uuid4();
        const created = await createTask({
          requestId,
          taskId,
          nodeId: node.id,
          nodeName: node.name,
          kind: node.type,
          ...assignment,
        });
        // Request 已經不是 running：沒有 Task 可等。
        // - 不在並行分支上：被 Withdraw 但 Signal 沒送到，workflow 直接結束（和原本一樣）。
        // - 並行分支上：也可能是另一條分支剛被 Return，那條分支會等到重新送出或 Withdraw；
        //   其他分支上等待中的 Task 都已經作廢，一起停下來，免得 Withdraw 的 Signal 沒送到時永遠等下去。
        // 舊版 activity 沒有回傳值（undefined），所以只認 false，重播舊 history 時行為不變。
        if (created === false) {
          notRunning = inBranch ? 'inBranch' : 'outsideBranch';
          return undefined;
        }
        await condition(() => outcomes.has(taskId) || stopped());
        if (outcomes.get(taskId) === 'returned') await condition(interrupted);
      }
      if (!stopped()) node = next(node);
    }
    return node?.type === 'parallelJoin' && !stopped() ? node : undefined;
  };

  const last = await walk(dsl.nodes.find((n) => n.type === 'start'));
  if (notRunning === 'outsideBranch') return;
  // 發佈前檢查（PARALLEL_JOIN_UNMATCHED）已經擋下；萬一出現，寧可讓 workflow 失敗也不要當作已完成。
  if (last) throw ApplicationFailure.nonRetryable(`並行匯合「${last.name}」沒有對應的並行分支`);

  if (withdrawn) return;
  if (latestRound > round)
    return continueAsNew<typeof interpretProcess>({
      requestId,
      processVersionId,
      round: latestRound,
    });
  if (notRunning) return;
  await completeRequest(requestId);
}

/**
 * 節點的指派對象轉成 createTask 的參數；指派給 Manager 卻沒有 Fallback Role 時為 null。
 * 指派給 Participant 或 Role 時參數與舊版相同；指派給 Manager 是新的節點設定，
 * 舊的 history 裡不會出現，所以不需要 patched()。
 */
function assignmentOf(
  assignee: Assignee,
): Pick<CreateTaskInput, 'assigneeId' | 'roleId' | 'initiatorManager'> | null {
  switch (assignee.type) {
    case 'participant':
      return { assigneeId: assignee.participantId };
    case 'role':
      return { roleId: assignee.roleId };
    case 'manager':
      return assignee.fallbackRoleId
        ? { initiatorManager: { fallbackRoleId: assignee.fallbackRoleId } }
        : null;
  }
}
