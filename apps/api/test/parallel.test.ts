import type { Permission } from '@river/auth';
import type {
  MyTask,
  Process,
  PublishRejected,
  RequestDetail,
  StartableProcess,
} from '@river/contracts';
import { requests, tasks } from '@river/db';
import type { ProcessDsl, ProcessNode } from '@river/dsl';
import { and, eq } from 'drizzle-orm';
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

const at = (y: number) => ({ x: 0, y });

const approval = (id: string, name: string, participantId: string): ProcessNode => ({
  id,
  type: 'approval',
  name,
  assignee: { type: 'participant', participantId },
  position: at(340),
});

/**
 * start → 同時審批
 *   ├ IT 審批 → 資安審批 ─┐
 *   └ 財務審批 ───────────┴→ 匯合 → 主管審批 → end
 */
function purchaseFlow(people: {
  itId: string;
  securityId: string;
  financeId: string;
  managerId: string;
}): ProcessDsl {
  return {
    nodes: [
      { id: 'start', type: 'start', name: '開始', position: at(0) },
      { id: 'split', type: 'parallelSplit', name: '同時審批', position: at(170) },
      approval('it', 'IT 審批', people.itId),
      approval('security', '資安審批', people.securityId),
      approval('finance', '財務審批', people.financeId),
      { id: 'join', type: 'parallelJoin', name: '匯合', position: at(510) },
      approval('manager', '主管審批', people.managerId),
      { id: 'end', type: 'end', name: '結束', position: at(850) },
    ],
    edges: [
      { id: 'e-start', source: 'start', target: 'split' },
      { id: 'e-it', source: 'split', target: 'it' },
      { id: 'e-finance', source: 'split', target: 'finance' },
      { id: 'e-security', source: 'it', target: 'security' },
      { id: 'e-security-join', source: 'security', target: 'join' },
      { id: 'e-finance-join', source: 'finance', target: 'join' },
      { id: 'e-join', source: 'join', target: 'manager' },
      { id: 'e-end', source: 'manager', target: 'end' },
    ],
    forms: [],
  };
}

describe('並行分支與匯合', () => {
  let app: TestApp;
  let designer: ApiClient;
  let employee: ApiClient;
  let itStaff: ApiClient;
  let security: ApiClient;
  let finance: ApiClient;
  let manager: ApiClient;
  let processId: string;

  async function signInAs(email: string, name: string, permissions: Permission[] = []) {
    const { participantId } = await app.provisionParticipant({
      email,
      name,
      password: PASSWORD,
      permissions,
    });
    return { participantId, client: await app.signIn(email, PASSWORD) };
  }

  async function saveDraft(name: string, dsl: ProcessDsl): Promise<string> {
    const created = (await (await designer.post('/api/processes', { name })).json()) as Process;
    expect((await designer.put(`/api/processes/${created.id}/draft`, { dsl })).status).toBe(200);
    return created.id;
  }

  async function openTasks(as: ApiClient): Promise<MyTask[]> {
    const res = await as.get('/api/tasks/mine?status=open');
    expect(res.status).toBe(200);
    return (await res.json()) as MyTask[];
  }

  async function waitForTask(as: ApiClient, requestId: string): Promise<MyTask> {
    const tasks = await eventually(
      () => openTasks(as),
      (list) => list.some((t) => t.request.id === requestId),
    );
    return tasks.find((t) => t.request.id === requestId) as MyTask;
  }

  const hasTask = async (as: ApiClient, requestId: string) =>
    (await openTasks(as)).some((t) => t.request.id === requestId);

  async function detail(id: string): Promise<RequestDetail> {
    const res = await employee.get(`/api/requests/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as RequestDetail;
  }

  async function start(title: string): Promise<string> {
    const res = await employee.post('/api/requests', { processId, title });
    expect(res.status).toBe(201);
    return ((await res.json()) as RequestDetail).id;
  }

  function complete(as: ApiClient, task: MyTask, outcome: 'approved' | 'returned', comment = '') {
    return as.post(`/api/tasks/${task.id}/complete`, {
      version: task.version,
      outcome,
      ...(comment ? { comment } : {}),
    });
  }

  async function approve(as: ApiClient, requestId: string) {
    const task = await waitForTask(as, requestId);
    expect((await complete(as, task, 'approved')).status).toBe(200);
  }

  /** workflow 處理完目前收到的 Signal 之後才檢查「沒有出現」的 Task。 */
  const settle = () => new Promise((r) => setTimeout(r, 500));

  beforeAll(async () => {
    app = await startTestApp();
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    employee = (await signInAs('employee@river.test', '王小明')).client;
    const i = await signInAs('it@river.test', '張家豪');
    const s = await signInAs('security@river.test', '吳建宏');
    const f = await signInAs('finance@river.test', '李雅婷');
    const m = await signInAs('manager@river.test', '林美玲');
    itStaff = i.client;
    security = s.client;
    finance = f.client;
    manager = m.client;

    processId = await saveDraft(
      '採購－並行審批',
      purchaseFlow({
        itId: i.participantId,
        securityId: s.participantId,
        financeId: f.participantId,
        managerId: m.participantId,
      }),
    );
    expect((await designer.post(`/api/processes/${processId}/versions`, {})).status).toBe(201);
  });
  afterAll(() => app?.close());

  it('並行分支上的 Task 同時出現在各自處理人的待辦中', async () => {
    const id = await start('採購筆電');

    await waitForTask(itStaff, id);
    await waitForTask(finance, id);
    const d = await detail(id);
    expect(d.openTasks.map((t) => t.nodeName).sort()).toEqual(['IT 審批', '財務審批'].sort());
  });

  it('所有分支都完成後 Request 才繼續往下走；分支上的步驟依序進行', async () => {
    const id = await start('採購螢幕');

    // 財務這條分支先完成，另一條還在進行：匯合點之後的主管不會收到 Task。
    await approve(finance, id);
    await approve(itStaff, id);
    await settle();
    expect(await hasTask(manager, id)).toBe(false);

    // IT 這條分支的第二步完成後，兩條分支都到了匯合點。
    await approve(security, id);
    await approve(manager, id);

    const done = await eventually(
      () => detail(id),
      (r) => r.status === 'completed',
    );
    expect(done.tasks.map((t) => [t.nodeName, t.outcome])).toEqual([
      expect.anything(),
      expect.anything(),
      ['資安審批', 'approved'],
      ['主管審批', 'approved'],
    ]);
    expect(
      done.tasks
        .slice(0, 2)
        .map((t) => t.nodeName)
        .sort(),
    ).toEqual(['IT 審批', '財務審批'].sort());
    expect(done.events.filter((e) => e.type === 'request.completed')).toHaveLength(1);
  });

  it('任一分支 Return 時，其他分支的 open Task 都作廢，Request 變成 returned；重新送出後從頭開始', async () => {
    const id = await start('採購伺服器');
    const itTask = await waitForTask(itStaff, id);
    const financeTask = await waitForTask(finance, id);

    expect((await complete(finance, financeTask, 'returned', '請附報價單')).status).toBe(200);

    const returned = await detail(id);
    expect(returned.status).toBe('returned');
    expect(returned.openTasks).toEqual([]);
    expect(returned.tasks.find((t) => t.id === itTask.id)?.status).toBe('superseded');
    expect(await hasTask(itStaff, id)).toBe(false);
    // 作廢的 Task 不能再處理，也不會讓 IT 這條分支繼續往下走。
    expect((await complete(itStaff, itTask, 'approved')).status).toBe(409);
    await settle();
    expect(await hasTask(security, id)).toBe(false);
    expect(await hasTask(manager, id)).toBe(false);

    expect(
      (await employee.post(`/api/requests/${id}/resubmit`, { title: '採購伺服器（附報價）' }))
        .status,
    ).toBe(200);

    // 從頭開始：兩條分支都要重新審批。
    const again = await waitForTask(itStaff, id);
    expect(again.round).toBe(2);
    expect((await waitForTask(finance, id)).round).toBe(2);
    await approve(itStaff, id);
    await approve(finance, id);
    await approve(security, id);
    await approve(manager, id);
    const done = await eventually(
      () => detail(id),
      (r) => r.status === 'completed',
    );
    expect(done.round).toBe(2);
    expect(done.tasks.filter((t) => t.round === 2)).toHaveLength(4);
  });

  it('分支上較後面的步驟 Return 時，另一條分支已經完成也一樣從頭開始', async () => {
    const id = await start('採購授權');
    await approve(finance, id);
    await approve(itStaff, id);
    const securityTask = await waitForTask(security, id);
    expect((await complete(security, securityTask, 'returned', '授權範圍太大')).status).toBe(200);
    expect((await detail(id)).status).toBe('returned');

    expect(
      (await employee.post(`/api/requests/${id}/resubmit`, { title: '採購授權（縮小範圍）' }))
        .status,
    ).toBe(200);
    expect((await waitForTask(finance, id)).round).toBe(2);
    expect((await waitForTask(itStaff, id)).round).toBe(2);
  });

  it('並行進行中 Withdraw：每一條分支的 open Task 都作廢，workflow 結束', async () => {
    const id = await start('採購印表機');
    await waitForTask(itStaff, id);
    await waitForTask(finance, id);

    expect((await employee.post(`/api/requests/${id}/withdraw`, {})).status).toBe(200);

    const withdrawn = await detail(id);
    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.tasks.map((t) => t.status)).toEqual(['superseded', 'superseded']);
    const handle = app.temporal.workflow.getHandle(id);
    await eventually(
      async () => (await handle.describe()).status.name,
      (s) => s === 'COMPLETED',
    );
  });

  it('Withdraw 的 Signal 沒送到時，一條分支發現 Request 已經結束，其他分支也一起停下，workflow 結束', async () => {
    const id = await start('採購投影機');
    const itTask = await waitForTask(itStaff, id);
    await waitForTask(finance, id);

    // 模擬 API 已經寫入 Withdraw、但 Signal 沒送到：財務的 Task 作廢，IT 的 Task 剛好在這之前送出。
    await app.db.update(requests).set({ status: 'withdrawn' }).where(eq(requests.id, id));
    await app.db
      .update(tasks)
      .set({ status: 'superseded' })
      .where(and(eq(tasks.requestId, id), eq(tasks.nodeId, 'finance')));
    expect((await complete(itStaff, itTask, 'approved')).status).toBe(200);

    const handle = app.temporal.workflow.getHandle(id);
    await eventually(
      async () => (await handle.describe()).status.name,
      (s) => s === 'COMPLETED',
    );
    expect((await detail(id)).tasks.map((t) => t.nodeName).sort()).toEqual(
      ['IT 審批', '財務審批'].sort(),
    );
  });

  it('流程預覽列出每條分支上的步驟，不列出並行分支與匯合節點', async () => {
    const res = await employee.get('/api/processes/startable');
    const process = ((await res.json()) as StartableProcess[]).find((p) => p.id === processId);
    expect(process?.steps.map((s) => s.name)).toEqual([
      '開始',
      'IT 審批',
      '財務審批',
      '資安審批',
      '主管審批',
      '結束',
    ]);
  });

  it('split 與 join 沒有配對時不能發佈', async () => {
    const dsl = purchaseFlow({ itId: 'x', securityId: 'x', financeId: 'x', managerId: 'x' });
    dsl.edges = dsl.edges.map((e) => (e.id === 'e-finance-join' ? { ...e, target: 'end' } : e));
    const id = await saveDraft('採購－沒有配對', dsl);

    const res = await designer.post(`/api/processes/${id}/versions`, {});
    expect(res.status).toBe(422);
    expect(((await res.json()) as PublishRejected).errors.map((e) => [e.code, e.nodeId])).toEqual([
      ['PARALLEL_SPLIT_UNMATCHED', 'split'],
    ]);
  });
});
