import {
  type Database,
  processVersions,
  requestEvents,
  requests,
  type TaskKind,
  tasks,
} from '@river/db';
import type { ProcessDsl } from '@river/dsl';
import { ApplicationFailure } from '@temporalio/activity';
import { and, eq, sql } from 'drizzle-orm';

export interface CreateTaskInput {
  requestId: string;
  /** 由 workflow 產生；activity 重試時用同一個 ID，Task 與事件都不會重複。 */
  taskId: string;
  nodeId: string;
  nodeName: string;
  kind: TaskKind;
  assigneeId: string;
}

/** interpreter 需要的流程圖；不含 Form schema，Temporal history 裡只有節點與連線。 */
export type ProcessGraph = Omit<ProcessDsl, 'forms'>;

/**
 * 每個 activity 都要能安全重試：寫入 Task 與 request_events 在同一個 transaction，
 * 而且只有真的改變狀態時才寫事件。
 */
export function createActivities(db: Database) {
  return {
    async checkDatabase(): Promise<void> {
      await db.execute(sql`select 1`);
    },

    /** Process Version 不可修改。只回傳節點與連線：回傳值會寫進 Temporal history，Form 一律不進去。 */
    async loadProcessVersion(processVersionId: string): Promise<ProcessGraph> {
      const [row] = await db
        .select({ dsl: processVersions.dsl })
        .from(processVersions)
        .where(eq(processVersions.id, processVersionId));
      if (!row) throw ApplicationFailure.nonRetryable(`找不到 Process Version ${processVersionId}`);
      return { nodes: row.dsl.nodes, edges: row.dsl.edges };
    },

    /**
     * 先鎖住 Request 再建立 Task（與 API 的 Return、Withdraw 同樣的鎖定順序）：
     * Request 已經不是 running（例如剛被 Withdraw）時不建立，免得留下沒人需要處理的 Task。
     * Task 記下 Request 目前的輪次。回傳 false 代表 Request 已經結束、沒有建立 Task。
     */
    async createTask(input: CreateTaskInput): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select({ status: requests.status, round: requests.round })
          .from(requests)
          .where(eq(requests.id, input.requestId))
          .for('update');
        if (!request) throw new Error(`找不到 Request ${input.requestId}`);
        if (request.status !== 'running') return false;
        const [created] = await tx
          .insert(tasks)
          .values({
            id: input.taskId,
            requestId: input.requestId,
            nodeId: input.nodeId,
            nodeName: input.nodeName,
            kind: input.kind,
            round: request.round,
            assigneeId: input.assigneeId,
          })
          .onConflictDoNothing({ target: tasks.id })
          .returning({ id: tasks.id });
        if (created)
          await tx
            .insert(requestEvents)
            .values({ requestId: input.requestId, type: 'task.created', taskId: input.taskId });
        return true;
      });
    },

    async completeRequest(requestId: string): Promise<void> {
      await db.transaction(async (tx) => {
        const [completed] = await tx
          .update(requests)
          .set({ status: 'completed' })
          .where(and(eq(requests.id, requestId), eq(requests.status, 'running')))
          .returning({ id: requests.id });
        if (!completed) return;
        await tx.insert(requestEvents).values({ requestId, type: 'request.completed' });
      });
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
