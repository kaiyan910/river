import {
  authUsers,
  type Database,
  participants,
  processes,
  processSchedules,
  processVersions,
  requestData,
  requestEvents,
  requests,
} from '@river/db';
import { formIdOf } from '@river/dsl';
import { renderScheduledStartSkippedNotification } from '@river/email';
import { todayIn, validateFormData } from '@river/forms';
import { log } from '@temporalio/activity';
import { desc, eq } from 'drizzle-orm';
import { type NotificationDeps, permissionHolderEmails } from './notifications.js';

export interface StartScheduledRequestInput {
  processId: string;
  /** 由 workflow 產生；activity 重試時用同一個 ID，Request 不會重複建立。 */
  requestId: string;
}

/**
 * started：已經建立 Request，接著由 workflow 啟動 interpreter。
 * skipped：這一次不發起；reason 是給 Administrator 看的原因（不含 Form 資料），沒有時不通知（例如排程剛被刪除）。
 */
export type StartScheduledRequestResult =
  | { status: 'started'; requestId: string; processVersionId: string }
  | { status: 'skipped'; reason: string | null };

export interface NotifyScheduledStartSkippedInput {
  processId: string;
  reason: string;
}

/** 排程發起用的 activity；和 interpreter 的 activity 一起註冊在 worker 上。 */
export function createScheduledStartActivities(db: Database, notification: NotificationDeps) {
  return {
    /**
     * 排程時間到：以排程上指定的 Participant 為發起人、Process 的目前版本建立 Request。
     * 發起人和版本都在這時候才讀取，所以修改設定、發佈新版本之後，下一次時間到就會套用。
     * 排程發起沒有人填開始表單，以空白的表單送出；開始表單有必填欄位時跳過。
     * Request、request.started 事件與開始表單資料在同一個 transaction 寫入；workflow 的輸入與回傳值都只有 ID。
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
      if (!schedule) {
        // 設定剛被刪除，Temporal Schedule 在刪除前觸發了這一次。
        log.info('排程已經刪除，不發起', { processId });
        return { status: 'skipped', reason: null };
      }
      if (schedule.deactivatedAt)
        return {
          status: 'skipped',
          reason: `指定的發起人 ${schedule.initiatorName} 已停用。`,
        };

      const [current] = await db
        .select({ id: processVersions.id, dsl: processVersions.dsl })
        .from(processVersions)
        .where(eq(processVersions.processId, processId))
        .orderBy(desc(processVersions.version))
        .limit(1);
      if (!current) return { status: 'skipped', reason: '這個 Process 沒有已發佈的版本。' };

      const startNode = current.dsl.nodes.find((n) => n.type === 'start');
      const formId = startNode && formIdOf(startNode);
      const form = formId ? current.dsl.forms.find((f) => f.id === formId) : undefined;
      const validated = form ? validateFormData(form, {}, { today: todayIn() }) : undefined;
      if (validated && !validated.success) {
        const labels = (form?.fields ?? [])
          .filter((f) => f.key in validated.errors)
          .map((f) => f.label);
        return {
          status: 'skipped',
          reason: `開始表單有必填欄位（${labels.join('、')}），排程無法以空白的表單發起。`,
        };
      }

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

    /** 跳過排程發起時通知 Administrator（持有 user.manage、可以處理停用帳號的人）。 */
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
      for (const to of new Set(await permissionHolderEmails(db, 'user.manage')))
        await notification.emailSender.send(
          await renderScheduledStartSkippedNotification({
            to,
            url: url.toString(),
            processName: process.name,
            reason,
          }),
        );
    },
  };
}

export type ScheduledStartActivities = ReturnType<typeof createScheduledStartActivities>;
