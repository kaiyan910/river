import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { SetProcessScheduleInput } from '@river/contracts';
import {
  SCHEDULE_TIME_ZONE,
  SCHEDULED_START_WORKFLOW,
  type ScheduledStartInput,
  scheduleIdOf,
} from '@river/contracts/workflow';
import { type Database, participants, processes, processSchedules } from '@river/db';
import {
  type Client,
  isGrpcServiceError,
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  type ScheduleOptionsAction,
  ScheduleOverlapPolicy,
  type ScheduleSpec,
} from '@temporalio/client';
import { eq } from 'drizzle-orm';
import { DATABASE, TEMPORAL_CLIENT, TEMPORAL_TASK_QUEUE } from '../tokens.js';
import { canStart, currentVersions } from './processes.service.js';

/**
 * 排程發起的設定：Postgres 裡的 process_schedules 與 Temporal Schedule 一起建立、更新、刪除。
 * 在同一個 transaction 裡先鎖住 Process、寫入設定，再呼叫 Temporal；Temporal 失敗時設定跟著 rollback。
 * 反過來 Temporal 成功、transaction 提交失敗時兩邊會不一致：
 * - 設定失敗：留下沒有對應設定的 Temporal Schedule，時間到時 worker 讀不到設定，靜默跳過（reason 為 null）；
 *   下一次設定會沿用（更新）這個 Schedule。
 * - 刪除失敗：設定還在、Temporal Schedule 已刪除；再設定一次就會重新建立。
 * Temporal Schedule 的輸入只有 Process ID，發起人在時間到時才從 Postgres 讀取。
 */
@Injectable()
export class ProcessScheduleService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    @Inject(TEMPORAL_TASK_QUEUE) private readonly taskQueue: string,
  ) {}

  /**
   * 設定或修改排程。還沒發佈的 Process 沒有版本可以發起（409）；
   * 發起人必須是有效的 Participant，而且可以發起這個 Process（Initiator Role），否則 422。
   */
  async set(processId: string, input: SetProcessScheduleInput, updatedBy: string) {
    await this.db.transaction(async (tx) => {
      await lockProcess(tx, processId);
      if ((await currentVersions(tx, processId)).length === 0)
        throw new ConflictException('還沒發佈過的 Process 不能設定排程');

      const [initiator] = await tx
        .select({ deactivatedAt: participants.deactivatedAt })
        .from(participants)
        .where(eq(participants.id, input.initiatorId));
      if (!initiator || initiator.deactivatedAt)
        throw new UnprocessableEntityException('找不到發起人，或帳號已停用');
      if (!(await canStart(tx, processId, input.initiatorId)))
        throw new UnprocessableEntityException('發起人不在這個 Process 的 Initiator Role 裡');

      const values = {
        cron: input.cron,
        timezone: SCHEDULE_TIME_ZONE,
        initiatorId: input.initiatorId,
        updatedBy,
        updatedAt: new Date(),
      };
      await tx
        .insert(processSchedules)
        .values({ processId, ...values })
        .onConflictDoUpdate({ target: processSchedules.processId, set: values });
      await this.upsertTemporalSchedule(processId, input.cron);
    });
  }

  /** 刪除排程；沒有排程時什麼都不做。 */
  async remove(processId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await lockProcess(tx, processId);
      await tx.delete(processSchedules).where(eq(processSchedules.processId, processId));
      try {
        await this.temporal.schedule.getHandle(scheduleIdOf(processId)).delete();
      } catch (error) {
        if (!(error instanceof ScheduleNotFoundError)) throw error;
      }
    });
  }

  /**
   * 建立 Temporal Schedule；已經存在時（修改設定，或上一次寫入 Postgres 失敗而留下的）改成更新。
   * cron 的數值範圍由 Temporal 檢查，不合法時回 422。
   */
  private async upsertTemporalSchedule(processId: string, cron: string): Promise<void> {
    const scheduleId = scheduleIdOf(processId);
    const spec: ScheduleSpec = { cronExpressions: [cron], timezone: SCHEDULE_TIME_ZONE };
    const args: [ScheduledStartInput] = [{ processId }];
    const action: ScheduleOptionsAction = {
      type: 'startWorkflow',
      workflowType: SCHEDULED_START_WORKFLOW,
      workflowId: `scheduled-start-${processId}`,
      taskQueue: this.taskQueue,
      args,
    };
    try {
      try {
        await this.temporal.schedule.create({
          scheduleId,
          spec,
          action,
          // 每次時間到都是獨立的一筆 Request，不因上一次還在發起而跳過；
          // Temporal 暫時無法使用時，一天內錯過的時間恢復後補發，更久以前的不補。
          policies: { overlap: ScheduleOverlapPolicy.ALLOW_ALL, catchupWindow: '1 day' },
        });
      } catch (error) {
        if (!(error instanceof ScheduleAlreadyRunning)) throw error;
        await this.temporal.schedule
          .getHandle(scheduleId)
          .update((previous) => ({ ...previous, spec, action }));
      }
    } catch (error) {
      const reason = invalidCronReason(error);
      if (reason !== undefined)
        throw new UnprocessableEntityException(`cron 不合法：${cron}${reason && `（${reason}）`}`);
      throw error;
    }
  }
}

/** 鎖住 Process，序列化同一個 Process 的排程設定；不存在時回 404。 */
async function lockProcess(tx: Pick<Database, 'select'>, processId: string): Promise<void> {
  const [process] = await tx
    .select({ id: processes.id })
    .from(processes)
    .where(eq(processes.id, processId))
    .for('update');
  if (!process) throw new NotFoundException('找不到這個 Process');
}

/** gRPC 的 INVALID_ARGUMENT。 */
const INVALID_ARGUMENT = 3;

/**
 * cron 不合法時的原因；其他錯誤回傳 undefined。
 * Temporal client 先在本地解析 cron，數值超出範圍時丟出 TypeError（例如「Hour is not in range [0-23]」）；
 * 通過本地解析、被 server 拒絕的回 gRPC INVALID_ARGUMENT。
 */
function invalidCronReason(error: unknown): string | undefined {
  if (error instanceof TypeError) return error.message;
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause)
    if (isGrpcServiceError(e) && e.code === INVALID_ARGUMENT) return '';
  return undefined;
}
