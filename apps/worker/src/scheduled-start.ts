import {
  authUsers,
  type Database,
  participants,
  processes,
  processInitiatorRoles,
  processSchedules,
  processVersions,
  requestData,
  requestEvents,
  requests,
  roleMembers,
} from '@river/db';
import { formIdOf, type ProcessDsl } from '@river/dsl';
import { renderScheduledStartSkippedNotification } from '@river/email';
import { type FormSchema, todayIn, validateFormData } from '@river/forms';
import { log } from '@temporalio/activity';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { type NotificationDeps, permissionHolderEmails } from './notifications.js';

export interface StartScheduledRequestInput {
  processId: string;
  /** 由 workflow 產生；activity 重試時用同一個 ID，Request 不會重複建立。 */
  requestId: string;
}

/**
 * 跳過排程發起的原因。只有代碼會進入 Temporal history；給 Administrator 看的說明（發起人姓名、欄位名稱）
 * 在寄信的 activity 裡才從 Postgres 讀取（TECH-STACK 約束 1）。
 * - initiator_deactivated：指定的發起人已停用
 * - initiator_not_allowed：發起人已經不在 Process 的 Initiator Role 裡
 * - no_version：Process 沒有已發佈的版本
 * - required_fields：開始表單有必填欄位，無法以空白的表單發起
 */
export type ScheduledStartSkipReason =
  | 'initiator_deactivated'
  | 'initiator_not_allowed'
  | 'no_version'
  | 'required_fields';

/**
 * started：已經建立 Request，接著由 workflow 啟動 interpreter。
 * skipped：這一次不發起；reason 為 null 時不通知（排程設定已經刪除，或設定時 transaction 沒有提交）。
 */
export type StartScheduledRequestResult =
  | { status: 'started'; requestId: string; processVersionId: string }
  | { status: 'skipped'; reason: ScheduledStartSkipReason | null };

export interface NotifyScheduledStartSkippedInput {
  processId: string;
  reason: ScheduledStartSkipReason;
}

/** 排程發起用的 activity；和 interpreter 的 activity 一起註冊在 worker 上。 */
export function createScheduledStartActivities(db: Database, notification: NotificationDeps) {
  return {
    /**
     * 排程時間到：以排程上指定的 Participant 為發起人、Process 的目前版本建立 Request。
     * 發起人和版本都在這時候才讀取，所以修改設定、發佈新版本之後，下一次時間到就會套用。
     * 發起人必須仍然有效，而且仍在 Initiator Role 裡（設定之後可能被移出）。
     * 排程發起沒有人填開始表單，以空白的表單送出；開始表單有必填欄位時跳過。
     * Request、request.started 事件與開始表單資料在同一個 transaction 寫入；workflow 的輸入與回傳值都只有 ID 與代碼。
     */
    async startScheduledRequest({
      processId,
      requestId,
    }: StartScheduledRequestInput): Promise<StartScheduledRequestResult> {
      const [existing] = await db
        .select({ processVersionId: requests.processVersionId })
        .from(requests)
        .where(eq(requests.id, requestId));
      if (existing)
        return { status: 'started', requestId, processVersionId: existing.processVersionId };

      const schedule = await loadSchedule(db, processId);
      if (!schedule) {
        // 設定剛被刪除，Temporal Schedule 在刪除前觸發了這一次；或設定時 Temporal 成功但 transaction 沒有提交。
        log.info('找不到排程設定，不發起', { processId });
        return { status: 'skipped', reason: null };
      }
      if (schedule.deactivatedAt) return { status: 'skipped', reason: 'initiator_deactivated' };
      if (!(await inInitiatorRole(db, processId, schedule.initiatorId)))
        return { status: 'skipped', reason: 'initiator_not_allowed' };

      const current = await currentVersion(db, processId);
      if (!current) return { status: 'skipped', reason: 'no_version' };
      const { startNode, form } = startFormOf(current.dsl);
      const validated = form ? validateFormData(form, {}, { today: todayIn() }) : undefined;
      if (validated && !validated.success) return { status: 'skipped', reason: 'required_fields' };

      await db.transaction(async (tx) => {
        await tx.insert(requests).values({
          id: requestId,
          processVersionId: current.id,
          initiatorId: schedule.initiatorId,
          title: `${schedule.processName}（排程 ${todayIn()}）`,
        });
        await tx.insert(requestEvents).values({
          requestId,
          type: 'request.started',
          actorId: schedule.initiatorId,
          comment: '排程發起',
        });
        if (startNode && form && validated?.success)
          await tx.insert(requestData).values({
            requestId,
            nodeId: startNode.id,
            formId: form.id,
            round: 1,
            data: validated.data,
            submittedBy: schedule.initiatorId,
          });
      });
      return { status: 'started', requestId, processVersionId: current.id };
    },

    /**
     * 跳過排程發起時通知 Administrator（持有 user.manage、可以處理停用帳號的人）。
     * 說明文字在這裡依原因代碼從 Postgres 組出來，不經過 Temporal history。
     */
    async notifyScheduledStartSkipped({
      processId,
      reason,
    }: NotifyScheduledStartSkippedInput): Promise<void> {
      const [process] = await db
        .select({ name: processes.name })
        .from(processes)
        .where(eq(processes.id, processId));
      if (!process) return;
      const url = new URL('/designer/processes', notification.appUrl);
      url.searchParams.set('id', processId);
      const text = await describeSkip(db, processId, reason);
      for (const to of new Set(await permissionHolderEmails(db, 'user.manage')))
        await notification.emailSender.send(
          await renderScheduledStartSkippedNotification({
            to,
            url: url.toString(),
            processName: process.name,
            reason: text,
          }),
        );
    },
  };
}

export type ScheduledStartActivities = ReturnType<typeof createScheduledStartActivities>;

async function loadSchedule(db: Database, processId: string) {
  const [schedule] = await db
    .select({
      processName: processes.name,
      initiatorId: processSchedules.initiatorId,
      initiatorName: authUsers.name,
      deactivatedAt: participants.deactivatedAt,
    })
    .from(processSchedules)
    .innerJoin(processes, eq(processes.id, processSchedules.processId))
    .innerJoin(participants, eq(participants.id, processSchedules.initiatorId))
    .innerJoin(authUsers, eq(authUsers.id, participants.userId))
    .where(eq(processSchedules.processId, processId));
  return schedule;
}

/** 和 api 的 canStart 相同：Process 沒有設定 Initiator Role，或這位 Participant 是其中任一個的成員。 */
async function inInitiatorRole(
  db: Database,
  processId: string,
  participantId: string,
): Promise<boolean> {
  const roles = await db
    .select({ roleId: processInitiatorRoles.roleId })
    .from(processInitiatorRoles)
    .where(eq(processInitiatorRoles.processId, processId));
  if (roles.length === 0) return true;
  const [member] = await db
    .select({ roleId: roleMembers.roleId })
    .from(roleMembers)
    .where(
      and(
        eq(roleMembers.participantId, participantId),
        inArray(
          roleMembers.roleId,
          roles.map((r) => r.roleId),
        ),
      ),
    )
    .limit(1);
  return !!member;
}

async function currentVersion(db: Database, processId: string) {
  const [current] = await db
    .select({ id: processVersions.id, dsl: processVersions.dsl })
    .from(processVersions)
    .where(eq(processVersions.processId, processId))
    .orderBy(desc(processVersions.version))
    .limit(1);
  return current;
}

function startFormOf(dsl: ProcessDsl): {
  startNode: ProcessDsl['nodes'][number] | undefined;
  form: FormSchema | undefined;
} {
  const startNode = dsl.nodes.find((n) => n.type === 'start');
  const formId = startNode && formIdOf(startNode);
  return { startNode, form: formId ? dsl.forms.find((f) => f.id === formId) : undefined };
}

/** 給 Administrator 看的跳過原因；發起人與欄位以寄信當下的資料為準。 */
async function describeSkip(
  db: Database,
  processId: string,
  reason: ScheduledStartSkipReason,
): Promise<string> {
  switch (reason) {
    case 'initiator_deactivated': {
      const schedule = await loadSchedule(db, processId);
      return `指定的發起人 ${schedule?.initiatorName ?? ''} 已停用。`;
    }
    case 'initiator_not_allowed': {
      const schedule = await loadSchedule(db, processId);
      return `指定的發起人 ${schedule?.initiatorName ?? ''} 已經不在這個 Process 的 Initiator Role 裡。`;
    }
    case 'no_version':
      return '這個 Process 沒有已發佈的版本。';
    case 'required_fields': {
      const current = await currentVersion(db, processId);
      const { form } = current ? startFormOf(current.dsl) : { form: undefined };
      const labels = (form?.fields ?? []).filter((f) => f.required).map((f) => f.label);
      return `開始表單有必填欄位（${labels.join('、')}），排程無法以空白的表單發起。`;
    }
  }
}
