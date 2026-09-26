import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CancelRequestInput,
  RequestDetail,
  RequestSummary,
  ResubmitRequestInput,
  StartRequestInput,
  WithdrawRequestInput,
} from '@river/contracts';
import {
  CANCEL_SIGNAL,
  INTERPRET_PROCESS_WORKFLOW,
  type InterpretProcessInput,
  RESUBMITTED_SIGNAL,
  type ResubmittedSignal,
  WITHDRAW_SIGNAL,
} from '@river/contracts/workflow';
import { type Database, processVersions, requestEvents, requests } from '@river/db';
import { Client, WorkflowNotFoundError } from '@temporalio/client';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { canStart, currentVersions, startFormOf } from '../process/processes.service.js';
import { DATABASE, TEMPORAL_CLIENT, TEMPORAL_TASK_QUEUE } from '../tokens.js';
import { saveStepData, validateStepData } from './form-data.js';
import { RequestReads } from './request-reads.js';
import { supersedeOpenTasks } from './supersede.js';

@Injectable()
export class RequestsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    @Inject(TEMPORAL_TASK_QUEUE) private readonly taskQueue: string,
    private readonly reads: RequestReads,
  ) {}

  /**
   * 以 Process 的目前版本發起 Request，並啟動 workflow ID 等於 Request ID 的 interpreter workflow。
   * Process 設定了 Initiator Role 時，只有其成員可以發起，其他人回 403。
   * 開始表單的資料先依 Process Version 裡的 Form 驗證，和 Request 一起存進 request_data；
   * workflow 的輸入只有 ID，不帶任何表單資料。
   * workflow 在 transaction 提交前啟動：啟動失敗時 Request 不會留下；
   * 萬一 workflow 的 activity 比提交早執行，讀不到 Request 會重試。
   */
  async start(input: StartRequestInput, me: ActiveParticipant): Promise<RequestDetail> {
    const [current] = await currentVersions(this.db, input.processId);
    if (!current) throw new NotFoundException('找不到可以發起的 Process');
    if (!(await canStart(this.db, input.processId, me.id)))
      throw new ForbiddenException('你不在這個 Process 的 Initiator Role 裡，不能發起');
    const submission = validateStepData(startFormOf(current.dsl), input.data);
    const startNode = current.dsl.nodes.find((n) => n.type === 'start');

    const requestId = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(requests)
        .values({ processVersionId: current.versionId, initiatorId: me.id, title: input.title })
        .returning({ id: requests.id });
      if (!created) throw new Error('建立 Request 失敗');
      await tx
        .insert(requestEvents)
        .values({ requestId: created.id, type: 'request.started', actorId: me.id });
      if (startNode)
        await saveStepData(tx, submission, {
          requestId: created.id,
          nodeId: startNode.id,
          submittedBy: me.id,
          round: 1,
        });

      const workflowInput: InterpretProcessInput = {
        requestId: created.id,
        processVersionId: current.versionId,
      };
      await this.temporal.workflow.start(INTERPRET_PROCESS_WORKFLOW, {
        taskQueue: this.taskQueue,
        workflowId: created.id,
        args: [workflowInput],
      });
      return created.id;
    });
    return this.detail(requestId, me);
  }

  /**
   * 發起人修改被 Return 的 Request 後重新送出：以樂觀鎖（status = returned）把 Request 改回 running、
   * 輪次加 1，新的開始表單資料存成這一輪的一列，先前每一輪的資料都保留。
   * 提交後才送出 resubmitted Signal，workflow 從 Process 的開頭重新執行，所有審批都要重新進行。
   */
  async resubmit(
    id: string,
    input: ResubmitRequestInput,
    me: ActiveParticipant,
  ): Promise<RequestDetail> {
    const [request] = await this.db
      .select({ initiatorId: requests.initiatorId, dsl: processVersions.dsl })
      .from(requests)
      .innerJoin(processVersions, eq(processVersions.id, requests.processVersionId))
      .where(eq(requests.id, id));
    if (!request || request.initiatorId !== me.id)
      throw new NotFoundException('找不到這筆 Request');
    const submission = validateStepData(startFormOf(request.dsl), input.data);
    const startNode = request.dsl.nodes.find((n) => n.type === 'start');

    const round = await this.db.transaction(async (tx) => {
      const [resubmitted] = await tx
        .update(requests)
        .set({ status: 'running', round: sql`${requests.round} + 1`, title: input.title })
        .where(and(eq(requests.id, id), eq(requests.status, 'returned')))
        .returning({ round: requests.round });
      if (!resubmitted) return undefined;
      await tx
        .insert(requestEvents)
        .values({ requestId: id, type: 'request.resubmitted', actorId: me.id });
      if (startNode)
        await saveStepData(tx, submission, {
          requestId: id,
          nodeId: startNode.id,
          submittedBy: me.id,
          round: resubmitted.round,
        });
      return resubmitted.round;
    });
    if (round === undefined) return this.explainNotChangeable(id, 'resubmit', me);

    await this.signalResubmitted(id, round);
    return this.detail(id, me);
  }

  /**
   * Request 完成之前（running 或 returned），發起人可以 Withdraw。
   * 先鎖住並更新 Request，再把 open 的 Task 全部作廢（和 createTask activity 同樣的鎖定順序），
   * 提交後才送出 withdraw Signal，workflow 收到後結束。
   */
  async withdraw(
    id: string,
    input: WithdrawRequestInput,
    me: ActiveParticipant,
  ): Promise<RequestDetail> {
    const withdrawn = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(requests)
        .set({ status: 'withdrawn' })
        .where(
          and(
            eq(requests.id, id),
            eq(requests.initiatorId, me.id),
            inArray(requests.status, ['running', 'returned']),
          ),
        )
        .returning({ id: requests.id });
      if (!updated) return false;
      await tx.insert(requestEvents).values({
        requestId: id,
        type: 'request.withdrawn',
        actorId: me.id,
        comment: input.comment || null,
      });
      await supersedeOpenTasks(tx, id);
      return true;
    });
    if (!withdrawn) return this.explainNotChangeable(id, 'withdraw', me);

    await this.signalEnded(id, WITHDRAW_SIGNAL);
    return this.detail(id, me);
  }

  /**
   * Administrator 強制終止尚未完成（running 或 returned）的 Request，原因必填。
   * 和 Withdraw 一樣：先鎖住並更新 Request，再把 open 的 Task 全部作廢，提交後才送出 cancel Signal，workflow 收到後結束。
   * 資料與歷程都保留；Cancel 的人不一定看得到 Request 明細，所以回傳清單上的一列。
   */
  async cancel(
    id: string,
    input: CancelRequestInput,
    me: ActiveParticipant,
  ): Promise<RequestSummary> {
    const cancelled = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(requests)
        .set({ status: 'cancelled' })
        .where(and(eq(requests.id, id), inArray(requests.status, ['running', 'returned'])))
        .returning({ id: requests.id });
      if (!updated) return false;
      await tx.insert(requestEvents).values({
        requestId: id,
        type: 'request.cancelled',
        actorId: me.id,
        comment: input.comment,
      });
      await supersedeOpenTasks(tx, id);
      return true;
    });
    if (!cancelled) {
      const [request] = await this.db
        .select({ status: requests.status })
        .from(requests)
        .where(eq(requests.id, id));
      if (!request) throw new NotFoundException('找不到這筆 Request');
      // 上一次其實已經成功（例如 Signal 送出失敗後重試）：再送一次 Signal，workflow 端冪等。
      if (request.status === 'cancelled') await this.signalEnded(id, CANCEL_SIGNAL);
      const reasons: Record<string, string> = {
        completed: '這筆 Request 已經完成，不能 Cancel。',
        withdrawn: '發起人已經撤回這筆 Request。',
        cancelled: '這筆 Request 已經 Cancel。',
      };
      throw new ConflictException(reasons[request.status] ?? '這筆 Request 目前不能 Cancel。');
    }

    await this.signalEnded(id, CANCEL_SIGNAL);
    const summary = await this.reads.summary(id);
    if (!summary) throw new NotFoundException('找不到這筆 Request');
    return summary;
  }

  /** 尚未結束的所有 Request：持有 request.cancel 或 task.reassign 的人處理例外狀況用。 */
  active(): Promise<RequestSummary[]> {
    return this.reads.active();
  }

  mine(me: ActiveParticipant): Promise<RequestSummary[]> {
    return this.reads.mine(me.id);
  }

  visible(me: ActiveParticipant): Promise<RequestSummary[]> {
    return this.reads.visible(me);
  }

  async detail(id: string, me: ActiveParticipant): Promise<RequestDetail> {
    const detail = await this.reads.detail(id, me);
    if (!detail) throw new NotFoundException('找不到這筆 Request');
    return detail;
  }

  /**
   * 重新送出或 Withdraw 沒有更新到 Request 時，說明原因。
   * 狀態顯示上一次其實已經成功（例如 Signal 送出失敗後重試），就再送一次 Signal：workflow 端冪等。
   */
  private async explainNotChangeable(
    id: string,
    action: 'resubmit' | 'withdraw',
    me: ActiveParticipant,
  ): Promise<never> {
    const [request] = await this.db
      .select({ status: requests.status, round: requests.round, initiatorId: requests.initiatorId })
      .from(requests)
      .where(eq(requests.id, id));
    if (!request || request.initiatorId !== me.id)
      throw new NotFoundException('找不到這筆 Request');
    if (action === 'resubmit' && request.status === 'running' && request.round > 1)
      await this.signalResubmitted(id, request.round);
    if (action === 'withdraw' && request.status === 'withdrawn')
      await this.signalEnded(id, WITHDRAW_SIGNAL);
    const verb = action === 'resubmit' ? '重新送出' : 'Withdraw';
    const reasons: Record<typeof request.status, string> = {
      running: '這筆 Request 正在進行中，不需要重新送出。',
      returned: '這筆 Request 已被 Return，請先修改後重新送出。',
      completed: `這筆 Request 已經完成，不能${verb}。`,
      withdrawn: '這筆 Request 已經撤回。',
      cancelled: '這筆 Request 已被 Administrator Cancel。',
    };
    throw new ConflictException(reasons[request.status]);
  }

  private async signalResubmitted(id: string, round: number): Promise<void> {
    const signal: ResubmittedSignal = { round };
    await this.temporal.workflow.getHandle(id).signal(RESUBMITTED_SIGNAL, signal);
  }

  /** Withdraw 或 Cancel。workflow 已經結束時（例如重送 Signal）不需要再通知它。 */
  private async signalEnded(
    id: string,
    signal: typeof WITHDRAW_SIGNAL | typeof CANCEL_SIGNAL,
  ): Promise<void> {
    try {
      await this.temporal.workflow.getHandle(id).signal(signal);
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) throw error;
    }
  }
}
