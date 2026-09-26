import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { CompleteTaskCommand, MyTask, MyTasksStatus, RequestDetail } from '@river/contracts';
import { TASK_COMPLETED_SIGNAL, type TaskCompletedSignal } from '@river/contracts/workflow';
import {
  type Database,
  processVersions,
  requestEvents,
  requests,
  type TaskOutcome,
  tasks,
} from '@river/db';
import { Client } from '@temporalio/client';
import { and, eq, sql } from 'drizzle-orm';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { formOf, participantNames } from '../process/processes.service.js';
import { DATABASE, TEMPORAL_CLIENT } from '../tokens.js';
import { saveStepData, validateStepData } from './form-data.js';
import { RequestReads } from './request-reads.js';
import { supersedeOpenTasks } from './supersede.js';

@Injectable()
export class TasksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    private readonly reads: RequestReads,
  ) {}

  mine(me: ActiveParticipant, status: MyTasksStatus): Promise<MyTask[]> {
    return this.reads.myTasks(me.id, status);
  }

  /**
   * 先以樂觀鎖（status = open 且 version 相同）完成 Task 並寫入事件，提交後才送出 taskCompleted Signal。
   * 只有更新成功的一方會送 Signal；workflow 端冪等，Signal 失敗時可以安全重送。
   * 填表 Task 的資料依 Process Version 裡的 Form 驗證，和 Task 一起存進 request_data；Signal 不帶資料。
   *
   * Return（只有審批 Task 可以）在同一個 transaction 裡把 Request 改成 returned，
   * 其他 open 的 Task 全部作廢。先鎖住 Request，和 Withdraw、createTask activity 的鎖定順序相同。
   */
  async complete(
    taskId: string,
    input: CompleteTaskCommand,
    me: ActiveParticipant,
  ): Promise<RequestDetail> {
    const [task] = await this.db
      .select({
        requestId: tasks.requestId,
        round: tasks.round,
        kind: tasks.kind,
        nodeId: tasks.nodeId,
        status: tasks.status,
        assigneeId: tasks.assigneeId,
        dsl: processVersions.dsl,
      })
      .from(tasks)
      .innerJoin(requests, eq(requests.id, tasks.requestId))
      .innerJoin(processVersions, eq(processVersions.id, requests.processVersionId))
      .where(eq(tasks.id, taskId));
    if (!task || task.assigneeId !== me.id) throw new NotFoundException('找不到這個 Task');
    if (task.status !== 'open') await this.explainConflict(taskId, me);
    const allowed: TaskOutcome[] = task.kind === 'form' ? ['submitted'] : ['approved', 'returned'];
    if (!allowed.includes(input.outcome))
      throw new UnprocessableEntityException(
        task.kind === 'form' ? '填表 Task 要送出表單資料' : '審批 Task 只能核准或 Return',
      );
    const returning = input.outcome === 'returned';
    const form =
      task.kind === 'form'
        ? formOf(
            task.dsl,
            task.dsl.nodes.find((n) => n.id === task.nodeId),
          )
        : null;
    const submission = validateStepData(form, input.data);

    const comment = input.comment || null;
    const requestId = await this.db.transaction(async (tx) => {
      if (returning)
        await tx
          .select({ id: requests.id })
          .from(requests)
          .where(eq(requests.id, task.requestId))
          .for('update');
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
      await saveStepData(tx, submission, {
        requestId: done.requestId,
        nodeId: task.nodeId,
        submittedBy: me.id,
        round: task.round,
      });
      await tx.insert(requestEvents).values({
        requestId: done.requestId,
        type: returning ? 'task.returned' : 'task.completed',
        actorId: me.id,
        taskId,
        comment,
      });
      if (returning) {
        await supersedeOpenTasks(tx, done.requestId);
        await tx
          .update(requests)
          .set({ status: 'returned' })
          .where(and(eq(requests.id, done.requestId), eq(requests.status, 'running')));
      }
      return done.requestId;
    });
    if (!requestId) await this.explainConflict(taskId, me);

    await this.signalCompleted(requestId as string, taskId, input.outcome);
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
    if (task.status === 'superseded') {
      const [request] = await this.db
        .select({ status: requests.status })
        .from(requests)
        .where(eq(requests.id, task.requestId));
      throw new ConflictException(
        request?.status === 'withdrawn'
          ? '發起人已撤回這筆 Request，這個 Task 不需要再處理。'
          : '這個 Task 已經作廢，不需要再處理。',
      );
    }
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
