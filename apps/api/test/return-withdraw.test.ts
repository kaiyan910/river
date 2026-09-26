import type { Permission } from '@river/auth';
import type { MyTask, Process, RequestDetail, RequestSummary } from '@river/contracts';
import {
  RESUBMITTED_SIGNAL,
  type ResubmittedSignal,
  WITHDRAW_SIGNAL,
} from '@river/contracts/workflow';
import type { ProcessDsl, ProcessNode } from '@river/dsl';
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

const expense: FormSchema = {
  id: 'expense',
  name: '報銷單',
  fields: [
    { id: 'f1', key: 'amount', type: 'money', label: '金額', required: true, rules: {} },
    { id: 'f2', key: 'reason', type: 'text', label: '事由', required: true, rules: {} },
  ],
};

const receipt: FormSchema = {
  id: 'receipt',
  name: '收據確認',
  fields: [
    { id: 'r1', key: 'checked', type: 'checkbox', label: '收據齊全', required: false, rules: {} },
  ],
};

const at = (y: number) => ({ x: 0, y });

/** start（開始表單：報銷單）→ 會計填表（收據確認）→ 主管審批 → end */
function expenseFlow(people: { accountantId: string; managerId: string }): ProcessDsl {
  const nodes: ProcessNode[] = [
    { id: 'start', type: 'start', name: '開始', formId: 'expense', position: at(0) },
    {
      id: 'accounting',
      type: 'form',
      name: '會計確認收據',
      formId: 'receipt',
      assignee: { type: 'participant', participantId: people.accountantId },
      position: at(170),
    },
    {
      id: 'manager',
      type: 'approval',
      name: '主管審批',
      assignee: { type: 'participant', participantId: people.managerId },
      position: at(340),
    },
    { id: 'end', type: 'end', name: '結束', position: at(510) },
  ];
  return {
    nodes,
    edges: [
      { id: 'e1', source: 'start', target: 'accounting' },
      { id: 'e2', source: 'accounting', target: 'manager' },
      { id: 'e3', source: 'manager', target: 'end' },
    ],
    forms: [expense, receipt],
  };
}

/** start → 主管審批 → end，沒有開始表單。 */
function singleApproval(managerId: string): ProcessDsl {
  return {
    nodes: [
      { id: 'start', type: 'start', name: '開始', position: at(0) },
      {
        id: 'manager',
        type: 'approval',
        name: '主管審批',
        assignee: { type: 'participant', participantId: managerId },
        position: at(170),
      },
      { id: 'end', type: 'end', name: '結束', position: at(340) },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'manager' },
      { id: 'e2', source: 'manager', target: 'end' },
    ],
    forms: [],
  };
}

describe('Return、重新送出與 Withdraw', () => {
  let app: TestApp;
  let designer: ApiClient;
  let initiator: ApiClient;
  let accountant: ApiClient;
  let manager: ApiClient;
  let managerId: string;
  let people: { accountantId: string; managerId: string };

  async function signInAs(email: string, name: string, permissions: Permission[] = []) {
    const { participantId } = await app.provisionParticipant({
      email,
      name,
      password: PASSWORD,
      permissions,
    });
    return { participantId, client: await app.signIn(email, PASSWORD) };
  }

  async function publish(name: string, dsl: ProcessDsl): Promise<string> {
    const created = (await (await designer.post('/api/processes', { name })).json()) as Process;
    expect((await designer.put(`/api/processes/${created.id}/draft`, { dsl })).status).toBe(200);
    expect((await designer.post(`/api/processes/${created.id}/versions`, {})).status).toBe(201);
    return created.id;
  }

  async function openTasks(as: ApiClient): Promise<MyTask[]> {
    const res = await as.get('/api/tasks/mine?status=open');
    expect(res.status).toBe(200);
    return (await res.json()) as MyTask[];
  }

  async function detail(id: string, as: ApiClient = initiator): Promise<RequestDetail> {
    const res = await as.get(`/api/requests/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as RequestDetail;
  }

  /** 等到 Request 有一個指派給 as 的 open Task。 */
  async function waitForTask(requestId: string, as: ApiClient): Promise<MyTask> {
    const tasks = await eventually(
      () => openTasks(as),
      (list) => list.some((t) => t.request.id === requestId),
    );
    return tasks.find((t) => t.request.id === requestId) as MyTask;
  }

  async function start(processId: string, title: string, data?: Record<string, unknown>) {
    const res = await initiator.post('/api/requests', { processId, title, data });
    expect(res.status).toBe(201);
    return (await res.json()) as RequestDetail;
  }

  function complete(
    as: ApiClient,
    task: { id: string; version: number },
    body: { outcome: 'approved' | 'returned' | 'submitted'; comment?: string; data?: object },
  ) {
    return as.post(`/api/tasks/${task.id}/complete`, { version: task.version, ...body });
  }

  const returnTask = (task: MyTask, comment: string, as = manager) =>
    complete(as, task, { outcome: 'returned', comment });

  const resubmit = (id: string, body: { title: string; data?: object }, as = initiator) =>
    as.post(`/api/requests/${id}/resubmit`, body);

  const withdraw = (id: string, comment?: string, as = initiator) =>
    as.post(`/api/requests/${id}/withdraw`, comment === undefined ? {} : { comment });

  beforeAll(async () => {
    app = await startTestApp();
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    initiator = (await signInAs('initiator@river.test', '王小明')).client;
    const a = await signInAs('accountant@river.test', '黃淑芬');
    accountant = a.client;
    const m = await signInAs('manager@river.test', '林美玲');
    manager = m.client;
    managerId = m.participantId;
    people = { accountantId: a.participantId, managerId };
  });
  afterAll(() => app?.close());

  it('Return 必須填寫意見；填表 Task 不能 Return', async () => {
    const processId = await publish('報銷－意見', expenseFlow(people));
    const request = await start(processId, '計程車費', { amount: 350, reason: '拜訪客戶' });
    const fill = await waitForTask(request.id, accountant);

    expect(
      (await complete(accountant, fill, { outcome: 'returned', comment: '缺收據' })).status,
    ).toBe(422);
    expect(
      (await complete(accountant, fill, { outcome: 'submitted', data: { checked: true } })).status,
    ).toBe(200);

    const approval = await waitForTask(request.id, manager);
    expect((await complete(manager, approval, { outcome: 'returned' })).status).toBe(400);
    expect((await returnTask(approval, '   ')).status).toBe(400);
    expect((await detail(request.id)).status).toBe('running');
  });

  it('Return 後 Request 變成 returned，發起人在「我的申請」看到意見，審批人的待辦清空', async () => {
    const processId = await publish('請假－Return', singleApproval(managerId));
    const request = await start(processId, '10/2 特休');
    const task = await waitForTask(request.id, manager);

    const res = await returnTask(task, '請補上代理人。');
    expect(res.status).toBe(200);

    const mine = (await (await initiator.get('/api/requests/mine')).json()) as RequestSummary[];
    expect(mine.find((r) => r.id === request.id)).toMatchObject({
      status: 'returned',
      openTasks: [],
      returned: {
        by: { id: managerId, name: '林美玲' },
        nodeName: '主管審批',
        comment: '請補上代理人。',
      },
    });
    const returned = await detail(request.id);
    expect(returned.status).toBe('returned');
    expect(returned.tasks).toMatchObject([
      {
        id: task.id,
        status: 'completed',
        outcome: 'returned',
        comment: '請補上代理人。',
        completedBy: { id: managerId, name: '林美玲' },
      },
    ]);
    expect(returned.events.map((e) => [e.type, e.actor?.name ?? null, e.comment])).toEqual([
      ['request.started', '王小明', null],
      ['task.created', null, null],
      ['task.returned', '林美玲', '請補上代理人。'],
    ]);
    expect((await openTasks(manager)).some((t) => t.request.id === request.id)).toBe(false);
  });

  it('Return 後重新送出會從頭開始：每一步都要重新處理，時間軸保留先前每一輪的紀錄', async () => {
    const processId = await publish('報銷－重送', expenseFlow(people));
    const request = await start(processId, '9 月交通費', { amount: 1200, reason: '台中出差' });

    const fill = await waitForTask(request.id, accountant);
    expect(
      (await complete(accountant, fill, { outcome: 'submitted', data: { checked: false } })).status,
    ).toBe(200);
    const approval = await waitForTask(request.id, manager);
    expect((await returnTask(approval, '金額和收據對不上，請修正。')).status).toBe(200);

    // 修改後的資料一樣要通過開始表單的驗證。
    const invalid = await resubmit(request.id, { title: '9 月交通費', data: { amount: 'abc' } });
    expect(invalid.status).toBe(422);
    expect((await detail(request.id)).status).toBe('returned');

    const res = await resubmit(request.id, {
      title: '9 月交通費（修正）',
      data: { amount: 980, reason: '台中出差' },
    });
    expect(res.status).toBe(200);
    const resubmitted = (await res.json()) as RequestDetail;
    expect(resubmitted).toMatchObject({
      status: 'running',
      round: 2,
      title: '9 月交通費（修正）',
      returned: null,
    });
    // 這一輪只看得到新的開始表單資料；會計確認要重新填。
    expect(resubmitted.data).toMatchObject([
      { nodeId: 'start', data: { amount: 980, reason: '台中出差' } },
    ]);

    // 從頭開始：會計確認收據要重新做一次，不會直接跳到主管審批。
    const refill = await waitForTask(request.id, accountant);
    expect(refill.id).not.toBe(fill.id);
    expect(refill.round).toBe(2);
    expect((await openTasks(manager)).some((t) => t.request.id === request.id)).toBe(false);
    expect(
      (await complete(accountant, refill, { outcome: 'submitted', data: { checked: true } }))
        .status,
    ).toBe(200);
    const reapproval = await waitForTask(request.id, manager);
    expect(reapproval.id).not.toBe(approval.id);
    expect((await complete(manager, reapproval, { outcome: 'approved' })).status).toBe(200);

    const done = await eventually(
      () => detail(request.id),
      (d) => d.status === 'completed',
    );
    expect(done.data.map((d) => [d.nodeId, d.data])).toEqual([
      ['start', { amount: 980, reason: '台中出差' }],
      ['accounting', { checked: true }],
    ]);
    expect(done.tasks.map((t) => [t.nodeName, t.round, t.outcome])).toEqual([
      ['會計確認收據', 1, 'submitted'],
      ['主管審批', 1, 'returned'],
      ['會計確認收據', 2, 'submitted'],
      ['主管審批', 2, 'approved'],
    ]);
    expect(
      done.events.map((e) => [e.type, e.actor?.name ?? null, e.task?.nodeName ?? null]),
    ).toEqual([
      ['request.started', '王小明', null],
      ['task.created', null, '會計確認收據'],
      ['task.completed', '黃淑芬', '會計確認收據'],
      ['task.created', null, '主管審批'],
      ['task.returned', '林美玲', '主管審批'],
      ['request.resubmitted', '王小明', null],
      ['task.created', null, '會計確認收據'],
      ['task.completed', '黃淑芬', '會計確認收據'],
      ['task.created', null, '主管審批'],
      ['task.completed', '林美玲', '主管審批'],
      ['request.completed', null, null],
    ]);
  });

  it('只有發起人可以重新送出，而且只能在 returned 狀態', async () => {
    const processId = await publish('請假－重送限制', singleApproval(managerId));
    const request = await start(processId, '補休');
    const task = await waitForTask(request.id, manager);

    expect((await resubmit(request.id, { title: '補休' })).status).toBe(409);
    expect((await returnTask(task, '日期寫錯了')).status).toBe(200);
    expect((await resubmit(request.id, { title: '補休' }, manager)).status).toBe(404);
    // 沒有開始表單的 Process 不接受表單資料。
    expect((await resubmit(request.id, { title: '補休', data: { x: 1 } })).status).toBe(422);

    const [first, second] = await Promise.all([
      resubmit(request.id, { title: '補休（改 10/3）' }),
      resubmit(request.id, { title: '補休（改 10/3）' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);

    const again = await waitForTask(request.id, manager);
    expect((await complete(manager, again, { outcome: 'approved' })).status).toBe(200);
    const done = await eventually(
      () => detail(request.id),
      (d) => d.status === 'completed',
    );
    expect(done.events.filter((e) => e.type === 'request.resubmitted')).toHaveLength(1);
    expect(done.tasks).toHaveLength(2);
  });

  it('連續 Return 多次後，Request 仍然能正常完成（workflow 以 continueAsNew 從頭開始）', async () => {
    const processId = await publish('採購－多次 Return', singleApproval(managerId));
    const request = await start(processId, '筆電採購');
    const handle = app.temporal.workflow.getHandle(request.id);
    const firstRun = (await handle.describe()).runId;

    const rounds = 6;
    for (let round = 1; round <= rounds; round++) {
      const task = await waitForTask(request.id, manager);
      expect(task.round).toBe(round);
      expect((await returnTask(task, `第 ${round} 次退回`)).status).toBe(200);
      expect((await resubmit(request.id, { title: `筆電採購 v${round + 1}` })).status).toBe(200);
    }
    const last = await waitForTask(request.id, manager);
    expect(last.round).toBe(rounds + 1);
    expect((await complete(manager, last, { outcome: 'approved' })).status).toBe(200);

    const done = await eventually(
      () => detail(request.id),
      (d) => d.status === 'completed',
    );
    expect(done.round).toBe(rounds + 1);
    expect(done.events.filter((e) => e.type === 'task.returned')).toHaveLength(rounds);
    expect(done.events.filter((e) => e.type === 'task.created')).toHaveLength(rounds + 1);
    // 每次重新送出都換成新的 workflow run，history 不會一直長大。
    expect((await handle.describe()).runId).not.toBe(firstRun);
  });

  it('resubmitted Signal 是冪等的：同一輪重送多次不會多跑一次', async () => {
    const processId = await publish('出差－重送冪等', singleApproval(managerId));
    const request = await start(processId, '高雄出差');
    const task = await waitForTask(request.id, manager);
    expect((await returnTask(task, '請附議程')).status).toBe(200);
    expect((await resubmit(request.id, { title: '高雄出差（附議程）' })).status).toBe(200);
    const second = await waitForTask(request.id, manager);

    const handle = app.temporal.workflow.getHandle(request.id);
    const again: ResubmittedSignal = { round: 2 };
    await handle.signal(RESUBMITTED_SIGNAL, again);
    await handle.signal(RESUBMITTED_SIGNAL, { round: 1 } satisfies ResubmittedSignal);

    await new Promise((r) => setTimeout(r, 500));
    const after = await detail(request.id);
    expect(after.status).toBe('running');
    expect(after.openTasks.map((t) => t.id)).toEqual([second.id]);
    expect(after.tasks).toHaveLength(2);
  });

  it('Request 進行中時發起人可以 Withdraw：open 的 Task 作廢，審批人不能再處理', async () => {
    const processId = await publish('請假－撤回', singleApproval(managerId));
    const request = await start(processId, '10/9 事假');
    const task = await waitForTask(request.id, manager);

    const res = await withdraw(request.id, '行程取消了');
    expect(res.status).toBe(200);
    expect(((await res.json()) as RequestDetail).status).toBe('withdrawn');

    const withdrawn = await detail(request.id);
    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.openTasks).toEqual([]);
    expect(withdrawn.tasks).toMatchObject([{ id: task.id, status: 'superseded', outcome: null }]);
    expect(
      withdrawn.events.map((e) => [
        e.type,
        e.actor?.name ?? null,
        e.task?.nodeName ?? null,
        e.comment,
      ]),
    ).toEqual([
      ['request.started', '王小明', null, null],
      ['task.created', null, '主管審批', null],
      ['request.withdrawn', '王小明', null, '行程取消了'],
      ['task.superseded', null, '主管審批', null],
    ]);
    expect((await openTasks(manager)).some((t) => t.request.id === request.id)).toBe(false);
    // 審批人畫面上還是舊的 Task：核准會被拒絕，而且說明原因。
    const late = await complete(manager, task, { outcome: 'approved' });
    expect(late.status).toBe(409);
    expect(((await late.json()) as { message: string }).message).toContain('撤回');

    // workflow 已經結束，Request 不會再往下走。
    await new Promise((r) => setTimeout(r, 500));
    expect((await detail(request.id)).events).toEqual(withdrawn.events);
    expect((await app.temporal.workflow.getHandle(request.id).describe()).status.name).toBe(
      'COMPLETED',
    );
  });

  it('被 Return 的 Request 也可以 Withdraw；完成或已撤回的不行，其他人也不行', async () => {
    const processId = await publish('採購－撤回', singleApproval(managerId));
    const returned = await start(processId, '螢幕採購');
    const task = await waitForTask(returned.id, manager);
    expect((await returnTask(task, '請附報價單')).status).toBe(200);

    expect((await withdraw(returned.id, undefined, manager)).status).toBe(404);
    expect((await withdraw(returned.id)).status).toBe(200);
    expect((await detail(returned.id)).status).toBe('withdrawn');
    expect((await withdraw(returned.id)).status).toBe(409);
    expect((await resubmit(returned.id, { title: '螢幕採購' })).status).toBe(409);
    // 重複送出 withdraw Signal 沒有影響（workflow 已經結束）。
    await expect(
      app.temporal.workflow.getHandle(returned.id).signal(WITHDRAW_SIGNAL),
    ).rejects.toThrow();

    const completed = await start(processId, '鍵盤採購');
    const t = await waitForTask(completed.id, manager);
    expect((await complete(manager, t, { outcome: 'approved' })).status).toBe(200);
    await eventually(
      () => detail(completed.id),
      (d) => d.status === 'completed',
    );
    expect((await withdraw(completed.id)).status).toBe(409);
  });
});
