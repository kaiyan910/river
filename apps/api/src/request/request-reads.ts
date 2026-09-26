import { Inject, Injectable } from '@nestjs/common';
import type {
  Initiator,
  MyTask,
  MyTasksStatus,
  RequestDetail,
  RequestEvent,
  RequestSummary,
  RequestTask,
} from '@river/contracts';
import {
  type Database,
  participants,
  processes,
  processVersions,
  requestData,
  requestEvents,
  requests,
  serviceAccounts,
  tasks,
} from '@river/db';
import { formIdOf, type TaskAssignee } from '@river/dsl';
import { personRefs } from '@river/forms';
import { and, asc, desc, eq, inArray, isNotNull, max, type SQL } from 'drizzle-orm';
import { type Viewer, visibleTo } from '../auth/data-access.js';
import {
  assigneeRef,
  assigneesOf,
  lookupNames,
  type Names,
  stepsOf,
} from '../process/processes.service.js';
import { DATABASE } from '../tokens.js';
import { assignedTo, taskAssignee } from './task-access.js';

type TaskRow = typeof tasks.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * 判斷暫停用的事件：HTTP 節點重試全部失敗時寫入 step.http_failed，Administrator 重試寫入 request.retried，
 * 重新送出（從頭再跑）寫入 request.resubmitted。最後一筆是 step.http_failed、而且 Request 仍是 running 就是暫停中。
 */
const PAUSE_EVENTS = ['step.http_failed', 'request.retried', 'request.resubmitted'] as const;

const actor = (names: Names, id: string) => ({ id, name: names.people.get(id) ?? '' });
const iso = (d: Date) => d.toISOString();

/** 「我的申請」「我的待辦」與 Request 明細共用的讀取。人名與 Role 名稱一律由 ID 查出。 */
@Injectable()
export class RequestReads {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** 某位 Participant 發起的 Request，新的在前。 */
  mine(initiatorId: string): Promise<RequestSummary[]> {
    return this.summaries(eq(requests.initiatorId, initiatorId));
  }

  /** 某個 Service Account 透過外部 API 發起的 Request（不論有沒有帶 on_behalf_of），新的在前。 */
  startedBy(serviceAccountId: string): Promise<RequestSummary[]> {
    return this.summaries(eq(requests.serviceAccountId, serviceAccountId));
  }

  /** 看得到的所有 Request（見 visibleTo），新的在前。 */
  visible(viewer: Viewer): Promise<RequestSummary[]> {
    return this.summaries(visibleTo(this.db, viewer));
  }

  /**
   * open：指派給我、或指派給我所屬 Role 的 Task；Role 的 Task 被任一成員完成後就從所有人的清單消失。
   * completed：我實際處理過的 Task。
   */
  myTasks(participantId: string, status: MyTasksStatus): Promise<MyTask[]> {
    return status === 'open'
      ? this.tasksWhere(
          and(assignedTo(this.db, participantId), eq(tasks.status, 'open')),
          desc(tasks.createdAt),
        )
      : this.tasksWhere(
          and(eq(tasks.completedBy, participantId), eq(tasks.status, 'completed')),
          desc(tasks.completedAt),
        );
  }

  /** 直接指派給這位 Participant 的 open Task（不含指派給他所屬 Role 的）；停用前預覽影響範圍用。 */
  directOpenTasks(participantId: string): Promise<MyTask[]> {
    return this.tasksWhere(
      and(eq(tasks.assigneeId, participantId), eq(tasks.status, 'open')),
      asc(tasks.createdAt),
    );
  }

  /** 「待 Reassign」清單：直接指派給已停用 Participant 的 open Task，先進來的在前。 */
  pendingReassign(): Promise<MyTask[]> {
    const deactivated = this.db
      .select({ id: participants.id })
      .from(participants)
      .where(isNotNull(participants.deactivatedAt));
    return this.tasksWhere(
      and(inArray(tasks.assigneeId, deactivated), eq(tasks.status, 'open')),
      asc(tasks.createdAt),
    );
  }

  async task(taskId: string): Promise<MyTask | undefined> {
    const [task] = await this.tasksWhere(eq(tasks.id, taskId), asc(tasks.createdAt));
    return task;
  }

  /** 尚未結束（running 或 returned）的所有 Request，新的在前；Cancel 與 Reassign 用。 */
  active(): Promise<RequestSummary[]> {
    return this.summaries(inArray(requests.status, ['running', 'returned']));
  }

  /** Request 暫停在哪一個 HTTP 節點（最後一筆 step.http_failed）；沒有暫停時為 undefined。不檢查 Request 的狀態。 */
  async pausedAt(
    db: Database | Tx,
    requestId: string,
  ): Promise<{ nodeId: string; reason: string; at: Date } | undefined> {
    const [last] = await db
      .select({
        type: requestEvents.type,
        nodeId: requestEvents.nodeId,
        comment: requestEvents.comment,
        at: requestEvents.at,
      })
      .from(requestEvents)
      .where(
        and(eq(requestEvents.requestId, requestId), inArray(requestEvents.type, [...PAUSE_EVENTS])),
      )
      .orderBy(desc(requestEvents.id))
      .limit(1);
    if (last?.type !== 'step.http_failed' || !last.nodeId) return undefined;
    return { nodeId: last.nodeId, reason: last.comment ?? '', at: last.at };
  }

  async summary(requestId: string): Promise<RequestSummary | undefined> {
    const [summary] = await this.summaries(eq(requests.id, requestId));
    return summary;
  }

  private pausedOf(running: { id: string }[]) {
    return pausedOfRows(this.db, running);
  }

  private async tasksWhere(where: SQL | undefined, order: SQL): Promise<MyTask[]> {
    const rows = await this.db.select().from(tasks).where(where).orderBy(order);
    if (rows.length === 0) return [];
    const summaries = await this.summaries(
      inArray(
        requests.id,
        rows.map((t) => t.requestId),
      ),
    );
    const byId = new Map(summaries.map((s) => [s.id, s]));
    const names = await lookupNames(this.db, rows.flatMap(taskPeople));
    return rows.flatMap((t) => {
      const r = byId.get(t.requestId);
      if (!r) return [];
      const { id, number, title, status, process, initiator, serviceAccount } = r;
      return [
        {
          ...toTask(t, names),
          request: { id, number, title, status, process, initiator, serviceAccount },
        },
      ];
    });
  }

  /**
   * 看得到這筆 Request 的人（見 visibleTo）才讀得到；其他人（包括不存在的 Request）回 undefined。
   * 看得到的人也看得到每一步填寫的 Form 資料（唯讀）；只顯示目前這一輪的資料，
   * Task 與時間軸則保留每一輪的紀錄。
   */
  async detail(requestId: string, viewer: Viewer): Promise<RequestDetail | undefined> {
    const [summary] = await this.summaries(
      and(eq(requests.id, requestId), visibleTo(this.db, viewer)),
    );
    if (!summary) return undefined;
    const taskRows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.requestId, requestId))
      .orderBy(asc(tasks.createdAt));

    const [current] = await this.db
      .select({ dsl: processVersions.dsl, round: requests.round })
      .from(requests)
      .innerJoin(processVersions, eq(processVersions.id, requests.processVersionId))
      .where(eq(requests.id, requestId));
    const round = current?.round ?? 1;
    const eventRows = await this.db
      .select()
      .from(requestEvents)
      .where(eq(requestEvents.requestId, requestId))
      .orderBy(asc(requestEvents.id));
    const dataRows = await this.db
      .select()
      .from(requestData)
      .where(and(eq(requestData.requestId, requestId), eq(requestData.round, round)))
      .orderBy(asc(requestData.submittedAt));

    const dsl = current?.dsl ?? { nodes: [], edges: [], forms: [] };
    // 每一步的人員選擇器（包括明細表裡的）選到的人，唯讀顯示時帶出姓名。
    const picked = dataRows.map((d) => {
      const form = dsl.forms.find((f) => f.id === d.formId);
      return form ? [...new Set(personRefs(form, d.data).map((r) => r.id))] : [];
    });
    const names = await lookupNames(this.db, [
      ...picked.flat(),
      ...taskRows.flatMap(taskPeople),
      ...eventRows.flatMap((e) => (e.actorId ? [e.actorId] : [])),
      ...dataRows.flatMap((d) => (d.submittedBy ? [d.submittedBy] : [])),
      ...assigneesOf(dsl),
    ]);
    const nodeNames = new Map(dsl.nodes.map((n) => [n.id, n.name]));
    const usedForms = new Set(dsl.nodes.map(formIdOf));
    const taskById = new Map(taskRows.map((t) => [t.id, t]));
    const chosenEdge = (edgeId: string | null) => {
      const edge = dsl.edges.find((d) => d.id === edgeId);
      return edge
        ? {
            id: edge.id,
            branch: edge.branch ?? null,
            target: { id: edge.target, name: nodeNames.get(edge.target) ?? edge.target },
          }
        : null;
    };
    // Service Account 沒有代表任何人發起時，發起與開始表單都算在它身上。
    const initiator = { id: summary.initiator.id, name: summary.initiator.name };
    const events: RequestEvent[] = eventRows.map((e) => {
      const task = e.taskId ? taskById.get(e.taskId) : undefined;
      return {
        id: e.id,
        type: e.type,
        at: iso(e.at),
        actor: e.actorId
          ? actor(names, e.actorId)
          : e.type === 'request.started'
            ? initiator
            : null,
        task: task
          ? {
              id: task.id,
              nodeName: task.nodeName,
              kind: task.kind,
              assignee: assigneeRef(names, taskAssignee(task)),
            }
          : null,
        comment: e.comment,
        fallbackReason: e.fallbackReason,
        node: e.nodeId ? { id: e.nodeId, name: nodeNames.get(e.nodeId) ?? e.nodeId } : null,
        edge: chosenEdge(e.edgeId),
      };
    });
    return {
      ...summary,
      round,
      steps: stepsOf(dsl, names),
      flow: {
        nodes: dsl.nodes.map(({ id, type, name, position }) => ({ id, type, name, position })),
        edges: dsl.edges.map(({ id, source, target, branch }) => ({
          id,
          source,
          target,
          branch: branch ?? null,
        })),
      },
      forms: dsl.forms.filter((f) => usedForms.has(f.id)),
      data: dataRows.map((d, i) => ({
        nodeId: d.nodeId,
        nodeName: nodeNames.get(d.nodeId) ?? d.nodeId,
        formId: d.formId,
        data: d.data,
        people: (picked[i] ?? []).map((id) => actor(names, id)),
        submittedBy: d.submittedBy ? actor(names, d.submittedBy) : initiator,
        submittedAt: iso(d.submittedAt),
      })),
      tasks: taskRows.map((t) => toTask(t, names)),
      events,
    };
  }

  private async summaries(where: SQL | undefined): Promise<RequestSummary[]> {
    const lastEvent = this.db
      .select({ requestId: requestEvents.requestId, at: max(requestEvents.at).as('last_event_at') })
      .from(requestEvents)
      .groupBy(requestEvents.requestId)
      .as('last_event');
    const rows = await this.db
      .select({
        id: requests.id,
        number: requests.number,
        title: requests.title,
        status: requests.status,
        initiatorId: requests.initiatorId,
        serviceAccountId: serviceAccounts.id,
        serviceAccountName: serviceAccounts.name,
        createdAt: requests.createdAt,
        processId: processes.id,
        processName: processes.name,
        version: processVersions.version,
        updatedAt: lastEvent.at,
      })
      .from(requests)
      .innerJoin(processVersions, eq(processVersions.id, requests.processVersionId))
      .innerJoin(processes, eq(processes.id, processVersions.processId))
      .leftJoin(serviceAccounts, eq(serviceAccounts.id, requests.serviceAccountId))
      .leftJoin(lastEvent, eq(lastEvent.requestId, requests.id))
      .where(where)
      .orderBy(desc(requests.createdAt));
    if (rows.length === 0) return [];

    const open = await this.db
      .select()
      .from(tasks)
      .where(
        and(
          inArray(
            tasks.requestId,
            rows.map((r) => r.id),
          ),
          eq(tasks.status, 'open'),
        ),
      )
      .orderBy(asc(tasks.createdAt));
    // 被 Return 的 Request：最後一個 Return 的 Task 帶著意見。
    const returnedIds = rows.filter((r) => r.status === 'returned').map((r) => r.id);
    const returnedTasks = returnedIds.length
      ? await this.db
          .select()
          .from(tasks)
          .where(and(inArray(tasks.requestId, returnedIds), eq(tasks.outcome, 'returned')))
          .orderBy(desc(tasks.completedAt))
      : [];
    const names = await lookupNames(this.db, [
      ...rows.flatMap((r) => (r.initiatorId ? [r.initiatorId] : [])),
      ...open.map(taskAssignee),
      ...returnedTasks.flatMap(taskPeople),
    ]);
    const paused = await this.pausedOf(rows.filter((r) => r.status === 'running'));
    return rows.map((r) => {
      const serviceAccount = r.serviceAccountId
        ? { id: r.serviceAccountId, name: r.serviceAccountName ?? '' }
        : null;
      const initiator: Initiator = r.initiatorId
        ? { type: 'participant', ...actor(names, r.initiatorId) }
        : {
            type: 'service_account',
            id: serviceAccount?.id ?? '',
            name: serviceAccount?.name ?? '',
          };
      return {
        id: r.id,
        number: r.number,
        title: r.title,
        status: r.status,
        process: { id: r.processId, name: r.processName, version: r.version },
        initiator,
        serviceAccount,
        openTasks: open
          .filter((t) => t.requestId === r.id)
          .map((t) => ({
            id: t.id,
            nodeName: t.nodeName,
            assignee: assigneeRef(names, taskAssignee(t)),
          })),
        returned: returnedOf(
          returnedTasks.find((t) => t.requestId === r.id),
          names,
        ),
        paused: paused.get(r.id) ?? null,
        createdAt: iso(r.createdAt),
        updatedAt: iso(r.updatedAt ?? r.createdAt),
      };
    });
  }
}

/** 暫停中的 Request（見 PAUSE_EVENTS）：停在哪一步、原因與時間。 */
async function pausedOfRows(
  db: Database,
  running: { id: string }[],
): Promise<Map<string, NonNullable<RequestSummary['paused']>>> {
  const result = new Map<string, NonNullable<RequestSummary['paused']>>();
  if (running.length === 0) return result;
  const events = await db
    .select({
      requestId: requestEvents.requestId,
      type: requestEvents.type,
      nodeId: requestEvents.nodeId,
      comment: requestEvents.comment,
      at: requestEvents.at,
      dsl: processVersions.dsl,
    })
    .from(requestEvents)
    .innerJoin(requests, eq(requests.id, requestEvents.requestId))
    .innerJoin(processVersions, eq(processVersions.id, requests.processVersionId))
    .where(
      and(
        inArray(
          requestEvents.requestId,
          running.map((r) => r.id),
        ),
        inArray(requestEvents.type, [...PAUSE_EVENTS]),
      ),
    )
    .orderBy(desc(requestEvents.id));
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.requestId)) continue;
    seen.add(e.requestId);
    if (e.type !== 'step.http_failed' || !e.nodeId) continue;
    result.set(e.requestId, {
      nodeId: e.nodeId,
      nodeName: e.dsl.nodes.find((n) => n.id === e.nodeId)?.name ?? e.nodeId,
      reason: e.comment ?? '',
      at: iso(e.at),
    });
  }
  return result;
}

function returnedOf(t: TaskRow | undefined, names: Names): RequestSummary['returned'] {
  if (!t?.completedBy || !t.completedAt) return null;
  return {
    by: actor(names, t.completedBy),
    nodeName: t.nodeName,
    comment: t.comment ?? '',
    at: iso(t.completedAt),
  };
}

/** Task 的指派對象與實際處理的人。 */
function taskPeople(t: TaskRow): (string | TaskAssignee)[] {
  return t.completedBy ? [taskAssignee(t), t.completedBy] : [taskAssignee(t)];
}

function toTask(t: TaskRow, names: Names): RequestTask {
  return {
    id: t.id,
    nodeId: t.nodeId,
    nodeName: t.nodeName,
    kind: t.kind,
    assignee: assigneeRef(names, taskAssignee(t)),
    status: t.status,
    outcome: t.outcome,
    comment: t.comment,
    completedBy: t.completedBy ? actor(names, t.completedBy) : null,
    completedAt: t.completedAt ? iso(t.completedAt) : null,
    version: t.version,
    round: t.round,
    replacesTaskId: t.replacesTaskId,
    createdAt: iso(t.createdAt),
  };
}
