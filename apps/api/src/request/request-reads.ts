import { Inject, Injectable } from '@nestjs/common';
import type {
  MyTask,
  MyTasksStatus,
  RequestDetail,
  RequestEvent,
  RequestSummary,
  RequestTask,
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
import { type Assignee, formIdOf } from '@river/dsl';
import { and, asc, desc, eq, inArray, max, type SQL } from 'drizzle-orm';
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

  /**
   * open：指派給我、或指派給我所屬 Role 的 Task；Role 的 Task 被任一成員完成後就從所有人的清單消失。
   * completed：我實際處理過的 Task。
   */
  async myTasks(participantId: string, status: MyTasksStatus): Promise<MyTask[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(
        status === 'open'
          ? and(assignedTo(this.db, participantId), eq(tasks.status, 'open'))
          : and(eq(tasks.completedBy, participantId), eq(tasks.status, 'completed')),
      )
      .orderBy(status === 'open' ? desc(tasks.createdAt) : desc(tasks.completedAt));
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
      const { id, number, title, status, process, initiator } = r;
      return [{ ...toTask(t, names), request: { id, number, title, status, process, initiator } }];
    });
  }

  /**
   * 發起人與經手的審批人、填表人（包括指派 Role 的成員）看得到；其他人（包括不存在的 Request）回 undefined。
   * 看得到的人也看得到每一步填寫的 Form 資料（唯讀）；只顯示目前這一輪的資料，
   * Task 與時間軸則保留每一輪的紀錄。
   */
  async detail(requestId: string, viewerId: string): Promise<RequestDetail | undefined> {
    const [summary] = await this.summaries(eq(requests.id, requestId));
    if (!summary) return undefined;
    const taskRows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.requestId, requestId))
      .orderBy(asc(tasks.createdAt));
    if (
      summary.initiator.id !== viewerId &&
      !taskRows.some((t) => t.completedBy === viewerId) &&
      !(await this.isAssignedTo(requestId, viewerId))
    )
      return undefined;

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
    const names = await lookupNames(this.db, [
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
              assignee: assigneeRef(names, taskAssignee(task)),
            }
          : null,
        comment: e.comment,
      };
    });
    return {
      ...summary,
      round,
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

  private async isAssignedTo(requestId: string, participantId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.requestId, requestId), assignedTo(this.db, participantId)))
      .limit(1);
    return !!row;
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
      ...rows.map((r) => r.initiatorId),
      ...open.map(taskAssignee),
      ...returnedTasks.flatMap(taskPeople),
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
        .map((t) => ({
          id: t.id,
          nodeName: t.nodeName,
          assignee: assigneeRef(names, taskAssignee(t)),
        })),
      returned: returnedOf(
        returnedTasks.find((t) => t.requestId === r.id),
        names,
      ),
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt ?? r.createdAt),
    }));
  }
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
function taskPeople(t: TaskRow): (string | Assignee)[] {
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
    createdAt: iso(t.createdAt),
  };
}
