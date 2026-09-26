import type { Permission } from '@river/auth';
import type {
  MyTask,
  Process,
  PublishRejected,
  RequestDetail,
  StartableProcess,
} from '@river/contracts';
import { participants } from '@river/db';
import type { Assignee, ProcessDsl, ProcessNode } from '@river/dsl';
import type { FormSchema } from '@river/forms';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiClient, startTestApp, type TestApp } from './harness.js';

const PASSWORD = 'correct horse battery staple';

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`等不到預期的狀態：${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const leave: FormSchema = {
  id: 'leave',
  name: '代理人確認',
  fields: [{ id: 'l1', key: 'deputy', type: 'text', label: '代理人', required: true, rules: {} }],
};

const at = (y: number) => ({ x: 0, y });

/** start → 依序經過每個人工節點 → end */
function chain(...steps: ProcessNode[]): ProcessDsl {
  const nodes: ProcessNode[] = [
    { id: 'start', type: 'start', name: '開始', position: at(0) },
    ...steps,
    { id: 'end', type: 'end', name: '結束', position: at(170 * (steps.length + 1)) },
  ];
  return {
    nodes,
    edges: nodes
      .slice(1)
      .map((n, i) => ({ id: `e${i}`, source: nodes[i]?.id ?? '', target: n.id })),
    forms: [leave],
  };
}

const approval = (id: string, name: string, assignee: Assignee): ProcessNode => ({
  id,
  type: 'approval',
  name,
  assignee,
  position: at(170),
});

describe('指派給發起人的 Manager 與 Fallback Role', () => {
  let app: TestApp;
  let admin: ApiClient;
  let designer: ApiClient;
  let hr: ApiClient;
  let manager: ApiClient;
  let managerId: string;
  let hrRoleId: string;
  /** 指派給發起人的 Manager，找不到有效的 Manager 時改派給「人資」。 */
  let toManager: Assignee;

  async function signInAs(email: string, name: string, permissions: Permission[] = []) {
    const { participantId } = await app.provisionParticipant({
      email,
      name,
      password: PASSWORD,
      permissions,
    });
    return { participantId, client: await app.signIn(email, PASSWORD) };
  }

  async function setManager(id: string, managerId: string | null) {
    expect((await admin.patch(`/api/participants/${id}`, { managerId })).status).toBe(200);
  }

  async function publish(name: string, dsl: ProcessDsl): Promise<string> {
    const created = (await (await designer.post('/api/processes', { name })).json()) as Process;
    expect((await designer.put(`/api/processes/${created.id}/draft`, { dsl })).status).toBe(200);
    const res = await designer.post(`/api/processes/${created.id}/versions`, {});
    expect(res.status).toBe(201);
    return created.id;
  }

  async function openTasks(as: ApiClient): Promise<MyTask[]> {
    const res = await as.get('/api/tasks/mine?status=open');
    expect(res.status).toBe(200);
    return (await res.json()) as MyTask[];
  }

  async function start(as: ApiClient, processId: string, title: string): Promise<RequestDetail> {
    const res = await as.post('/api/requests', { processId, title });
    expect(res.status).toBe(201);
    return (await res.json()) as RequestDetail;
  }

  async function waitForTask(requestId: string, as: ApiClient): Promise<MyTask> {
    const tasks = await eventually(
      () => openTasks(as),
      (list) => list.some((t) => t.request.id === requestId),
    );
    return tasks.find((t) => t.request.id === requestId) as MyTask;
  }

  async function detail(id: string, as: ApiClient): Promise<RequestDetail> {
    const res = await as.get(`/api/requests/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as RequestDetail;
  }

  function approve(as: ApiClient, task: { id: string; version: number }) {
    return as.post(`/api/tasks/${task.id}/complete`, {
      outcome: 'approved',
      version: task.version,
    });
  }

  beforeAll(async () => {
    app = await startTestApp();
    admin = (await signInAs('admin@river.test', '系統管理員', ['user.manage', 'role.manage']))
      .client;
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    const mgr = await signInAs('manager@river.test', '黃淑芬');
    manager = mgr.client;
    managerId = mgr.participantId;
    const h = await signInAs('hr@river.test', '吳雅婷');
    hr = h.client;

    const res = await admin.post('/api/roles', { name: '人資' });
    hrRoleId = ((await res.json()) as { id: string }).id;
    expect((await admin.put(`/api/roles/${hrRoleId}/members/${h.participantId}`)).status).toBe(204);
    toManager = { type: 'manager', fallbackRoleId: hrRoleId };
  });
  afterAll(() => app?.close());

  it('指派給 Manager 卻沒有設定 Fallback Role 時不能發佈', async () => {
    const created = (await (
      await designer.post('/api/processes', { name: '請假－沒有 Fallback' })
    ).json()) as Process;
    const dsl = chain(approval('approve', '主管審批', { type: 'manager', fallbackRoleId: null }));
    expect((await designer.put(`/api/processes/${created.id}/draft`, { dsl })).status).toBe(200);

    const res = await designer.post(`/api/processes/${created.id}/versions`, {});
    expect(res.status).toBe(422);
    expect(((await res.json()) as PublishRejected).errors).toEqual([
      { nodeId: 'approve', code: 'MANAGER_NO_FALLBACK_ROLE', message: expect.any(String) },
    ]);
  });

  it('發起人有有效的 Manager：Task 指派給 Manager，Fallback Role 的成員看不到', async () => {
    const e = await signInAs('employee@river.test', '王小明');
    await setManager(e.participantId, managerId);
    const processId = await publish('請假', chain(approval('approve', '主管審批', toManager)));

    const startable = (await (
      await e.client.get('/api/processes/startable')
    ).json()) as StartableProcess[];
    expect(startable.find((p) => p.id === processId)?.steps[1]).toMatchObject({
      nodeId: 'approve',
      assignee: { type: 'manager', fallbackRole: { id: hrRoleId, name: '人資' } },
    });

    const request = await start(e.client, processId, '10/3 特休');
    const task = await waitForTask(request.id, manager);
    expect(task.assignee).toEqual({ type: 'participant', id: managerId, name: '黃淑芬' });
    expect((await openTasks(hr)).some((t) => t.request.id === request.id)).toBe(false);

    expect((await approve(manager, task)).status).toBe(200);
    const done = await eventually(
      () => detail(request.id, e.client),
      (d) => d.status === 'completed',
    );
    expect(
      done.events.map((ev) => [ev.type, ev.task?.assignee.name ?? null, ev.fallbackReason]),
    ).toEqual([
      ['request.started', null, null],
      ['task.created', '黃淑芬', null],
      ['task.completed', '黃淑芬', null],
      ['request.completed', null, null],
    ]);
  });

  it('發起人沒有 Manager：Task 改派給 Fallback Role，時間軸記錄原因', async () => {
    const e = await signInAs('no-manager@river.test', '李志偉');
    const processId = await publish(
      '請假－沒有 Manager',
      chain(approval('approve', '主管審批', toManager)),
    );

    const request = await start(e.client, processId, '家庭照顧假');
    const task = await waitForTask(request.id, hr);
    expect(task.assignee).toEqual({ type: 'role', id: hrRoleId, name: '人資' });

    const created = (await detail(request.id, e.client)).events.find(
      (ev) => ev.type === 'task.created',
    );
    expect(created).toMatchObject({
      task: { assignee: { type: 'role', name: '人資' } },
      fallbackReason: 'no_manager',
    });
    expect((await approve(hr, task)).status).toBe(200);
  });

  it('發起人的 Manager 已停用：Task 改派給 Fallback Role，時間軸記錄原因', async () => {
    const m = await signInAs('former-manager@river.test', '周建國');
    const e = await signInAs('orphan@river.test', '蔡依林');
    await setManager(e.participantId, m.participantId);
    await app.db
      .update(participants)
      .set({ deactivatedAt: new Date() })
      .where(eq(participants.id, m.participantId));
    const processId = await publish(
      '請假－Manager 已停用',
      chain({
        id: 'deputy',
        type: 'form',
        name: '確認代理人',
        formId: 'leave',
        assignee: toManager,
        position: at(170),
      }),
    );

    const request = await start(e.client, processId, '婚假');
    const task = await waitForTask(request.id, hr);
    expect(task).toMatchObject({ kind: 'form', assignee: { type: 'role', id: hrRoleId } });

    const created = (await detail(request.id, e.client)).events.find(
      (ev) => ev.type === 'task.created',
    );
    expect(created?.fallbackReason).toBe('manager_deactivated');
  });

  it('Task 建立後才換 Manager，不影響已經建立的 Task', async () => {
    const e = await signInAs('mover@river.test', '郭台生');
    await setManager(e.participantId, managerId);
    const processId = await publish(
      '請假－換 Manager',
      chain(approval('approve', '主管審批', toManager)),
    );

    const request = await start(e.client, processId, '補休');
    const task = await waitForTask(request.id, manager);
    await setManager(e.participantId, null);

    expect((await openTasks(manager)).map((t) => t.id)).toContain(task.id);
    expect((await approve(manager, task)).status).toBe(200);
  });
});
