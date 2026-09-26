import {
  authUsers,
  type Database,
  type FallbackReason,
  participants,
  processVersions,
  type RequestEventType,
  requestData,
  requestEvents,
  requests,
  type TaskKind,
  tasks,
} from '@river/db';
import { fillEmailTemplate, type ProcessDsl } from '@river/dsl';
import { chooseBranch, shouldAutoApprove } from '@river/dsl/branch';
import { ApplicationFailure, log } from '@temporalio/activity';
import { and, asc, count, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  activeEmails,
  emailRecipients,
  type NotificationDeps,
  requestSummary,
  requestUrl,
  roleMemberEmails,
  sendPendingReassign,
  sendToEach,
  taskUrl,
} from './notifications.js';

export interface CreateTaskInput {
  requestId: string;
  /** 由 workflow 產生；activity 重試時用同一個 ID，Task 與事件都不會重複。 */
  taskId: string;
  nodeId: string;
  nodeName: string;
  kind: TaskKind;
  /**
   * 指派對象剛好有一個：特定 Participant、Role，或發起人的 Manager（找不到有效的 Manager 時改派給 Fallback Role）。
   * 欄位名稱沿用舊版，執行中的 activity 重試時仍然相容。
   */
  assigneeId?: string;
  roleId?: string;
  initiatorManager?: { fallbackRoleId: string };
}

export interface EvaluateConditionInput {
  requestId: string;
  processVersionId: string;
  /** 條件節點的 ID。 */
  nodeId: string;
  /** 這一輪第幾次走到這個節點（從 1 開始），重試時用來找回當時的結果；舊的 workflow 沒有這個欄位。 */
  visit?: number;
}

export interface EvaluateAutoApprovalInput {
  requestId: string;
  processVersionId: string;
  /** 設定了 Auto-approval 的審批節點的 ID。 */
  nodeId: string;
  /** 同 EvaluateConditionInput.visit。 */
  visit?: number;
}

/**
 * Request 的通知：新 Task 寄給處理人（指派給 Role 時寄給每一位成員），Return 與完成寄給發起人。
 * 只帶 ID；信件內容由 activity 從 Postgres 讀取，只包含 Request 標題、Process 名稱與連結。
 */
export type NotifyInput =
  | { requestId: string; event: 'taskCreated' | 'taskEscalated'; taskId: string }
  | { requestId: string; event: 'returned' | 'completed' };

export interface SendReminderInput {
  requestId: string;
  taskId: string;
  /** 這個 Task 的第幾次 Reminder（從 1 開始）；重試時用來判斷是否已經寄過。 */
  sequence: number;
}

/**
 * Escalation 的對象，由 workflow 依節點設定決定：
 * - 指派給 Role 的節點：Designer 指定的特定人（assigneeId）或 Role（roleId）；
 * - 指派給特定人或 Manager 的節點：目前處理人的 Manager，找不到有效的 Manager 時轉給 Fallback Role。
 */
export type EscalationTo =
  | { assigneeId: string }
  | { roleId: string }
  | { handlerManager: { fallbackRoleId: string } };

export interface EscalateTaskInput {
  requestId: string;
  /** 逾時的 Task。 */
  taskId: string;
  /** 由 workflow 產生的新 Task ID；activity 重試時用同一個 ID，Task 與事件都不會重複。 */
  newTaskId: string;
  to: EscalationTo;
}

/**
 * escalated：原 Task 已作廢，新的 Task 已建立；skipped：沒有轉交（Task 已經處理、Request 已經不是 running，
 * 或找不到和目前不同的處理人），workflow 繼續等原本的 Task。
 */
export type EscalateTaskResult = 'escalated' | 'skipped';

export interface SendEmailInput {
  requestId: string;
  processVersionId: string;
  /** Email 節點的 ID。 */
  nodeId: string;
  /** 同 EvaluateConditionInput.visit。 */
  visit: number;
}

const managers = alias(participants, 'managers');

/** interpreter 需要的流程圖；不含 Form schema，Temporal history 裡只有節點與連線。 */
export type ProcessGraph = Omit<ProcessDsl, 'forms'>;

/**
 * 每個 activity 都要能安全重試：寫入 Task 與 request_events 在同一個 transaction，
 * 而且只有真的改變狀態時才寫事件。
 */
export function createActivities(db: Database, notification: NotificationDeps) {
  return {
    async checkDatabase(): Promise<void> {
      await db.execute(sql`select 1`);
    },

    /** Process Version 不可修改。只回傳節點與連線：回傳值會寫進 Temporal history，Form 一律不進去。 */
    async loadProcessVersion(processVersionId: string): Promise<ProcessGraph> {
      const [row] = await db
        .select({ dsl: processVersions.dsl })
        .from(processVersions)
        .where(eq(processVersions.id, processVersionId));
      if (!row) throw ApplicationFailure.nonRetryable(`找不到 Process Version ${processVersionId}`);
      return { nodes: row.dsl.nodes, edges: row.dsl.edges };
    },

    /**
     * 先鎖住 Request 再建立 Task（與 API 的 Return、Withdraw 同樣的鎖定順序）：
     * Request 已經不是 running（例如剛被 Withdraw）時不建立，免得留下沒人需要處理的 Task。
     * Task 記下 Request 目前的輪次。回傳 false 代表 Request 已經結束、沒有建立 Task。
     * 指派給發起人的 Manager 時，在建立 Task 的當下決定處理人，之後換 Manager 不影響已經建立的 Task。
     */
    async createTask(input: CreateTaskInput): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select({
            status: requests.status,
            round: requests.round,
            initiatorId: requests.initiatorId,
          })
          .from(requests)
          .where(eq(requests.id, input.requestId))
          .for('update');
        if (!request) throw new Error(`找不到 Request ${input.requestId}`);
        if (request.status !== 'running') return false;
        const assignment = input.initiatorManager
          ? await resolveManager(tx, request.initiatorId, input.initiatorManager.fallbackRoleId)
          : { assigneeId: input.assigneeId ?? null, roleId: input.roleId ?? null };
        const [created] = await tx
          .insert(tasks)
          .values({
            id: input.taskId,
            requestId: input.requestId,
            nodeId: input.nodeId,
            nodeName: input.nodeName,
            kind: input.kind,
            round: request.round,
            assigneeId: assignment.assigneeId,
            roleId: assignment.roleId,
          })
          .onConflictDoNothing({ target: tasks.id })
          .returning({ id: tasks.id });
        if (created)
          await tx.insert(requestEvents).values({
            requestId: input.requestId,
            type: 'task.created',
            taskId: input.taskId,
            fallbackReason: assignment.fallbackReason ?? null,
          });
        return true;
      });
    },

    /**
     * 從 Postgres 讀取條件節點的出邊與這一輪填過的 Form 資料，執行 JSONata，只回傳選中的出邊 ID：
     * Form 資料與表達式的結果都不進 Temporal history，表達式用到 $now() 也不影響 workflow 的 determinism。
     * Request 仍是 running 時寫入 step.branch_chosen 事件，畫面才畫得出實際走過的路徑。
     * 重試時以已經寫入的事件為準，不重新判斷（和 evaluateAutoApproval 相同的理由）。
     */
    async evaluateCondition(input: EvaluateConditionInput): Promise<string> {
      const chosen = await branchAlreadyChosen(db, input);
      if (chosen) return chosen;
      const { dsl, data } = await loadRound(db, input);
      const outgoing = dsl.edges.filter((e) => e.source === input.nodeId);
      // 只記錄出錯的出邊與 JSONata 的錯誤代碼，不記錄 Form 資料。
      const edgeId = await chooseBranch(outgoing, data, (id, error) =>
        log.warn('條件表達式執行失敗，視為不成立', {
          requestId: input.requestId,
          nodeId: input.nodeId,
          edgeId: id,
          code: jsonataErrorCode(error),
        }),
      );
      // 發佈前檢查（CONDITION_NO_DEFAULT）已經擋下；萬一出現，寧可讓 workflow 失敗也不要亂走。
      if (!edgeId) throw ApplicationFailure.nonRetryable(`條件節點 ${input.nodeId} 沒有預設出邊`);

      // Request 已經不是 running（例如剛被 Withdraw）時不寫事件；workflow 收到 Signal 後就會結束。
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select({ status: requests.status })
          .from(requests)
          .where(eq(requests.id, input.requestId))
          .for('update');
        if (request?.status !== 'running') return edgeId;
        const chosen = await branchAlreadyChosen(tx, input);
        if (chosen) return chosen;
        await tx.insert(requestEvents).values({
          requestId: input.requestId,
          type: 'step.branch_chosen',
          nodeId: input.nodeId,
          edgeId,
        });
        return edgeId;
      });
    },

    /**
     * 審批節點的 Auto-approval：和 evaluateCondition 一樣從 Postgres 讀取這一輪的資料並執行 JSONata，只回傳是否自動核准。
     * 成立時先鎖住 Request，仍是 running 才寫入 step.auto_approved 事件；不建立 Task，也不通知任何人。
     * 不成立、執行時出錯，或 Request 已經不是 running 都回傳 false，由 workflow 照常建立 Task（往安全的方向失敗；
     * Request 已經結束時 createTask 不會建立）。
     * 重試時以已經寫入的事件為準，不重新判斷（表達式用到 $now() 時結果可能不同）：
     * 這一輪第 visit 次走到這一步的結果已經記錄下來，就表示上一次已經寫入（見 earlierVisit）。
     */
    async evaluateAutoApproval(input: EvaluateAutoApprovalInput): Promise<boolean> {
      if (await alreadyAutoApproved(db, input)) return true;
      const { dsl, data } = await loadRound(db, input);
      const node = dsl.nodes.find((n) => n.id === input.nodeId);
      const expression = node?.type === 'approval' ? node.autoApprove?.expression : undefined;
      if (!expression?.trim()) return false;
      // 只記錄 JSONata 的錯誤代碼，不記錄 Form 資料。
      const approved = await shouldAutoApprove(expression, data, (error) =>
        log.warn('自動核准條件執行失敗，交給審批人', {
          requestId: input.requestId,
          nodeId: input.nodeId,
          code: jsonataErrorCode(error),
        }),
      );
      if (!approved) return false;

      return db.transaction(async (tx) => {
        const [request] = await tx
          .select({ status: requests.status })
          .from(requests)
          .where(eq(requests.id, input.requestId))
          .for('update');
        if (request?.status !== 'running') return false;
        if (await alreadyAutoApproved(tx, input)) return true;
        await tx.insert(requestEvents).values({
          requestId: input.requestId,
          type: 'step.auto_approved',
          nodeId: input.nodeId,
        });
        return true;
      });
    },

    /**
     * 寄出 Request 的通知。寄信失敗時由 Temporal 重試，所以可能重複寄出，但不會漏寄。
     * 寄出前確認事情仍然成立：Task 還沒處理（已經作廢或完成就不必再通知）、Request 仍是 returned 或真的完成了。
     * 停用的 Participant 收不到信；新 Task 直接指派給已停用的 Participant 時，這個 Task 進入「待 Reassign」清單，
     * 改寄信通知 Administrator。
     */
    async notify(input: NotifyInput): Promise<void> {
      const request = await requestSummary(db, input.requestId);
      if (!request) throw ApplicationFailure.nonRetryable(`找不到 Request ${input.requestId}`);
      const props = { requestTitle: request.title, processName: request.processName };

      if (input.event === 'taskCreated' || input.event === 'taskEscalated') {
        // 直接指派給已停用的 Participant：Task 進入「待 Reassign」清單，改寄信通知 Administrator。
        const deactivated = await deactivatedAssignee(db, input.taskId);
        if (deactivated) {
          await sendPendingReassign(db, notification, deactivated.name, [props]);
          return;
        }
        const to = await openTaskHandlerEmails(db, input.taskId);
        if (!to) return;
        await sendToEach(
          notification,
          to,
          { ...props, url: taskUrl(notification.appUrl, input.taskId) },
          { kind: input.event === 'taskCreated' ? 'taskCreated' : 'escalated' },
        );
        return;
      }

      // 重試時事情可能已經過去（例如發起人已經重新送出或 Withdraw），就不寄過時的信。
      const expected = input.event === 'completed' ? 'completed' : 'returned';
      if (request.status !== expected) return;
      await sendToEach(
        notification,
        await activeEmails(db, [request.initiatorId]),
        { ...props, url: requestUrl(notification.appUrl, input.requestId) },
        { kind: input.event },
      );
    },

    /**
     * Email 節點：依節點的收件對象與訊息範本寄信，範本只代入 Request 標題、Process 名稱與連結。
     * 寄出後，Request 仍是 running 才寫入 step.email_sent 事件；沒有任何收件人（例如發起人沒有 Manager）時不寫。
     * 重試時，這一輪第 visit 次走到這一步已經寫入事件就不再寄；寄出後、寫入前失敗的話會重複寄出，但不會漏寄。
     * Request 已經不是 running（例如剛被 Withdraw）時不寄。
     */
    async sendEmail(input: SendEmailInput): Promise<void> {
      if ((await earlierVisit(db, input))?.type === 'step.email_sent') return;
      const request = await requestSummary(db, input.requestId);
      if (!request) throw ApplicationFailure.nonRetryable(`找不到 Request ${input.requestId}`);
      if (request.status !== 'running') return;
      const [version] = await db
        .select({ dsl: processVersions.dsl })
        .from(processVersions)
        .where(eq(processVersions.id, input.processVersionId));
      const node = version?.dsl.nodes.find((n) => n.id === input.nodeId);
      // 發佈前檢查（EMAIL_NO_RECIPIENT）已經擋下；萬一出現，寧可讓 workflow 失敗也不要當作寄出了。
      if (node?.type !== 'email' || !node.recipient)
        throw ApplicationFailure.nonRetryable(`Email 節點 ${input.nodeId} 沒有設定收件對象`);

      const to = await emailRecipients(db, node.recipient, request.initiatorId);
      if (to.length === 0) {
        log.info('Email 節點沒有收件人，不寄出', {
          requestId: input.requestId,
          nodeId: input.nodeId,
        });
        return;
      }
      const props = {
        requestTitle: request.title,
        processName: request.processName,
        url: requestUrl(notification.appUrl, input.requestId),
      };
      const values = { ...props, link: props.url };
      await sendToEach(notification, to, props, {
        kind: 'custom',
        subject: fillEmailTemplate(node.subject, values),
        message: fillEmailTemplate(node.message, values),
      });

      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select({ status: requests.status })
          .from(requests)
          .where(eq(requests.id, input.requestId))
          .for('update');
        if (locked?.status !== 'running') return;
        if ((await earlierVisit(tx, input))?.type === 'step.email_sent') return;
        await tx.insert(requestEvents).values({
          requestId: input.requestId,
          type: 'step.email_sent',
          nodeId: input.nodeId,
        });
      });
    },

    /**
     * Reminder：寄信提醒 Task 目前的處理人（指派給 Role 時寄給每一位成員），不改變 Task 由誰負責。
     * 寄出後，Task 仍是 open 才寫入 task.reminded 事件。Task 已經處理或作廢、Request 已經不是 running 時不寄。
     * 重試時，這個 Task 已經有 sequence 筆 task.reminded 就不再寄；寄出後、寫入前失敗的話會重複寄出，但不會漏寄。
     */
    async sendReminder(input: SendReminderInput): Promise<void> {
      if ((await reminderCount(db, input.taskId)) >= input.sequence) return;
      const request = await requestSummary(db, input.requestId);
      if (!request) throw ApplicationFailure.nonRetryable(`找不到 Request ${input.requestId}`);
      if (request.status !== 'running') return;
      const to = await openTaskHandlerEmails(db, input.taskId);
      if (!to) return;
      await sendToEach(
        notification,
        to,
        {
          requestTitle: request.title,
          processName: request.processName,
          url: taskUrl(notification.appUrl, input.taskId),
        },
        { kind: 'reminder' },
      );

      await db.transaction(async (tx) => {
        const [task] = await tx
          .select({ status: tasks.status })
          .from(tasks)
          .where(eq(tasks.id, input.taskId))
          .for('update');
        if (task?.status !== 'open') return;
        if ((await reminderCount(tx, input.taskId)) >= input.sequence) return;
        await tx.insert(requestEvents).values({
          requestId: input.requestId,
          type: 'task.reminded',
          taskId: input.taskId,
        });
      });
    },

    /**
     * Escalation：原 Task 變成 superseded，為新的處理人建立 Task（同一個節點、同一輪，replacesTaskId 指向原 Task），
     * 寫入 task.escalated 事件。
     * 絕不會自動核准：只是換人處理。
     * 先鎖住 Request 再鎖住 Task（與 API 的 Return、Withdraw、完成 Task 同樣的順序）：
     * Request 已經不是 running、或 Task 已經不是 open（剛好有人處理了）時不轉交。
     * 新的處理人和目前相同（例如 Task 已經在 Fallback Role 手上）時也不轉交。
     * 重試時新的 Task 已經建立，就直接回傳 escalated。
     */
    async escalateTask(input: EscalateTaskInput): Promise<EscalateTaskResult> {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select({ status: requests.status })
          .from(requests)
          .where(eq(requests.id, input.requestId))
          .for('update');
        if (!request) throw new Error(`找不到 Request ${input.requestId}`);
        const [existing] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.id, input.newTaskId));
        if (existing) return 'escalated';
        if (request.status !== 'running') return 'skipped';
        const [task] = await tx
          .select()
          .from(tasks)
          .where(eq(tasks.id, input.taskId))
          .for('update');
        if (task?.status !== 'open') return 'skipped';

        const assignment: Assignment =
          'handlerManager' in input.to
            ? task.assigneeId
              ? await resolveManager(tx, task.assigneeId, input.to.handlerManager.fallbackRoleId)
              : // 處理人是 Role（例如已經改派給 Fallback Role），沒有 Manager 可以轉。
                {
                  assigneeId: null,
                  roleId: input.to.handlerManager.fallbackRoleId,
                  fallbackReason: 'no_manager',
                }
            : {
                assigneeId: 'assigneeId' in input.to ? input.to.assigneeId : null,
                roleId: 'roleId' in input.to ? input.to.roleId : null,
              };
        if (assignment.assigneeId === task.assigneeId && assignment.roleId === task.roleId) {
          log.info('Escalation 找不到和目前不同的處理人，不轉交', {
            requestId: input.requestId,
            taskId: input.taskId,
          });
          return 'skipped';
        }

        await tx
          .update(tasks)
          .set({ status: 'superseded', version: sql`${tasks.version} + 1` })
          .where(eq(tasks.id, task.id));
        await tx.insert(tasks).values({
          id: input.newTaskId,
          requestId: task.requestId,
          nodeId: task.nodeId,
          nodeName: task.nodeName,
          kind: task.kind,
          round: task.round,
          assigneeId: assignment.assigneeId,
          roleId: assignment.roleId,
          replacesTaskId: task.id,
        });
        await tx.insert(requestEvents).values({
          requestId: input.requestId,
          type: 'task.escalated',
          taskId: input.newTaskId,
          fallbackReason: assignment.fallbackReason ?? null,
        });
        return 'escalated';
      });
    },

    async completeRequest(requestId: string): Promise<void> {
      await db.transaction(async (tx) => {
        const [completed] = await tx
          .update(requests)
          .set({ status: 'completed' })
          .where(and(eq(requests.id, requestId), eq(requests.status, 'running')))
          .returning({ id: requests.id });
        if (!completed) return;
        await tx.insert(requestEvents).values({ requestId, type: 'request.completed' });
      });
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

interface Assignment {
  assigneeId: string | null;
  roleId: string | null;
  fallbackReason?: FallbackReason;
}

/** open 的 Task 目前處理人的 email（指派給 Role 時是每一位成員）；Task 已經處理或作廢時為 undefined。 */
async function openTaskHandlerEmails(db: Database, taskId: string): Promise<string[] | undefined> {
  const [task] = await db
    .select({ status: tasks.status, assigneeId: tasks.assigneeId, roleId: tasks.roleId })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (task?.status !== 'open') return undefined;
  return task.roleId
    ? roleMemberEmails(db, task.roleId)
    : activeEmails(db, task.assigneeId ? [task.assigneeId] : []);
}

/** open 的 Task 直接指派給已停用的 Participant 時，回傳此人；其他情況為 undefined。 */
async function deactivatedAssignee(
  db: Database,
  taskId: string,
): Promise<{ name: string } | undefined> {
  const [row] = await db
    .select({ name: authUsers.name, deactivatedAt: participants.deactivatedAt })
    .from(tasks)
    .innerJoin(participants, eq(participants.id, tasks.assigneeId))
    .innerJoin(authUsers, eq(authUsers.id, participants.userId))
    .where(and(eq(tasks.id, taskId), eq(tasks.status, 'open')));
  return row?.deactivatedAt ? { name: row.name } : undefined;
}

/** 這個 Task 已經寄過幾次 Reminder。 */
async function reminderCount(db: Database | Tx, taskId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(requestEvents)
    .where(and(eq(requestEvents.taskId, taskId), eq(requestEvents.type, 'task.reminded')));
  return row?.count ?? 0;
}

/** JSONata 的錯誤代碼（例如 T2001）；log 只記這個，不記錄可能含有 Form 資料的錯誤訊息。 */
function jsonataErrorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

/**
 * 這一輪第 input.visit 次走到這個節點時留下的紀錄：條件的判斷、自動核准、寄出的 Email，或為它建立的 Task；
 * 還沒有時為 undefined。
 * 並行分支上其他分支隨時會寫入事件，所以不能只看 Request 的最後一筆事件，而是只數這個節點自己的紀錄。
 * 條件節點每次判斷都會寫入事件；審批節點每次不是自動核准，就是建立了 Task，所以第幾次一定對得上。
 * Email 節點沒有收件人時不寫事件，同一輪再次走到時第幾次會對不上，最壞的情況是重試時重複寄出。
 * 舊的 workflow 沒有 visit（沒有並行分支）：沿用原本的做法，最後一筆事件是這個節點的紀錄才算。
 */
async function earlierVisit(
  db: Database | Tx,
  input: { requestId: string; nodeId: string; visit?: number },
): Promise<{ type: RequestEventType; edgeId: string | null } | undefined> {
  const ofRequest = eq(requestEvents.requestId, input.requestId);
  if (input.visit === undefined) {
    const [last] = await db
      .select({
        type: requestEvents.type,
        nodeId: requestEvents.nodeId,
        edgeId: requestEvents.edgeId,
      })
      .from(requestEvents)
      .where(ofRequest)
      .orderBy(desc(requestEvents.id))
      .limit(1);
    return last?.nodeId === input.nodeId ? last : undefined;
  }

  const [resubmitted] = await db
    .select({ id: requestEvents.id })
    .from(requestEvents)
    .where(and(ofRequest, eq(requestEvents.type, 'request.resubmitted')))
    .orderBy(desc(requestEvents.id))
    .limit(1);
  const visits = await db
    .select({ type: requestEvents.type, edgeId: requestEvents.edgeId })
    .from(requestEvents)
    .leftJoin(tasks, eq(tasks.id, requestEvents.taskId))
    .where(
      and(
        ofRequest,
        gt(requestEvents.id, resubmitted?.id ?? 0),
        or(
          and(
            inArray(requestEvents.type, [
              'step.branch_chosen',
              'step.auto_approved',
              'step.email_sent',
            ]),
            eq(requestEvents.nodeId, input.nodeId),
          ),
          and(eq(requestEvents.type, 'task.created'), eq(tasks.nodeId, input.nodeId)),
        ),
      ),
    )
    .orderBy(asc(requestEvents.id));
  return visits[input.visit - 1];
}

/** 這一輪第 visit 次走到這一步時已經自動核准（evaluateAutoApproval 重試時已經寫入）。 */
async function alreadyAutoApproved(
  db: Database | Tx,
  input: { requestId: string; nodeId: string; visit?: number },
): Promise<boolean> {
  return (await earlierVisit(db, input))?.type === 'step.auto_approved';
}

/** 這一輪第 visit 次走到這個條件節點時已經做出判斷（evaluateCondition 重試時已經寫入），回傳當時選中的出邊。 */
async function branchAlreadyChosen(
  db: Database | Tx,
  input: { requestId: string; nodeId: string; visit?: number },
): Promise<string | undefined> {
  const earlier = await earlierVisit(db, input);
  return earlier?.type === 'step.branch_chosen' ? (earlier.edgeId ?? undefined) : undefined;
}

/**
 * 讀取 Process Version 的 DSL 與 Request 這一輪填過的 Form 資料（鍵是欄位代碼）。
 * 同一個欄位代碼在多份 Form 都出現時，以最後填寫的為準。
 */
async function loadRound(
  db: Database,
  input: { requestId: string; processVersionId: string },
): Promise<{ dsl: ProcessDsl; data: Record<string, unknown> }> {
  const [version] = await db
    .select({ dsl: processVersions.dsl })
    .from(processVersions)
    .where(eq(processVersions.id, input.processVersionId));
  if (!version)
    throw ApplicationFailure.nonRetryable(`找不到 Process Version ${input.processVersionId}`);
  const [request] = await db
    .select({ round: requests.round })
    .from(requests)
    .where(eq(requests.id, input.requestId));
  if (!request) throw new Error(`找不到 Request ${input.requestId}`);
  const rows = await db
    .select({ data: requestData.data })
    .from(requestData)
    .where(and(eq(requestData.requestId, input.requestId), eq(requestData.round, request.round)))
    .orderBy(asc(requestData.submittedAt));
  return { dsl: version.dsl, data: Object.assign({}, ...rows.map((r) => r.data)) };
}

/**
 * 這位 Participant（發起人，或 Escalation 時目前的處理人）有有效（沒有停用）的 Manager 時指派給 Manager，
 * 否則改派給 Fallback Role 並記下原因。
 */
async function resolveManager(
  tx: Tx,
  participantId: string,
  fallbackRoleId: string,
): Promise<Assignment> {
  const [row] = await tx
    .select({ managerId: participants.managerId, deactivatedAt: managers.deactivatedAt })
    .from(participants)
    .leftJoin(managers, eq(managers.id, participants.managerId))
    .where(eq(participants.id, participantId));
  if (row?.managerId && !row.deactivatedAt) return { assigneeId: row.managerId, roleId: null };
  return {
    assigneeId: null,
    roleId: fallbackRoleId,
    fallbackReason: row?.managerId ? 'manager_deactivated' : 'no_manager',
  };
}
