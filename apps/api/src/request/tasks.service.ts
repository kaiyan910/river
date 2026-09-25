import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CompleteTaskCommand, MyTask, RequestDetail, TaskStatus } from '@river/contracts';
import { TASK_COMPLETED_SIGNAL, type TaskCompletedSignal } from '@river/contracts/workflow';
import { type Database, requestEvents, type TaskOutcome, tasks } from '@river/db';
import { Client } from '@temporalio/client';
import { and, eq, sql } from 'drizzle-orm';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { participantNames } from '../process/processes.service.js';
import { DATABASE, TEMPORAL_CLIENT } from '../tokens.js';
import { RequestReads } from './request-reads.js';

@Injectable()
export class TasksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    private readonly reads: RequestReads,
  ) {}

  mine(me: ActiveParticipant, status: TaskStatus): Promise<MyTask[]> {
    return this.reads.myTasks(me.id, status);
  }

  /**
   * 先以樂觀鎖（status = open 且 version 相同）完成 Task 並寫入事件，提交後才送出 taskCompleted Signal。
   * 只有更新成功的一方會送 Signal；workflow 端冪等，Signal 失敗時可以安全重送。
   */
  async complete(
    taskId: string,
    input: CompleteTaskCommand,
    me: ActiveParticipant,
  ): Promise<RequestDetail> {
    const comment = input.comment || null;
    const requestId = await this.db.transaction(async (tx) => {
      const [done] = await tx
        .update(tasks)
        .set({
          status: 'completed',
          outcome: input.outcome,
          comment,
          completedBy: me.id,
          completedAt: new Date(),
          version: sql`${tasks.version} + 1`,
        })
        .where(
          and(
            eq(tasks.id, taskId),
            eq(tasks.assigneeId, me.id),
            eq(tasks.status, 'open'),
            eq(tasks.version, input.version),
          ),
        )
        .returning({ requestId: tasks.requestId });
      if (!done) return undefined;
      await tx.insert(requestEvents).values({
        requestId: done.requestId,
        type: 'task.completed',
        actorId: me.id,
        taskId,
        comment,
      });
      return done.requestId;
    });
    if (!requestId) await this.explainConflict(taskId, me);

    const signal: TaskCompletedSignal = { taskId, outcome: input.outcome };
    await this.temporal.workflow
      .getHandle(requestId as string)
      .signal(TASK_COMPLETED_SIGNAL, signal);
    const detail = await this.reads.detail(requestId as string, me.id);
    if (!detail) throw new NotFoundException('找不到這筆 Request');
    return detail;
  }

  private async signalCompleted(requestId: string, taskId: string, outcome: TaskOutcome) {
    const signal: TaskCompletedSignal = { taskId, outcome };
    await this.temporal.workflow.getHandle(requestId).signal(TASK_COMPLETED_SIGNAL, signal);
  }

  /**
   * 樂觀鎖沒有更新到任何一列時，說明原因。
   * Task 已由自己完成時（例如上一次的 Signal 送出失敗後重試）再送一次 Signal：workflow 端冪等，
   * 萬一上一次沒送到，Request 才不會一直停在「處理中」。
   */
  private async explainConflict(taskId: string, me: ActiveParticipant): Promise<never> {
    const [task] = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task || task.assigneeId !== me.id) throw new NotFoundException('找不到這個 Task');
    if (task.status !== 'open') {
      if (task.completedBy === me.id && task.outcome)
        await this.signalCompleted(task.requestId, task.id, task.outcome);
      const by = task.completedBy
        ? (await participantNames(this.db, [task.completedBy])).get(task.completedBy)
        : undefined;
      throw new ConflictException(`已由 ${by ?? '其他人'} 處理。`);
    }
    throw new ConflictException('這個 Task 已經有變更，請重新整理後再試。');
  }
}
