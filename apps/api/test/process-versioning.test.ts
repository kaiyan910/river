import type { Permission } from '@river/auth';
import type {
  MyTask,
  Process,
  ProcessVersion,
  RequestDetail,
  StartableProcess,
} from '@river/contracts';
import type { ProcessDsl } from '@river/dsl';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiClient, startTestApp, type TestApp } from './harness.js';

const PASSWORD = 'correct horse battery staple';

/** workflow 在背景推進；反覆檢查直到條件成立。 */
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`等不到預期的狀態：${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** start → 依序經過每個審批節點 → end */
function approvalChain(...steps: { id: string; name: string; approverId: string }[]): ProcessDsl {
  const ids = ['start', ...steps.map((s) => s.id), 'end'];
  return {
    nodes: [
      { id: 'start', type: 'start', name: '開始', position: { x: 0, y: 0 } },
      ...steps.map((s, i) => ({
        id: s.id,
        type: 'approval' as const,
        name: s.name,
        assignee: { type: 'participant' as const, participantId: s.approverId },
        position: { x: 0, y: 170 * (i + 1) },
      })),
      { id: 'end', type: 'end', name: '結束', position: { x: 0, y: 170 * (steps.length + 1) } },
    ],
    edges: ids.slice(1).map((target, i) => ({ id: `e${i}`, source: ids[i] ?? '', target })),
    forms: [],
  };
}

describe('新版本與版本鎖定', () => {
  let app: TestApp;
  let designer: ApiClient;
  let editor: ApiClient;
  let initiator: ApiClient;
  let manager: ApiClient;
  let managerId: string;
  let finance: ApiClient;
  let financeId: string;

  async function signInAs(email: string, name: string, permissions: Permission[] = []) {
    const { participantId } = await app.provisionParticipant({
      email,
      name,
      password: PASSWORD,
      permissions,
    });
    return { participantId, client: await app.signIn(email, PASSWORD) };
  }

  beforeAll(async () => {
    app = await startTestApp();
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    editor = (await signInAs('editor@river.test', '黃俊傑', ['process.edit'])).client;
    initiator = (await signInAs('initiator@river.test', '王小明')).client;
    const m = await signInAs('manager@river.test', '林美玲');
    manager = m.client;
    managerId = m.participantId;
    const f = await signInAs('finance@river.test', '張會計');
    finance = f.client;
    financeId = f.participantId;
  });
  afterAll(() => app?.close());

  const v1Flow = () => approvalChain({ id: 'manager', name: '主管審批', approverId: managerId });
  /** v2：在主管審批與結束之間多一個財務審批。 */
  const v2Flow = () =>
    approvalChain(
      { id: 'manager', name: '主管審批', approverId: managerId },
      { id: 'finance', name: '財務審批', approverId: financeId },
    );

  async function getProcess(id: string): Promise<Process> {
    const res = await designer.get(`/api/processes/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as Process;
  }

  /** 建立 Process、儲存草稿並發佈 v1；回傳 Process ID。 */
  async function publishV1(name: string, dsl: ProcessDsl = v1Flow()): Promise<string> {
    const created = (await (await designer.post('/api/processes', { name })).json()) as Process;
    expect((await designer.put(`/api/processes/${created.id}/draft`, { dsl })).status).toBe(200);
    expect((await designer.post(`/api/processes/${created.id}/versions`, {})).status).toBe(201);
    return created.id;
  }

  function newDraft(processId: string, as = designer) {
    return as.post(`/api/processes/${processId}/draft`);
  }

  async function openTasks(as: ApiClient): Promise<MyTask[]> {
    const res = await as.get('/api/tasks/mine?status=open');
    expect(res.status).toBe(200);
    return (await res.json()) as MyTask[];
  }

  async function detail(id: string): Promise<RequestDetail> {
    const res = await initiator.get(`/api/requests/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as RequestDetail;
  }

  async function startRequest(processId: string, title: string): Promise<RequestDetail> {
    const res = await initiator.post('/api/requests', { processId, title });
    expect(res.status).toBe(201);
    return (await res.json()) as RequestDetail;
  }

  /** 等到這筆 Request 在 as 的待辦裡出現 Task。 */
  async function waitForTask(as: ApiClient, requestId: string): Promise<MyTask> {
    const tasks = await eventually(
      () => openTasks(as),
      (list) => list.some((t) => t.request.id === requestId),
    );
    return tasks.find((t) => t.request.id === requestId) as MyTask;
  }

  function approve(as: ApiClient, task: MyTask) {
    return as.post(`/api/tasks/${task.id}/complete`, {
      outcome: 'approved',
      version: task.version,
    });
  }

  it('從目前版本建立新草稿：內容與目前版本相同，草稿的修改不影響目前版本', async () => {
    const processId = await publishV1('請款');
    expect((await getProcess(processId)).draft).toBeNull();

    const res = await newDraft(processId);
    expect(res.status).toBe(201);
    const created = (await res.json()) as Process;
    expect(created.currentVersion).toBe(1);
    expect(created.draft?.dsl).toEqual(v1Flow());
    expect(created.draft?.savedBy.name).toBe('陳志明');

    expect(
      (await designer.put(`/api/processes/${processId}/draft`, { dsl: v2Flow() })).status,
    ).toBe(200);

    const after = await getProcess(processId);
    expect(after.draft?.dsl).toEqual(v2Flow());
    expect(after.currentVersion).toBe(1);
    expect(after.versions.map((v) => v.dsl)).toEqual([v1Flow()]);

    const startable = (await (
      await initiator.get('/api/processes/startable')
    ).json()) as StartableProcess[];
    const listed = startable.find((p) => p.id === processId);
    expect(listed?.version).toBe(1);
    expect(listed?.steps.map((s) => s.name)).toEqual(['開始', '主管審批', '結束']);
  });

  it('已經有草稿、或還沒發佈過的 Process 不能再建立新草稿', async () => {
    const processId = await publishV1('差旅');
    expect((await newDraft(processId)).status).toBe(201);
    expect((await newDraft(processId)).status).toBe(409);

    const unpublished = (await (
      await designer.post('/api/processes', { name: '還在設計' })
    ).json()) as Process;
    expect((await newDraft(unpublished.id)).status).toBe(409);
  });

  it('只要有 process.edit 就能建立新草稿；不存在的 Process 回 404', async () => {
    const processId = await publishV1('加班');
    expect((await newDraft(processId, initiator)).status).toBe(403);
    expect((await newDraft(processId, editor)).status).toBe(201);
    expect((await newDraft('00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('Process 列出所有 Process Version，最新發佈的是目前版本', async () => {
    const processId = await publishV1('採購');
    await newDraft(processId);
    await designer.put(`/api/processes/${processId}/draft`, { dsl: v2Flow() });
    await designer.post(`/api/processes/${processId}/versions`, { note: '加上財務審批' });

    const process = await getProcess(processId);
    expect(process.currentVersion).toBe(2);
    expect(process.draft).toBeNull();
    expect(process.versions.map((v: ProcessVersion) => [v.version, v.note])).toEqual([
      [1, ''],
      [2, '加上財務審批'],
    ]);
    expect(process.versions[0]?.dsl).toEqual(v1Flow());
    expect(process.versions[1]?.dsl).toEqual(v2Flow());
  });

  it('v1 的 Request 停在審批節點時發佈 v2，v1 的 Request 照 v1 跑完；之後發起的 Request 用 v2', async () => {
    const processId = await publishV1('報銷');
    const old = await startRequest(processId, '8 月計程車費');
    expect(old.process.version).toBe(1);
    const oldTask = await waitForTask(manager, old.id);

    // v1 的 Request 停在主管審批時，在中間多加一個財務審批並發佈 v2。
    expect((await newDraft(processId)).status).toBe(201);
    await designer.put(`/api/processes/${processId}/draft`, { dsl: v2Flow() });
    expect((await designer.post(`/api/processes/${processId}/versions`, {})).status).toBe(201);
    expect((await getProcess(processId)).currentVersion).toBe(2);

    // v1 的 Request：主管核准後直接完成，不會出現財務審批。
    expect((await approve(manager, oldTask)).status).toBe(200);
    const oldDone = await eventually(
      () => detail(old.id),
      (d) => d.status === 'completed',
    );
    expect(oldDone.process.version).toBe(1);
    expect(oldDone.steps.map((s) => s.name)).toEqual(['開始', '主管審批', '結束']);
    expect(oldDone.tasks.map((t) => t.nodeName)).toEqual(['主管審批']);
    expect((await openTasks(finance)).some((t) => t.request.id === old.id)).toBe(false);

    // 之後發起的 Request 用 v2：主管審批之後還要財務審批。
    const fresh = await startRequest(processId, '9 月計程車費');
    expect(fresh.process.version).toBe(2);
    expect(fresh.steps.map((s) => s.name)).toEqual(['開始', '主管審批', '財務審批', '結束']);
    expect((await approve(manager, await waitForTask(manager, fresh.id))).status).toBe(200);
    expect((await approve(finance, await waitForTask(finance, fresh.id))).status).toBe(200);
    const freshDone = await eventually(
      () => detail(fresh.id),
      (d) => d.status === 'completed',
    );
    expect(freshDone.tasks.map((t) => t.nodeName)).toEqual(['主管審批', '財務審批']);
  });

  it('Process Version 在資料庫層不能修改或刪除', async () => {
    const processId = await publishV1('用車');
    await expect(
      app.db.execute(
        sql`update process_versions set note = '偷改' where process_id = ${processId}`,
      ),
    ).rejects.toThrow();
    await expect(
      app.db.execute(sql`delete from process_versions where process_id = ${processId}`),
    ).rejects.toThrow();
    expect((await getProcess(processId)).versions.map((v) => v.note)).toEqual(['']);
  });
});
