import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  AssigneeRef,
  Process,
  ProcessStep,
  ProcessSummary,
  ProcessVersion,
  PublishRejected,
  StartableProcess,
  StepAssignee,
} from '@river/contracts';
import {
  authUsers,
  type Database,
  participants,
  processes,
  processVersions,
  roles,
} from '@river/db';
import {
  type Assignee,
  checkProcess,
  formIdOf,
  initialProcessDsl,
  mainPath,
  type ProcessDsl,
  type ProcessNode,
  type TaskAssignee,
} from '@river/dsl';
import type { FormSchema } from '@river/forms';
import { asc, desc, eq, inArray, max } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { DATABASE } from '../tokens.js';

const draftSaver = alias(authUsers, 'draft_saver');
const draftSaverParticipant = alias(participants, 'draft_saver_participant');

/** 草稿與它的儲存時間、儲存者一起設定、一起清空。 */
const NO_DRAFT = { draft: null, draftSavedAt: null, draftSavedBy: null };

@Injectable()
export class ProcessesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(): Promise<ProcessSummary[]> {
    const rows = await this.db
      .select({
        id: processes.id,
        name: processes.name,
        draftSavedAt: processes.draftSavedAt,
        currentVersion: max(processVersions.version),
      })
      .from(processes)
      .leftJoin(processVersions, eq(processVersions.processId, processes.id))
      .groupBy(processes.id)
      .orderBy(asc(processes.name));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      currentVersion: r.currentVersion,
      draftSavedAt: r.draftSavedAt?.toISOString() ?? null,
    }));
  }

  /** 每個已發佈 Process 的目前版本與步驟預覽；還沒發佈過的 Process 不會出現。 */
  async startable(): Promise<StartableProcess[]> {
    const rows = await currentVersions(this.db);
    const names = await lookupNames(
      this.db,
      rows.flatMap((r) => assigneesOf(r.dsl)),
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      steps: stepsOf(r.dsl, names),
      startForm: startFormOf(r.dsl),
    }));
  }

  async get(id: string): Promise<Process> {
    const [row] = await this.db
      .select({
        id: processes.id,
        name: processes.name,
        draft: processes.draft,
        draftSavedAt: processes.draftSavedAt,
        draftSavedById: processes.draftSavedBy,
        draftSavedByName: draftSaver.name,
      })
      .from(processes)
      .leftJoin(draftSaverParticipant, eq(draftSaverParticipant.id, processes.draftSavedBy))
      .leftJoin(draftSaver, eq(draftSaver.id, draftSaverParticipant.userId))
      .where(eq(processes.id, id));
    if (!row) throw new NotFoundException('找不到這個 Process');

    const versions = await this.versions(id);
    const draft =
      row.draft && row.draftSavedAt && row.draftSavedById
        ? {
            dsl: row.draft,
            savedAt: row.draftSavedAt.toISOString(),
            savedBy: { id: row.draftSavedById, name: row.draftSavedByName ?? '' },
          }
        : null;
    return {
      id: row.id,
      name: row.name,
      draft,
      currentVersion: versions.at(-1)?.version ?? null,
      versions,
    };
  }

  /** 建立只有「開始」和「結束」的草稿。 */
  async create(name: string, me: ActiveParticipant): Promise<Process> {
    const [created] = await this.db
      .insert(processes)
      .values({ name, draft: initialProcessDsl(), draftSavedAt: new Date(), draftSavedBy: me.id })
      .onConflictDoNothing({ target: processes.name })
      .returning({ id: processes.id });
    if (!created) throw new ConflictException('已經有同名的 Process');
    return this.get(created.id);
  }

  async rename(id: string, name: string): Promise<Process> {
    await this.assertExists(id);
    const [same] = await this.db
      .select({ id: processes.id })
      .from(processes)
      .where(eq(processes.name, name));
    if (same && same.id !== id) throw new ConflictException('已經有同名的 Process');
    await this.db.update(processes).set({ name }).where(eq(processes.id, id));
    return this.get(id);
  }

  /** 以整份 DSL 取代草稿。還沒通過發佈前檢查也可以儲存。 */
  async saveDraft(id: string, dsl: ProcessDsl, me: ActiveParticipant): Promise<Process> {
    const [updated] = await this.db
      .update(processes)
      .set({ draft: dsl, draftSavedAt: new Date(), draftSavedBy: me.id })
      .where(eq(processes.id, id))
      .returning({ id: processes.id });
    if (!updated) throw new NotFoundException('找不到這個 Process');
    return this.get(id);
  }

  /** 捨棄草稿，回到目前版本。還沒發佈過的 Process 沒有可以回去的版本。 */
  async discardDraft(id: string): Promise<void> {
    await this.assertExists(id);
    if ((await latestVersion(this.db, id)) === 0)
      throw new ConflictException('還沒發佈過的 Process 不能捨棄草稿');
    await this.db.update(processes).set(NO_DRAFT).where(eq(processes.id, id));
  }

  /**
   * 把已儲存的草稿發佈成新的 Process Version，並成為目前版本。
   * 以 row lock 序列化同一個 Process 的發佈，版本號才不會重複。
   */
  async publish(id: string, note: string, me: ActiveParticipant): Promise<ProcessVersion> {
    const version = await this.db.transaction(async (tx) => {
      const [process] = await tx
        .select({ draft: processes.draft })
        .from(processes)
        .where(eq(processes.id, id))
        .for('update');
      if (!process) throw new NotFoundException('找不到這個 Process');
      if (!process.draft) throw new ConflictException('沒有草稿可以發佈');

      const errors = checkProcess(process.draft);
      if (errors.length > 0) {
        const body: PublishRejected = {
          message: `草稿有 ${errors.length} 個問題，修正後才能發佈`,
          errors,
        };
        throw new UnprocessableEntityException(body);
      }

      const next = (await latestVersion(tx, id)) + 1;
      await tx
        .insert(processVersions)
        .values({ processId: id, version: next, dsl: process.draft, note, publishedBy: me.id });
      await tx.update(processes).set(NO_DRAFT).where(eq(processes.id, id));
      return next;
    });
    const published = (await this.versions(id)).find((v) => v.version === version);
    if (!published) throw new Error(`剛發佈的 Process Version ${version} 讀不到`);
    return published;
  }

  private async versions(processId: string): Promise<ProcessVersion[]> {
    const rows = await this.db
      .select({
        version: processVersions.version,
        note: processVersions.note,
        publishedAt: processVersions.publishedAt,
        publishedById: processVersions.publishedBy,
        publishedByName: authUsers.name,
        dsl: processVersions.dsl,
      })
      .from(processVersions)
      .innerJoin(participants, eq(participants.id, processVersions.publishedBy))
      .innerJoin(authUsers, eq(authUsers.id, participants.userId))
      .where(eq(processVersions.processId, processId))
      .orderBy(asc(processVersions.version));
    return rows.map((r) => ({
      version: r.version,
      note: r.note,
      publishedAt: r.publishedAt.toISOString(),
      publishedBy: { id: r.publishedById, name: r.publishedByName },
      dsl: r.dsl,
    }));
  }

  private async assertExists(id: string) {
    const [row] = await this.db
      .select({ id: processes.id })
      .from(processes)
      .where(eq(processes.id, id));
    if (!row) throw new NotFoundException('找不到這個 Process');
  }
}

/** 最新的版本號；還沒發佈過時為 0。 */
async function latestVersion(db: Pick<Database, 'select'>, processId: string): Promise<number> {
  const [row] = await db
    .select({ version: max(processVersions.version) })
    .from(processVersions)
    .where(eq(processVersions.processId, processId));
  return row?.version ?? 0;
}

/** 每個 Process 的目前版本（版本號最大的 Process Version），依 Process 名稱排序；可以只查一個 Process。 */
export async function currentVersions(db: Pick<Database, 'selectDistinctOn'>, processId?: string) {
  const rows = await db
    .selectDistinctOn([processVersions.processId], {
      id: processes.id,
      name: processes.name,
      versionId: processVersions.id,
      version: processVersions.version,
      dsl: processVersions.dsl,
    })
    .from(processVersions)
    .innerJoin(processes, eq(processes.id, processVersions.processId))
    .where(processId ? eq(processVersions.processId, processId) : undefined)
    .orderBy(processVersions.processId, desc(processVersions.version));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** Participant ID → 姓名。 */
export async function participantNames(
  db: Pick<Database, 'select'>,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: participants.id, name: authUsers.name })
    .from(participants)
    .innerJoin(authUsers, eq(authUsers.id, participants.userId))
    .where(inArray(participants.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** 人名與 Role 名稱，畫面上的指派對象與處理人都由 ID 查出。 */
export interface Names {
  people: Map<string, string>;
  roles: Map<string, string>;
}

/** 要查名稱的對象：Participant ID，或指派對象（Participant、Role，或 Manager 的 Fallback Role）。 */
type Named = string | Assignee;

/** 一次查出一批 Participant 與 Role 的名稱。 */
export async function lookupNames(db: Pick<Database, 'select'>, targets: Named[]): Promise<Names> {
  const people = targets.flatMap((t) =>
    typeof t === 'string' ? [t] : t.type === 'participant' ? [t.participantId] : [],
  );
  const roleIds = [...new Set(targets.flatMap(roleIdOf))];
  const roleRows = roleIds.length
    ? await db
        .select({ id: roles.id, name: roles.name })
        .from(roles)
        .where(inArray(roles.id, roleIds))
    : [];
  return {
    people: await participantNames(db, people),
    roles: new Map(roleRows.map((r) => [r.id, r.name])),
  };
}

function roleIdOf(t: Named): string[] {
  if (typeof t === 'string') return [];
  if (t.type === 'role') return [t.roleId];
  if (t.type === 'manager' && t.fallbackRoleId) return [t.fallbackRoleId];
  return [];
}

/** Task 的指派對象加上名稱。 */
export function assigneeRef(names: Names, assignee: TaskAssignee): AssigneeRef {
  return assignee.type === 'participant'
    ? {
        type: 'participant',
        id: assignee.participantId,
        name: names.people.get(assignee.participantId) ?? '',
      }
    : { type: 'role', id: assignee.roleId, name: names.roles.get(assignee.roleId) ?? '' };
}

/** 審批與填表節點的指派對象。 */
export function assigneesOf(dsl: ProcessDsl): Assignee[] {
  return dsl.nodes.flatMap((n) =>
    (n.type === 'approval' || n.type === 'form') && n.assignee ? [n.assignee] : [],
  );
}

/** 開始或填表節點使用的 Form；其他節點或沒有指定時為 null。 */
export function formOf(dsl: ProcessDsl, node: ProcessNode | undefined): FormSchema | null {
  const formId = node && formIdOf(node);
  return (formId && dsl.forms.find((f) => f.id === formId)) || null;
}

export function startFormOf(dsl: ProcessDsl): FormSchema | null {
  return formOf(
    dsl,
    dsl.nodes.find((n) => n.type === 'start'),
  );
}

/** 節點的指派對象加上名稱；Manager 在建立 Task 時才決定是誰，這裡只帶 Fallback Role。 */
function stepAssignee(names: Names, assignee: Assignee): StepAssignee {
  if (assignee.type !== 'manager') return assigneeRef(names, assignee);
  const { fallbackRoleId } = assignee;
  return {
    type: 'manager',
    fallbackRole: fallbackRoleId
      ? { id: fallbackRoleId, name: names.roles.get(fallbackRoleId) ?? '' }
      : null,
  };
}

/** 流程預覽：沿著主線列出每個節點，審批與填表節點帶處理人，開始與填表節點帶 Form。 */
export function stepsOf(dsl: ProcessDsl, names: Names): ProcessStep[] {
  return mainPath(dsl).map((node) => {
    const assignee =
      node.type === 'approval' || node.type === 'form' ? (node.assignee ?? null) : null;
    return {
      nodeId: node.id,
      type: node.type,
      name: node.name,
      assignee: assignee && stepAssignee(names, assignee),
      formId: formOf(dsl, node)?.id ?? null,
    };
  });
}
