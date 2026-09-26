import {
  authUsers,
  type Database,
  participants,
  permissionGrants,
  processes,
  processVersions,
  requests,
  roleMembers,
} from '@river/db';
import type { EmailRecipient } from '@river/dsl';
import type { EmailSender, RequestNotificationProps } from '@river/email';
import { renderPendingReassignNotification, renderRequestNotification } from '@river/email';
import { and, eq, inArray, isNull } from 'drizzle-orm';

/** 寄信需要的依賴；appUrl 是瀏覽器看到的網址，信件裡的連結以它為準。 */
export interface NotificationDeps {
  emailSender: EmailSender;
  appUrl: string;
}

/** 信件可以用的 Request 資訊：只有非敏感的欄位，絕不讀取 Form 資料。 */
export interface RequestSummary {
  title: string;
  processName: string;
  initiatorId: string;
  status: (typeof requests.$inferSelect)['status'];
}

export async function requestSummary(
  db: Database,
  requestId: string,
): Promise<RequestSummary | undefined> {
  const [row] = await db
    .select({
      title: requests.title,
      processName: processes.name,
      initiatorId: requests.initiatorId,
      status: requests.status,
    })
    .from(requests)
    .innerJoin(processVersions, eq(processVersions.id, requests.processVersionId))
    .innerJoin(processes, eq(processes.id, processVersions.processId))
    .where(eq(requests.id, requestId));
  return row;
}

/** 這些 Participant 中沒有停用的人的 email。 */
export async function activeEmails(db: Database, participantIds: string[]): Promise<string[]> {
  if (participantIds.length === 0) return [];
  const rows = await db
    .select({ email: authUsers.email })
    .from(participants)
    .innerJoin(authUsers, eq(authUsers.id, participants.userId))
    .where(and(inArray(participants.id, participantIds), isNull(participants.deactivatedAt)));
  return rows.map((r) => r.email);
}

/** Role 每一位沒有停用的成員的 email。 */
export async function roleMemberEmails(db: Database, roleId: string): Promise<string[]> {
  const rows = await db
    .select({ email: authUsers.email })
    .from(roleMembers)
    .innerJoin(participants, eq(participants.id, roleMembers.participantId))
    .innerJoin(authUsers, eq(authUsers.id, participants.userId))
    .where(and(eq(roleMembers.roleId, roleId), isNull(participants.deactivatedAt)));
  return rows.map((r) => r.email);
}

/** 持有 task.reassign、沒有停用的 Administrator 的 email；「待 Reassign」清單有新項目時通知他們。 */
export async function reassignerEmails(db: Database): Promise<string[]> {
  const rows = await db
    .select({ email: authUsers.email })
    .from(permissionGrants)
    .innerJoin(participants, eq(participants.id, permissionGrants.participantId))
    .innerJoin(authUsers, eq(authUsers.id, participants.userId))
    .where(
      and(eq(permissionGrants.permission, 'task.reassign'), isNull(participants.deactivatedAt)),
    );
  return rows.map((r) => r.email);
}

/** Email 節點的收件人；發起人的 Manager 沒有設定或已停用時沒有收件人（activeEmails 會濾掉停用的人）。 */
export async function emailRecipients(
  db: Database,
  recipient: EmailRecipient,
  initiatorId: string,
): Promise<string[]> {
  switch (recipient.type) {
    case 'participant':
      return activeEmails(db, [recipient.participantId]);
    case 'role':
      return roleMemberEmails(db, recipient.roleId);
    case 'initiator':
      return activeEmails(db, [initiatorId]);
    case 'manager': {
      const [row] = await db
        .select({ managerId: participants.managerId })
        .from(participants)
        .where(eq(participants.id, initiatorId));
      return row?.managerId ? activeEmails(db, [row.managerId]) : [];
    }
  }
}

/** 直接開到某個 Task 或 Request 的連結；還沒登入時，前端先導到登入頁，登入後再回到這裡。 */
export function taskUrl(appUrl: string, taskId: string): string {
  return new URL(`/tasks?id=${encodeURIComponent(taskId)}`, appUrl).toString();
}

export function pendingReassignUrl(appUrl: string): string {
  return new URL('/admin/reassign', appUrl).toString();
}

export function requestUrl(appUrl: string, requestId: string): string {
  return new URL(`/requests?id=${encodeURIComponent(requestId)}`, appUrl).toString();
}

/** 每位收件人各寄一封；信件只帶 Request 標題、Process 名稱與連結。 */
export async function sendToEach(
  { emailSender }: NotificationDeps,
  to: string[],
  props: Omit<RequestNotificationProps, 'to' | 'notification'>,
  notification: RequestNotificationProps['notification'],
): Promise<void> {
  for (const address of new Set(to))
    await emailSender.send(
      await renderRequestNotification({ ...props, to: address, notification }),
    );
}

/** 「待 Reassign」清單有新項目：寄給每一位持有 task.reassign 的 Administrator。 */
export async function sendPendingReassign(
  db: Database,
  { emailSender, appUrl }: NotificationDeps,
  participantName: string,
  tasks: { requestTitle: string; processName: string }[],
): Promise<void> {
  if (tasks.length === 0) return;
  const url = pendingReassignUrl(appUrl);
  for (const address of new Set(await reassignerEmails(db)))
    await emailSender.send(
      await renderPendingReassignNotification({ to: address, url, participantName, tasks }),
    );
}
