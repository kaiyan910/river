import {
  CANCEL_SIGNAL,
  type InterpretProcessInput,
  REASSIGN_SIGNAL,
  RESUBMITTED_SIGNAL,
  RETRY_SIGNAL,
  type ReassignSignal,
  type ResubmittedSignal,
  type RetrySignal,
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
  log,
  patched,
  proxyActivities,
  setHandler,
  uuid4,
} from '@temporalio/workflow';
import type { Activities, CreateTaskInput, EscalationTo, NotifyInput } from '../activities.js';

const {
  loadProcessVersion,
  createTask,
  evaluateCondition,
  evaluateAutoApproval,
  escalateTask,
  completeRequest,
  pauseForHttp,
} = proxyActivities<Activities>({
  startToCloseTimeout: '30 seconds',
});

/**
 * HTTP 節點：外部系統暫時故障時退避重試幾次；全部失敗（或遇到不可重試的錯誤）就暫停 Request，
 * 等 Administrator 重試或 Cancel（見 walk 裡的 HTTP 節點）。單次呼叫的時限是 20 秒（HTTP_TIMEOUT_MS）。
 */
const http = proxyActivities<Activities>({
  startToCloseTimeout: '1 minute',
  retry: { initialInterval: '5 seconds', backoffCoefficient: 2, maximumAttempts: 4 },
});

/**
 * 寄信：寄信服務故障時重試幾次就放棄，不讓 Request 卡住；通知與 Email 節點都是盡力而為。
 * 重試由 activity 冪等處理，最壞的情況是重複寄出。
 */
const bestEffortMail = proxyActivities<Activities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 5 },
});

/**
 * 新 Task、Return 與完成時寄通知，是在既有的流轉中間多呼叫 activity：
 * 以 patched() 保護，這個版本之前開始的 workflow 重播時照舊不寄。
 */
const NOTIFICATIONS_PATCH = 'email-notifications';

async function notify(input: NotifyInput): Promise<void> {
  if (!patched(NOTIFICATIONS_PATCH)) return;
  try {
    await bestEffortMail.notify(input);
  } catch (error) {
    log.warn('通知寄送失敗，略過', { requestId: input.requestId, event: input.event, error });
  }
}

/**
 * 人工節點的 Reminder 與 Escalation 在等待 Task 時多了 durable timer 與 activity：
 * 以 patched() 保護，這個版本之前開始的 workflow 重播時照舊只等 Task 完成。
 */
const TIMEOUTS_PATCH = 'reminder-escalation';

const HOUR = 60 * 60 * 1000;

export const taskCompletedSignal = defineSignal<[TaskCompletedSignal]>(TASK_COMPLETED_SIGNAL);
export const resubmittedSignal = defineSignal<[ResubmittedSignal]>(RESUBMITTED_SIGNAL);
export const withdrawSignal = defineSignal(WITHDRAW_SIGNAL);
export const cancelSignal = defineSignal(CANCEL_SIGNAL);
export const reassignSignal = defineSignal<[ReassignSignal]>(REASSIGN_SIGNAL);
export const retrySignal = defineSignal<[RetrySignal]>(RETRY_SIGNAL);

/**
 * 通用的 interpreter：讀取 Process Version 的 DSL，從「開始」沿著連線走到「結束」。
 * 審批與填表節點建立 Task，等到 API 送來這個 Task 的 taskCompleted Signal 才往下走。
 * 填表的資料由 API 存進 Postgres，workflow 只知道 Task 完成了。
 * 條件節點交給 evaluateCondition activity 讀取資料、執行 JSONata，workflow 只拿到選中的出邊 ID。
 * 設定了 Auto-approval 的審批節點先交給 evaluateAutoApproval：成立時不建立 Task，直接往下走；
 * 不成立或無法判斷時照常建立 Task。重新送出後從頭再跑一次，所以每一輪都重新判斷。
 * 並行分支（parallelSplit）的各條分支同時走，每一條都走到配對的 parallelJoin 後才繼續（見 walk）。
 * Email 節點交給 sendEmail activity 寄出後直接往下走。
 * HTTP 節點交給 httpRequest activity（帶重試）呼叫外部系統後往下走；Form 資料與 Credential 都只在 activity 裡讀取。
 * 重試全部失敗時由 pauseForHttp 記錄暫停並通知 Administrator，等到 retry Signal 再呼叫一次，或 Request 被 Cancel。
 * 新 Task 寄信給處理人，Return 與完成寄信給發起人（見 notify）；信件只有 Request 標題、Process 名稱與連結。
 * 人工節點設定了 Reminder 或 Escalation 時，等待 Task 期間用 durable timer 計時（見 waitForTask）：
 * Reminder 寄信提醒目前的處理人；Escalation 把 Task 轉給新的處理人，之後改等新的 Task。Task 完成時 timer 一併取消。
 *
 * Return、重新送出、Withdraw、Cancel 與 Reassign 的狀態變化都由 API 在同一個 transaction 寫進 Postgres，
 * workflow 只負責流轉：
 * - Task 被 Return：停下來，等發起人重新送出、Withdraw 或 Cancel；並行的其他分支也一起停下來。
 * - 重新送出：以 continueAsNew 帶著新的輪次從「開始」重新執行，history 不會隨 Return 次數變大。
 * - Withdraw、Cancel：直接結束。
 * - Reassign：原 Task 已經作廢，改等接手的新 Task，並通知新的處理人。
 *
 * Signal 冪等：只記錄完成過的 taskId，workflow 只等「目前這個」Task，
 * 所以重複的 Signal、或早就處理過的 Task 的 Signal 都不會有任何影響；
 * resubmitted 只在輪次比目前新時才重新開始，withdraw、cancel 重複送出也一樣結束；
 * reassign 只記下「誰由誰接手」，重複送出記下的是同一件事。
 *
 * retry 只在 sequence 比暫停時已經重試過的次數大時才重試，重複送出沒有影響。
 *
 * Cancel 與 Reassign 是新的 Signal，舊的 history 裡不會出現：沒有收到時條件判斷、timer 與呼叫的 activity
 * 和原本完全一樣；收到 reassign 之後才有的新指令（通知新的處理人、重新計時）只會出現在新的 history 裡，
 * 所以不需要 patched()。
 */
export async function interpretProcess({
  requestId,
  processVersionId,
  round = 1,
}: InterpretProcessInput): Promise<void> {
  const outcomes = new Map<string, TaskCompletedSignal['outcome']>();
  let latestRound = round;
  let withdrawn = false;
  let cancelled = false;
  // Reassign：作廢的 taskId → 接手的新 taskId。
  const reassigned = new Map<string, string>();
  // Administrator 重試暫停的 HTTP 節點：收到過最大的 sequence。
  let latestRetry = 0;
  setHandler(taskCompletedSignal, ({ taskId, outcome }) => {
    if (!outcomes.has(taskId)) outcomes.set(taskId, outcome);
  });
  setHandler(resubmittedSignal, (signal) => {
    latestRound = Math.max(latestRound, signal.round);
  });
  setHandler(withdrawSignal, () => {
    withdrawn = true;
  });
  setHandler(cancelSignal, () => {
    cancelled = true;
  });
  setHandler(reassignSignal, ({ taskId, newTaskId }) => {
    if (!reassigned.has(taskId)) reassigned.set(taskId, newTaskId);
  });
  setHandler(retrySignal, ({ sequence }) => {
    latestRetry = Math.max(latestRetry, sequence);
  });
  const ended = () => withdrawn || cancelled;
  // 萬一 Return 的 Signal 沒送到，收到重新送出一樣從頭開始。
  const interrupted = () => ended() || latestRound > round;

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
      // Email 節點是新的節點類型，舊的 history 裡不會出現，所以不需要 patched()。
      // 寄不出去時不讓 Request 卡住，照樣往下走。
      if (node.type === 'email') {
        try {
          await bestEffortMail.sendEmail({
            requestId,
            processVersionId,
            nodeId: node.id,
            visit: visit(node.id),
          });
        } catch (error) {
          log.warn('Email 節點寄送失敗，略過', { requestId, nodeId: node.id, error });
        }
        if (!stopped()) node = next(node);
        continue;
      }
      // HTTP 節點是新的節點類型、retry 是新的 Signal，舊的 history 裡不會出現，所以不需要 patched()。
      // 重試全部失敗時暫停：pauseForHttp 回傳暫停當下已經重試過幾次，等到比它新的 retry Signal 再呼叫一次；
      // 同一次走到這一步用同一個 visit，所以成功過就不會重複送出。Request 停下來（Cancel、Withdraw、Return）時不再等。
      if (node.type === 'http') {
        const nodeId = node.id;
        const count = visit(nodeId);
        for (;;) {
          try {
            await http.httpRequest({ requestId, processVersionId, nodeId, visit: count });
            break;
          } catch (error) {
            if (stopped()) break;
            const retries = await pauseForHttp({ requestId, nodeId, reason: failureReason(error) });
            await condition(() => latestRetry > retries || stopped());
            if (stopped()) break;
          }
        }
        if (!stopped()) node = next(node);
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
        await notify({ requestId, event: 'taskCreated', taskId });
        const handled = await waitForTask(node, taskId);
        if (outcomes.get(handled) === 'returned') {
          await notify({ requestId, event: 'returned' });
          await condition(interrupted);
        }
      }
      if (!stopped()) node = next(node);
    }
    return node?.type === 'parallelJoin' && !stopped() ? node : undefined;
  };

  /**
   * 等 Task 完成（或 Request 停下來），回傳最後等的 Task ID（Escalation 後是新的 Task）。
   * 沒有逾時設定的節點和原本一樣只等 Task 完成。
   * 有設定時從 Task 建立起計時：
   * - Reminder：afterHours 小時後寄信給目前的處理人；repeat 時每隔 afterHours 小時再寄一次。
   * - Escalation：afterHours 小時後交給 escalateTask 轉給新的處理人，只轉一次；轉交後 Reminder 為新的處理人重新計時。
   *   Task 剛好被處理、或 Request 已經停下來時 escalateTask 不轉交，繼續等原本的 Task。
   * Task 完成時 condition 直接返回，還沒到期的 timer 不會再觸發。
   */
  const waitForTask = async (
    node: Extract<ProcessNode, { type: 'approval' | 'form' }>,
    firstTaskId: string,
  ): Promise<string> => {
    let taskId = firstTaskId;
    const done = () => outcomes.has(taskId) || stopped();
    // 目前的 Task 被 Reassign：改等接手的 Task，並通知新的處理人。
    const reassignedTo = () => (done() ? undefined : reassigned.get(taskId));
    const doneOrMoved = () => done() || reassignedTo() !== undefined;
    const followReassign = async (): Promise<boolean> => {
      const replacement = reassignedTo();
      if (replacement === undefined) return false;
      taskId = replacement;
      await notify({ requestId, event: 'taskCreated', taskId });
      return true;
    };
    const { reminder } = node;
    const escalateTo = escalationOf(node);
    if ((!reminder && !escalateTo) || !patched(TIMEOUTS_PATCH)) {
      do await condition(doneOrMoved);
      while (await followReassign());
      return taskId;
    }
    const reminderEvery = reminder && reminder.afterHours > 0 ? reminder.afterHours * HOUR : null;
    let remindAt = reminderEvery ? Date.now() + reminderEvery : Infinity;
    let reminders = 0;
    const escalateEvery = escalateTo ? escalateTo.afterHours * HOUR : Infinity;
    let escalateAt = Date.now() + escalateEvery;

    while (!done()) {
      const dueAt = Math.min(remindAt, escalateAt);
      let timedOut = false;
      if (dueAt === Infinity) await condition(doneOrMoved);
      else timedOut = !(await condition(doneOrMoved, Math.max(dueAt - Date.now(), 1)));
      // Reassign 後 timer 跟著新的 Task 重新計時：Reminder 寄給新的處理人；還沒 Escalation 的話，時限也重新起算。
      if (await followReassign()) {
        reminders = 0;
        remindAt = reminderEvery ? Date.now() + reminderEvery : Infinity;
        if (escalateAt !== Infinity) escalateAt = Date.now() + escalateEvery;
        continue;
      }
      if (!timedOut) break;

      if (escalateTo && Date.now() >= escalateAt) {
        escalateAt = Infinity;
        const newTaskId = uuid4();
        const result = await escalateTask({ requestId, taskId, newTaskId, to: escalateTo.to });
        if (result === 'escalated') {
          taskId = newTaskId;
          reminders = 0;
          remindAt = reminderEvery ? Date.now() + reminderEvery : Infinity;
          await notify({ requestId, event: 'taskEscalated', taskId });
          continue;
        }
      }
      if (reminderEvery && Date.now() >= remindAt) {
        reminders += 1;
        remindAt = reminder?.repeat ? remindAt + reminderEvery : Infinity;
        try {
          await bestEffortMail.sendReminder({ requestId, taskId, sequence: reminders });
        } catch (error) {
          log.warn('Reminder 寄送失敗，略過', { requestId, taskId, error });
        }
      }
    }
    return taskId;
  };

  const last = await walk(dsl.nodes.find((n) => n.type === 'start'));
  if (notRunning === 'outsideBranch') return;
  // 發佈前檢查（PARALLEL_JOIN_UNMATCHED）已經擋下；萬一出現，寧可讓 workflow 失敗也不要當作已完成。
  if (last) throw ApplicationFailure.nonRetryable(`並行匯合「${last.name}」沒有對應的並行分支`);

  if (ended()) return;
  if (latestRound > round)
    return continueAsNew<typeof interpretProcess>({
      requestId,
      processVersionId,
      round: latestRound,
    });
  if (notRunning) return;
  await completeRequest(requestId);
  await notify({ requestId, event: 'completed' });
}

/**
 * 節點的 Escalation 設定轉成時限與 escalateTask 的對象；沒有設定、時數不合理或缺少必要設定時為 null（不轉交）。
 * 發佈前檢查（TIMEOUT_INVALID_HOURS、ESCALATION_NO_TARGET、ESCALATION_NO_FALLBACK_ROLE）已經擋下，
 * Escalation 失敗只會讓 Task 留在原處理人手上，所以不讓 workflow 失敗。
 */
function escalationOf(
  node: Extract<ProcessNode, { type: 'approval' | 'form' }>,
): { afterHours: number; to: EscalationTo } | null {
  const { escalation, assignee } = node;
  if (!escalation || !assignee || !(escalation.afterHours > 0)) return null;
  const { afterHours, target, fallbackRoleId } = escalation;
  switch (assignee.type) {
    case 'role':
      if (!target) return null;
      return {
        afterHours,
        to:
          target.type === 'participant'
            ? { assigneeId: target.participantId }
            : { roleId: target.roleId },
      };
    case 'participant':
      return fallbackRoleId ? { afterHours, to: { handlerManager: { fallbackRoleId } } } : null;
    case 'manager':
      return assignee.fallbackRoleId
        ? { afterHours, to: { handlerManager: { fallbackRoleId: assignee.fallbackRoleId } } }
        : null;
  }
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

/** activity 失敗的原因：httpRequest 丟出的訊息只有狀態碼或錯誤代碼（見 activities.ts），不含秘密。 */
function failureReason(error: unknown): string {
  let current = error as { message?: unknown; cause?: unknown } | undefined;
  // ActivityFailure 的 cause 才是 activity 丟出的 ApplicationFailure。
  while (current?.cause) current = current.cause as typeof current;
  return typeof current?.message === 'string' && current.message
    ? current.message
    : '外部系統呼叫失敗';
}
