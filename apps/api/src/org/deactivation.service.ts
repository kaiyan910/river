import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { DeactivationImpact, Participant } from '@river/contracts';
import { authSessions, authUsers, type Database, participants, permissionGrants } from '@river/db';
import { type EmailSender, renderPendingReassignNotification } from '@river/email';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { RequestReads } from '../request/request-reads.js';
import { APP_URL, DATABASE, EMAIL_SENDER } from '../tokens.js';
import { ParticipantsService } from './participants.service.js';

/**
 * 停用離職員工的帳號：只停用、不刪除任何資料。
 * - 停用前可以預覽影響範圍：直接指派給此人的 open Task，以及以此人為 Manager 的 Participant。
 * - 停用後此人的所有 session 立即失效，也無法再登入（見 create-auth 的 session hook）。
 * - 此人發起的 Request 照常繼續；直接指派給此人的 open Task 進入「待 Reassign」清單，並寄信通知 Administrator。
 * - 以此人為 Manager 的 Participant 保留 manager_id；之後指派給他們 Manager 的步驟改派給 Fallback Role。
 */
@Injectable()
export class DeactivationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_URL) private readonly appUrl: string,
    private readonly participants: ParticipantsService,
    private readonly reads: RequestReads,
    private readonly logger: Logger,
  ) {}

  async impact(id: string): Promise<DeactivationImpact> {
    await this.participants.get(id);
    const reports = await this.db
      .select({ id: participants.id })
      .from(participants)
      .innerJoin(authUsers, eq(authUsers.id, participants.userId))
      .where(eq(participants.managerId, id))
      .orderBy(asc(authUsers.name));
    const directory = await this.participants.directory();
    const reportIds = new Set(reports.map((r) => r.id));
    return {
      openTasks: await this.reads.directOpenTasks(id),
      directReports: directory.filter((p) => reportIds.has(p.id)),
    };
  }

  /** 重複停用沒有影響（session 仍會再清一次）；不能停用自己。 */
  async deactivate(id: string, actor: ActiveParticipant): Promise<Participant> {
    const participant = await this.participants.get(id);
    if (id === actor.id) throw new ConflictException('不能停用自己的帳號');

    const newlyDeactivated = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(participants)
        .set({ deactivatedAt: new Date() })
        .where(and(eq(participants.id, id), isNull(participants.deactivatedAt)))
        .returning({ userId: participants.userId });
      const [row] = await tx
        .select({ userId: participants.userId })
        .from(participants)
        .where(eq(participants.id, id));
      if (row) await tx.delete(authSessions).where(eq(authSessions.userId, row.userId));
      return !!updated;
    });

    if (newlyDeactivated) await this.notifyPendingReassign(id, participant.name);
    return this.participants.get(id);
  }

  /**
   * 此人還有直接指派給他的 open Task 時，寄一封信給每一位持有 task.reassign 的 Administrator。
   * 寄信盡力而為：帳號已經停用，寄不出去只記錄錯誤，清單上仍然看得到。
   */
  private async notifyPendingReassign(id: string, name: string): Promise<void> {
    const tasks = await this.reads.directOpenTasks(id);
    if (tasks.length === 0) return;
    const admins = await this.db
      .select({ email: authUsers.email })
      .from(permissionGrants)
      .innerJoin(participants, eq(participants.id, permissionGrants.participantId))
      .innerJoin(authUsers, eq(authUsers.id, participants.userId))
      .where(
        and(eq(permissionGrants.permission, 'task.reassign'), isNull(participants.deactivatedAt)),
      );
    const url = new URL('/admin/reassign', this.appUrl).toString();
    const list = tasks.map((t) => ({
      requestTitle: t.request.title,
      processName: t.request.process.name,
    }));
    for (const { email } of admins) {
      try {
        await this.email.send(
          await renderPendingReassignNotification({
            to: email,
            url,
            participantName: name,
            tasks: list,
          }),
        );
      } catch (error) {
        this.logger.error({ err: error, participantId: id }, '待 Reassign 通知寄送失敗');
      }
    }
  }
}
