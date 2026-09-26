import type { Permission } from '@river/auth';
import type {
  MyTask,
  Process,
  RequestDetail,
  RequestSummary,
  StartableProcess,
} from '@river/contracts';
import type { Assignee, ProcessDsl, ProcessNode } from '@river/dsl';
import type { FormSchema } from '@river/forms';
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

const invoice: FormSchema = {
  id: 'invoice',
  name: '發票登錄',
  fields: [{ id: 'i1', key: 'number', type: 'text', label: '發票號碼', required: true, rules: {} }],
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
    forms: [invoice],
  };
}

const approval = (id: string, name: string, assignee: Assignee): ProcessNode => ({
  id,
  type: 'approval',
  name,
  assignee,
  position: at(170),
});

describe('指派給 Role，先送出者勝出', () => {
  let app: TestApp;
  let admin: ApiClient;
  let designer: ApiClient;
  let initiator: ApiClient;
  let alice: ApiClient;
  let bob: ApiClient;
  let outsider: ApiClient;
  let aliceId: string;
  let bobId: string;
  let managerId: string;
  let manager: ApiClient;
  /** 「財務審批人」：林美玲（alice）與張志豪（bob）。 */
  let financeRole: { type: 'role'; roleId: string };

  async function signInAs(email: string, name: string, permissions: Permission[] = []) {
    const { participantId } = await app.provisionParticipant({
      email,
      name,
      password: PASSWORD,
      permissions,
    });
    return { participantId, client: await app.signIn(email, PASSWORD) };
  }

  async function createRole(name: string, memberIds: string[]): Promise<string> {
    const res = await admin.post('/api/roles', { name });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    for (const m of memberIds)
      expect((await admin.put(`/api/roles/${id}/members/${m}`)).status).toBe(204);
    return id;
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

  async function completedTasks(as: ApiClient): Promise<MyTask[]> {
    return (await (await as.get('/api/tasks/mine?status=completed')).json()) as MyTask[];
  }

  async function detail(id: string, as: ApiClient = initiator): Promise<RequestDetail> {
    const res = await as.get(`/api/requests/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as RequestDetail;
  }

  async function start(processId: string, title: string): Promise<RequestDetail> {
    const res = await initiator.post('/api/requests', { processId, title });
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

  function approve(as: ApiClient, task: { id: string; version: number }, comment?: string) {
    return as.post(`/api/tasks/${task.id}/complete`, {
      outcome: 'approved',
      version: task.version,
      comment,
    });
  }

  beforeAll(async () => {
    app = await startTestApp();
    admin = (await signInAs('admin@river.test', '系統管理員', ['role.manage'])).client;
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    initiator = (await signInAs('initiator@river.test', '王小明')).client;
    const a = await signInAs('alice@river.test', '林美玲');
    const b = await signInAs('bob@river.test', '張志豪');
    const m = await signInAs('manager@river.test', '黃淑芬');
    outsider = (await signInAs('outsider@river.test', '李建宏')).client;
    alice = a.client;
    aliceId = a.participantId;
    bob = b.client;
    bobId = b.participantId;
    manager = m.client;
    managerId = m.participantId;
    financeRole = { type: 'role', roleId: await createRole('財務審批人', [aliceId, bobId]) };
  });
  afterAll(() => app?.close());

  it('Designer 可以列出 Role 來指派；入口網站的流程預覽顯示 Role', async () => {
    const res = await designer.get('/api/roles/directory');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: financeRole.roleId, name: '財務審批人', memberCount: 2 },
    ]);
    expect((await initiator.get('/api/roles/directory')).status).toBe(403);

    const processId = await publish(
      '報銷－Role 預覽',
      chain(approval('finance', '財務審核', financeRole)),
    );
    const list = (await (
      await initiator.get('/api/processes/startable')
    ).json()) as StartableProcess[];
    expect(list.find((p) => p.id === processId)?.steps[1]).toMatchObject({
      nodeId: 'finance',
      assignee: { type: 'role', id: financeRole.roleId, name: '財務審批人' },
    });
  });

  it('Role 的每位成員都在「我的待辦」看到 Task，完成後從所有人的待辦消失；時間軸記錄實際處理的人', async () => {
    const processId = await publish(
      '報銷－Role',
      chain(approval('finance', '財務審核', financeRole), {
        ...approval('manager', '主管審批', { type: 'participant', participantId: managerId }),
        position: at(340),
      }),
    );
    const request = await start(processId, '10 月文具');

    const aliceTask = await waitForTask(request.id, alice);
    const bobTask = await waitForTask(request.id, bob);
    expect(bobTask.id).toBe(aliceTask.id);
    expect(aliceTask).toMatchObject({
      nodeName: '財務審核',
      assignee: { type: 'role', id: financeRole.roleId, name: '財務審批人' },
    });
    expect((await openTasks(outsider)).some((t) => t.request.id === request.id)).toBe(false);
    expect((await outsider.get(`/api/requests/${request.id}`)).status).toBe(404);
    // Role 成員還沒處理之前也看得到 Request 內容。
    expect((await detail(request.id, bob)).title).toBe('10 月文具');
    const mine = (await (await initiator.get('/api/requests/mine')).json()) as RequestSummary[];
    expect(mine.find((r) => r.id === request.id)?.openTasks).toEqual([
      {
        id: aliceTask.id,
        nodeName: '財務審核',
        assignee: { type: 'role', id: financeRole.roleId, name: '財務審批人' },
      },
    ]);

    expect((await approve(bob, bobTask, '金額無誤')).status).toBe(200);

    await waitForTask(request.id, manager);
    expect((await openTasks(alice)).some((t) => t.request.id === request.id)).toBe(false);
    expect((await openTasks(bob)).some((t) => t.request.id === request.id)).toBe(false);
    expect((await completedTasks(bob)).map((t) => t.id)).toContain(bobTask.id);
    expect((await completedTasks(alice)).map((t) => t.id)).not.toContain(bobTask.id);

    const after = await detail(request.id);
    expect(after.tasks[0]).toMatchObject({
      status: 'completed',
      completedBy: { id: bobId, name: '張志豪' },
    });
    expect(
      after.events.map((e) => [e.type, e.actor?.name ?? null, e.task?.assignee.name ?? null]),
    ).toEqual([
      ['request.started', '王小明', null],
      ['task.created', null, '財務審批人'],
      ['task.completed', '張志豪', '財務審批人'],
      ['task.created', null, '黃淑芬'],
    ]);
  });

  it('兩位成員同時送出：只有一位成功，另一位收到「已由 X 處理」，workflow 只收到一次 Signal', async () => {
    const processId = await publish(
      '採購－搶單',
      chain(approval('finance', '財務審核', financeRole)),
    );
    const request = await start(processId, '會議室螢幕');
    const task = await waitForTask(request.id, alice);

    const [a, b] = await Promise.all([approve(alice, task), approve(bob, task)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [winner, loser] = a.status === 200 ? ['林美玲', b] : ['張志豪', a];
    expect(((await loser.json()) as { message: string }).message).toBe(`已由 ${winner} 處理。`);

    const done = await eventually(
      () => detail(request.id),
      (d) => d.status === 'completed',
    );
    const completed = done.events.filter((e) => e.type === 'task.completed');
    expect(completed.map((e) => e.actor?.name)).toEqual([winner]);
    expect(done.tasks[0]?.completedBy?.name).toBe(winner);

    const history = await app.temporal.workflow.getHandle(request.id).fetchHistory();
    const signals = (history.events ?? []).filter(
      (e) => e.workflowExecutionSignaledEventAttributes,
    );
    expect(signals).toHaveLength(1);
  });

  it('填表節點也可以指派給 Role，任一成員填寫後往下走', async () => {
    const processId = await publish(
      '請款－Role 填表',
      chain({
        id: 'register',
        type: 'form',
        name: '登錄發票',
        formId: 'invoice',
        assignee: financeRole,
        position: at(170),
      }),
    );
    const request = await start(processId, '顧問費請款');
    const task = await waitForTask(request.id, alice);

    const res = await alice.post(`/api/tasks/${task.id}/complete`, {
      outcome: 'submitted',
      version: task.version,
      data: { number: 'AB-12345678' },
    });
    expect(res.status).toBe(200);
    const done = await eventually(
      () => detail(request.id, bob),
      (d) => d.status === 'completed',
    );
    expect(done.data).toMatchObject([
      { nodeId: 'register', data: { number: 'AB-12345678' }, submittedBy: { id: aliceId } },
    ]);
  });

  it('處理過 Task 之後被移出 Role，再送一次仍然收到「已由 X 處理」', async () => {
    const roleId = await createRole('總務', [aliceId, bobId]);
    const processId = await publish(
      '用品－移出 Role',
      chain(approval('general', '總務審核', { type: 'role', roleId })),
    );
    const request = await start(processId, '影印紙');
    const task = await waitForTask(request.id, bob);
    expect((await approve(bob, task)).status).toBe(200);
    expect((await admin.delete(`/api/roles/${roleId}/members/${bobId}`)).status).toBe(204);

    const again = await approve(bob, task);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { message: string }).message).toBe('已由 張志豪 處理。');
    expect((await detail(request.id, bob)).tasks[0]?.completedBy?.name).toBe('張志豪');
  });

  it('不是 Role 成員的人不能處理 Role 的 Task', async () => {
    const processId = await publish(
      '出差－Role',
      chain(approval('finance', '財務審核', financeRole)),
    );
    const request = await start(processId, '新竹出差');
    const task = await waitForTask(request.id, alice);

    expect((await approve(outsider, task)).status).toBe(404);
    expect((await approve(initiator, task)).status).toBe(404);
    expect((await detail(request.id)).status).toBe('running');
  });
});
