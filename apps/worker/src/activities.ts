import {
  type Database,
  type FallbackReason,
  participants,
  processVersions,
  requestData,
  requestEvents,
  requests,
  type TaskKind,
  tasks,
} from '@river/db';
import type { ProcessDsl } from '@river/dsl';
import { chooseBranch } from '@river/dsl/branch';
import { ApplicationFailure, log } from '@temporalio/activity';
import { and, asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

export interface CreateTaskInput {
  requestId: string;
  /** 由 workflow 產生；activity 重試時用同一個 ID，Task 與事件都不會重複。 */
  taskId: string;
  nodeId: string;
  nodeName: string;
  kind: TaskKind;
  /**
   * 指派對象剛好有一個：特定 Participant、Role，或發起人的 Manager（找不到有效的 Manager 時改派給 Fallback Role）。
   * 欄位名稱沿用舊版，執行中的 activity 重試時仍然相容。
   */
  assigneeId?: string;
  roleId?: string;
  initiatorManager?: { fallbackRoleId: string };
}

export interface EvaluateConditionInput {
  requestId: string;
  processVersionId: string;
  /** 條件節點的 ID。 */
  nodeId: string;
}

const managers = alias(participants, 'managers');

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
     * 指派給發起人的 Manager 時，在建立 Task 的當下決定處理人，之後換 Manager 不影響已經建立的 Task。
     */
    async createTask(input: CreateTaskInput): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select({
            status: requests.status,
            round: requests.round,
            initiatorId: requests.initiatorId,
          })
          .from(requests)
          .where(eq(requests.id, input.requestId))
          .for('update');
        if (!request) throw new Error(`找不到 Request ${input.requestId}`);
        if (request.status !== 'running') return false;
        const assignment = input.initiatorManager
          ? await resolveManager(tx, request.initiatorId, input.initiatorManager.fallbackRoleId)
          : { assigneeId: input.assigneeId ?? null, roleId: input.roleId ?? null };
        const [created] = await tx
          .insert(tasks)
          .values({
            id: input.taskId,
            requestId: input.requestId,
            nodeId: input.nodeId,
            nodeName: input.nodeName,
            kind: input.kind,
            round: request.round,
            assigneeId: assignment.assigneeId,
            roleId: assignment.roleId,
          })
          .onConflictDoNothing({ target: tasks.id })
          .returning({ id: tasks.id });
        if (created)
          await tx.insert(requestEvents).values({
            requestId: input.requestId,
            type: 'task.created',
            taskId: input.taskId,
            fallbackReason: assignment.fallbackReason ?? null,
          });
        return true;
      });
    },

    /**
     * 從 Postgres 讀取條件節點的出邊與這一輪填過的 Form 資料，執行 JSONata，只回傳選中的出邊 ID：
     * Form 資料與表達式的結果都不進 Temporal history，表達式用到 $now() 也不影響 workflow 的 determinism。
     * 同一個欄位代碼在多份 Form 都出現時，以最後填寫的為準。
     */
    async evaluateCondition(input: EvaluateConditionInput): Promise<string> {
      const [version] = await db
        .select({ dsl: processVersions.dsl })
        .from(processVersions)
        .where(eq(processVersions.id, input.processVersionId));
      if (!version)
        throw ApplicationFailure.nonRetryable(`找不到 Process Version ${input.processVersionId}`);
      const [request] = await db
        .select({ round: requests.round })
        .from(requests)
        .where(eq(requests.id, input.requestId));
      if (!request) throw new Error(`找不到 Request ${input.requestId}`);
      const rows = await db
        .select({ data: requestData.data })
        .from(requestData)
        .where(
          and(eq(requestData.requestId, input.requestId), eq(requestData.round, request.round)),
        )
        .orderBy(asc(requestData.submittedAt));
      const data = Object.assign({}, ...rows.map((r) => r.data));

      const outgoing = version.dsl.edges.filter((e) => e.source === input.nodeId);
      // 只記錄出錯的出邊與 JSONata 的錯誤代碼，不記錄 Form 資料。
      const edgeId = await chooseBranch(outgoing, data, (id, error) =>
        log.warn('條件表達式執行失敗，視為不成立', {
          requestId: input.requestId,
          nodeId: input.nodeId,
          edgeId: id,
          code: (error as { code?: unknown } | null)?.code,
        }),
      );
      // 發佈前檢查（CONDITION_NO_DEFAULT）已經擋下；萬一出現，寧可讓 workflow 失敗也不要亂走。
      if (!edgeId) throw ApplicationFailure.nonRetryable(`條件節點 ${input.nodeId} 沒有預設出邊`);
      return edgeId;
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

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

interface Assignment {
  assigneeId: string | null;
  roleId: string | null;
  fallbackReason?: FallbackReason;
}

/** 發起人有有效（沒有停用）的 Manager 時指派給 Manager，否則改派給 Fallback Role 並記下原因。 */
async function resolveManager(
  tx: Tx,
  initiatorId: string,
  fallbackRoleId: string,
): Promise<Assignment> {
  const [row] = await tx
    .select({ managerId: participants.managerId, deactivatedAt: managers.deactivatedAt })
    .from(participants)
    .leftJoin(managers, eq(managers.id, participants.managerId))
    .where(eq(participants.id, initiatorId));
  if (row?.managerId && !row.deactivatedAt) return { assigneeId: row.managerId, roleId: null };
  return {
    assigneeId: null,
    roleId: fallbackRoleId,
    fallbackReason: row?.managerId ? 'manager_deactivated' : 'no_manager',
  };
}
