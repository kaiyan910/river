import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { RequestDetail, RequestSummary, StartRequestInput } from '@river/contracts';
import { INTERPRET_PROCESS_WORKFLOW, type InterpretProcessInput } from '@river/contracts/workflow';
import { type Database, requestEvents, requests } from '@river/db';
import { Client } from '@temporalio/client';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { currentVersions } from '../process/processes.service.js';
import { DATABASE, TEMPORAL_CLIENT, TEMPORAL_TASK_QUEUE } from '../tokens.js';
import { RequestReads } from './request-reads.js';

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
   * workflow 在 transaction 提交前啟動：啟動失敗時 Request 不會留下；
   * 萬一 workflow 的 activity 比提交早執行，讀不到 Request 會重試。
   */
  async start(input: StartRequestInput, me: ActiveParticipant): Promise<RequestDetail> {
    const [current] = await currentVersions(this.db, input.processId);
    if (!current) throw new NotFoundException('找不到可以發起的 Process');

    const requestId = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(requests)
        .values({ processVersionId: current.versionId, initiatorId: me.id, title: input.title })
        .returning({ id: requests.id });
      if (!created) throw new Error('建立 Request 失敗');
      await tx
        .insert(requestEvents)
        .values({ requestId: created.id, type: 'request.started', actorId: me.id });

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

  mine(me: ActiveParticipant): Promise<RequestSummary[]> {
    return this.reads.mine(me.id);
  }

  async detail(id: string, me: ActiveParticipant): Promise<RequestDetail> {
    const detail = await this.reads.detail(id, me.id);
    if (!detail) throw new NotFoundException('找不到這筆 Request');
    return detail;
  }
}
