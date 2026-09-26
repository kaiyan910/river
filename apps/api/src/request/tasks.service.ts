import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  CompleteTaskCommand,
  MyTask,
  MyTasksStatus,
  ReassignTaskInput,
  RequestDetail,
} from '@river/contracts';
import {
  REASSIGN_SIGNAL,
  type ReassignSignal,
  TASK_COMPLETED_SIGNAL,
  type TaskCompletedSignal,
} from '@river/contracts/workflow';
import {
  type Database,
  participants,
  processVersions,
  requestEvents,
  requests,
  type TaskOutcome,
  tasks,
} from '@river/db';
import { Client, WorkflowNotFoundError } from '@temporalio/client';
import { and, eq, sql } from 'drizzle-orm';
import { AttachmentsService } from '../attachment/attachments.service.js';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { formOf, participantNames } from '../process/processes.service.js';
import { DATABASE, TEMPORAL_CLIENT } from '../tokens.js';
import { saveStepData, validateStepData } from './form-data.js';
import { RequestReads } from './request-reads.js';
import { supersedeOpenTasks } from './supersede.js';
import { assignedTo, assignedToOrHandledBy } from './task-access.js';

@Injectable()
export class TasksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    private readonly reads: RequestReads,
    private readonly attachments: AttachmentsService,
  ) {}

  mine(me: ActiveParticipant, status: MyTasksStatus): Promise<MyTask[]> {
    return this.reads.myTasks(me.id, status);
  }

  /**
   * 先以樂觀鎖（status = open 且 version 相同）完成 Task 並寫入事件，提交後才送出 taskCompleted Signal。
   * 只有更新成功的一方會送 Signal；workflow 端冪等，Signal 失敗時可以安全重送。
   * 指派給 Role 的 Task 任一成員都可以直接處理，不需要認領；最先送出的生效，其他人收到「已由 X 處理」。
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
        replacesTaskId: tasks.replacesTaskId,
        dsl: processVersions.dsl,
      })
      .from(tasks)
      .innerJoin(requests, eq(requests.id, tasks.requestId))
      .innerJoin(processVersions, eq(processVersions.id, requests.processVersionId))
      .where(and(eq(tasks.id, taskId), assignedToOrHandledBy(this.db, me.id)));
    if (!task) throw new NotFoundException('找不到這個 Task');
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
    const submission = await validateStepData(
      this.db,
      form,
      await this.attachments.resolve(form, input.data, {
        submitterId: me.id,
        requestId: task.requestId,
      }),
    );

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
            assignedTo(tx, me.id),
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

    // Reassign 接手的 Task：萬一當時的 reassign Signal 沒送到，workflow 還在等原本的 Task，先補送一次。
    if (task.replacesTaskId) await this.resendReassigned(requestId as string, taskId);
    await this.signalCompleted(requestId as string, taskId, input.outcome);
    const detail = await this.reads.detail(requestId as string, me);
    if (!detail) throw new NotFoundException('找不到這筆 Request');
    return detail;
  }

  /** 「待 Reassign」清單：直接指派給已停用 Participant 的 open Task。 */
  pendingReassign(): Promise<MyTask[]> {
    return this.reads.pendingReassign();
  }

  /**
   * 把 open 的 Task 改派給另一位（沒有停用的）Participant：原 Task 作廢，為新的處理人建立新的 Task，
   * 新的 Task 記下它取代的 Task（replacesTaskId），時間軸記錄誰改派、原因是什麼。
   * 指派給 Role 的 Task 也可以改派，改派後直接指派給這位 Participant。
   * 先鎖住 Request 與 Task（和 Return、Withdraw、Cancel、createTask activity 同樣的鎖定順序），
   * 所以和處理人同時送出時，只有一方成功。提交後才送出 reassign Signal，workflow 改等新的 Task 並通知新的處理人。
   */
  async reassign(taskId: string, input: ReassignTaskInput, me: ActiveParticipant): Promise<MyTask> {
    const [target] = await this.db
      .select({ deactivatedAt: participants.deactivatedAt })
      .from(participants)
      .where(eq(participants.id, input.assigneeId));
    if (!target) throw new BadRequestException('找不到要改派的 Participant');
    if (target.deactivatedAt) throw new BadRequestException('不能改派給已停用的 Participant');
    const [task] = await this.db
      .select({ requestId: tasks.requestId })
      .from(tasks)
      .where(eq(tasks.id, taskId));
    if (!task) throw new NotFoundException('找不到這個 Task');

    const newTaskId = randomUUID();
    const reassigned = await this.db.transaction(async (tx) => {
      await tx
        .select({ id: requests.id })
        .from(requests)
        .where(eq(requests.id, task.requestId))
        .for('update');
      const [old] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for('update');
      if (old?.status !== 'open') return false;
      if (old.assigneeId === input.assigneeId)
        throw new BadRequestException('這個 Task 已經指派給這位 Participant');
      await tx
        .update(tasks)
        .set({ status: 'superseded', version: sql`${tasks.version} + 1` })
        .where(eq(tasks.id, taskId));
      await tx.insert(tasks).values({
        id: newTaskId,
        requestId: old.requestId,
        nodeId: old.nodeId,
        nodeName: old.nodeName,
        kind: old.kind,
        round: old.round,
        assigneeId: input.assigneeId,
        replacesTaskId: old.id,
      });
      await tx.insert(requestEvents).values([
        { requestId: old.requestId, type: 'task.superseded', actorId: me.id, taskId },
        {
          requestId: old.requestId,
          type: 'task.reassigned',
          actorId: me.id,
          taskId: newTaskId,
          comment: input.comment || null,
        },
      ]);
      return true;
    });
    if (!reassigned) return this.explainNotReassignable(taskId);

    await this.signalReassigned(task.requestId, { taskId, newTaskId });
    const created = await this.reads.task(newTaskId);
    if (!created) throw new NotFoundException('找不到這個 Task');
    return created;
  }

  /** Task 已經不是 open，不能 Reassign 時說明原因；已經 Reassign 過的，補送一次 Signal（workflow 端冪等）。 */
  private async explainNotReassignable(taskId: string): Promise<never> {
    const [task] = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task) throw new NotFoundException('找不到這個 Task');
    if (task.status === 'completed') {
      const by = task.completedBy
        ? (await participantNames(this.db, [task.completedBy])).get(task.completedBy)
        : undefined;
      throw new ConflictException(`已由 ${by ?? '其他人'} 處理，不能 Reassign。`);
    }
    const [replacement] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.replacesTaskId, taskId));
    if (replacement) {
      await this.signalReassigned(task.requestId, { taskId, newTaskId: replacement.id });
      throw new ConflictException('這個 Task 已經 Reassign 過了，請重新整理後再試。');
    }
    throw new ConflictException('這個 Task 已經作廢，不需要 Reassign。');
  }

  /**
   * 沿著 replacesTaskId 往回，把這一步每一次的 Reassign 都再送一次 Signal。
   * Escalation 也會留下 replacesTaskId，但那是 workflow 自己做的轉交，不需要（也不應該）送 reassign Signal：
   * 只有時間軸記錄為 task.reassigned 的那一段才補送，其他段照樣往回走。
   */
  private async resendReassigned(requestId: string, taskId: string): Promise<void> {
    const seen = new Set<string>();
    for (let current = taskId; !seen.has(current); ) {
      seen.add(current);
      const [row] = await this.db
        .select({ replacesTaskId: tasks.replacesTaskId, reassignedBy: requestEvents.id })
        .from(tasks)
        .leftJoin(
          requestEvents,
          and(eq(requestEvents.taskId, tasks.id), eq(requestEvents.type, 'task.reassigned')),
        )
        .where(eq(tasks.id, current));
      if (!row?.replacesTaskId) return;
      if (row.reassignedBy !== null)
        await this.signalReassigned(requestId, { taskId: row.replacesTaskId, newTaskId: current });
      current = row.replacesTaskId;
    }
  }

  private async signalReassigned(requestId: string, signal: ReassignSignal) {
    try {
      await this.temporal.workflow.getHandle(requestId).signal(REASSIGN_SIGNAL, signal);
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) throw error;
    }
  }

  /** workflow 已經結束時（例如重送的是最後一步的 Signal）不需要再通知它。 */
  private async signalCompleted(requestId: string, taskId: string, outcome: TaskOutcome) {
    const signal: TaskCompletedSignal = { taskId, outcome };
    try {
      await this.temporal.workflow.getHandle(requestId).signal(TASK_COMPLETED_SIGNAL, signal);
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) throw error;
    }
  }

  /**
   * 樂觀鎖沒有更新到任何一列時，說明原因。
   * Task 已由自己完成時（例如上一次的 Signal 送出失敗後重試）再送一次 Signal：workflow 端冪等，
   * 萬一上一次沒送到，Request 才不會一直停在「處理中」。
   */
  private async explainConflict(taskId: string, me: ActiveParticipant): Promise<never> {
    const [task] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), assignedToOrHandledBy(this.db, me.id)));
    if (!task) throw new NotFoundException('找不到這個 Task');
    if (task.status === 'superseded') {
      const [request] = await this.db
        .select({ status: requests.status })
        .from(requests)
        .where(eq(requests.id, task.requestId));
      if (request?.status === 'withdrawn')
        throw new ConflictException('發起人已撤回這筆 Request，這個 Task 不需要再處理。');
      if (request?.status === 'cancelled')
        throw new ConflictException(
          'Administrator 已 Cancel 這筆 Request，這個 Task 不需要再處理。',
        );
      const [replacement] = await this.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.replacesTaskId, taskId));
      throw new ConflictException(
        replacement
          ? '這個 Task 已經 Reassign 給其他人，不需要再處理。'
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
