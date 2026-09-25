import { Inject, Injectable } from '@nestjs/common';
import type {
  MyTask,
  RequestDetail,
  RequestEvent,
  RequestSummary,
  RequestTask,
  TaskStatus,
} from '@river/contracts';
import {
  type Database,
  processes,
  processVersions,
  requestData,
  requestEvents,
  requests,
  tasks,
} from '@river/db';
import { formIdOf } from '@river/dsl';
import { and, asc, desc, eq, inArray, max, type SQL } from 'drizzle-orm';
import { assigneesOf, participantNames, stepsOf } from '../process/processes.service.js';
import { DATABASE } from '../tokens.js';

type Names = Map<string, string>;
type TaskRow = typeof tasks.$inferSelect;

const actor = (names: Names, id: string) => ({ id, name: names.get(id) ?? '' });
const iso = (d: Date) => d.toISOString();

/** 「我的申請」「我的待辦」與 Request 明細共用的讀取。人名一律由 Participant ID 查出。 */
@Injectable()
export class RequestReads {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** 某位 Participant 發起的 Request，新的在前。 */
  mine(initiatorId: string): Promise<RequestSummary[]> {
    return this.summaries(eq(requests.initiatorId, initiatorId));
  }

  async myTasks(assigneeId: string, status: TaskStatus): Promise<MyTask[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.assigneeId, assigneeId), eq(tasks.status, status)))
      .orderBy(status === 'open' ? desc(tasks.createdAt) : desc(tasks.completedAt));
    const summaries = await this.summaries(
      inArray(
        requests.id,
        rows.map((t) => t.requestId),
      ),
    );
    const byId = new Map(summaries.map((s) => [s.id, s]));
    const names = await participantNames(this.db, rows.flatMap(taskPeople));
    return rows.flatMap((t) => {
      const r = byId.get(t.requestId);
      if (!r) return [];
      const { id, number, title, status, process, initiator } = r;
      return [{ ...toTask(t, names), request: { id, number, title, status, process, initiator } }];
    });
  }

  /**
   * 發起人與經手的審批人、填表人看得到；其他人（包括不存在的 Request）回 undefined。
   * 看得到的人也看得到每一步填寫的 Form 資料（唯讀）。
   */
  async detail(requestId: string, viewerId: string): Promise<RequestDetail | undefined> {
    const [summary] = await this.summaries(eq(requests.id, requestId));
    if (!summary) return undefined;
    const taskRows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.requestId, requestId))
      .orderBy(asc(tasks.createdAt));
    const involved =
      summary.initiator.id === viewerId ||
      taskRows.some((t) => t.assigneeId === viewerId || t.completedBy === viewerId);
    if (!involved) return undefined;

    const [version] = await this.db
      .select({ dsl: processVersions.dsl })
      .from(requests)
      .innerJoin(processVersions, eq(processVersions.id, requests.processVersionId))
      .where(eq(requests.id, requestId));
    const eventRows = await this.db
      .select()
      .from(requestEvents)
      .where(eq(requestEvents.requestId, requestId))
      .orderBy(asc(requestEvents.id));
    const dataRows = await this.db
      .select()
      .from(requestData)
      .where(eq(requestData.requestId, requestId))
      .orderBy(asc(requestData.submittedAt));

    const dsl = version?.dsl ?? { nodes: [], edges: [], forms: [] };
    const names = await participantNames(this.db, [
      ...taskRows.flatMap(taskPeople),
      ...eventRows.flatMap((e) => (e.actorId ? [e.actorId] : [])),
      ...dataRows.map((d) => d.submittedBy),
      ...assigneesOf(dsl),
    ]);
    const nodeNames = new Map(dsl.nodes.map((n) => [n.id, n.name]));
    const usedForms = new Set(dsl.nodes.map(formIdOf));
    const taskById = new Map(taskRows.map((t) => [t.id, t]));
    const events: RequestEvent[] = eventRows.map((e) => {
      const task = e.taskId ? taskById.get(e.taskId) : undefined;
      return {
        id: e.id,
        type: e.type,
        at: iso(e.at),
        actor: e.actorId ? actor(names, e.actorId) : null,
        task: task
          ? {
              id: task.id,
              nodeName: task.nodeName,
              kind: task.kind,
              assignee: actor(names, task.assigneeId),
            }
          : null,
        comment: e.comment,
      };
    });
    return {
      ...summary,
      steps: stepsOf(dsl, names),
      forms: dsl.forms.filter((f) => usedForms.has(f.id)),
      data: dataRows.map((d) => ({
        nodeId: d.nodeId,
        nodeName: nodeNames.get(d.nodeId) ?? d.nodeId,
        formId: d.formId,
        data: d.data,
        submittedBy: actor(names, d.submittedBy),
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
        createdAt: requests.createdAt,
        processId: processes.id,
        processName: processes.name,
        version: processVersions.version,
        updatedAt: lastEvent.at,
      })
      .from(requests)
      .innerJoin(processVersions, eq(processVersions.id, requests.processVersionId))
      .innerJoin(processes, eq(processes.id, processVersions.processId))
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
    const names = await participantNames(this.db, [
      ...rows.map((r) => r.initiatorId),
      ...open.map((t) => t.assigneeId),
    ]);
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      status: r.status,
      process: { id: r.processId, name: r.processName, version: r.version },
      initiator: actor(names, r.initiatorId),
      openTasks: open
        .filter((t) => t.requestId === r.id)
        .map((t) => ({ id: t.id, nodeName: t.nodeName, assignee: actor(names, t.assigneeId) })),
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt ?? r.createdAt),
    }));
  }
}

function taskPeople(t: TaskRow): string[] {
  return t.completedBy ? [t.assigneeId, t.completedBy] : [t.assigneeId];
}

function toTask(t: TaskRow, names: Names): RequestTask {
  return {
    id: t.id,
    nodeId: t.nodeId,
    nodeName: t.nodeName,
    kind: t.kind,
    assignee: actor(names, t.assigneeId),
    status: t.status,
    outcome: t.outcome,
    comment: t.comment,
    completedBy: t.completedBy ? actor(names, t.completedBy) : null,
    completedAt: t.completedAt ? iso(t.completedAt) : null,
    version: t.version,
    createdAt: iso(t.createdAt),
  };
}
