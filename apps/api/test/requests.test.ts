import type { Permission } from '@river/auth';
import type { MyTask, RequestDetail, RequestSummary, StartableProcess } from '@river/contracts';
import { TASK_COMPLETED_SIGNAL, type TaskCompletedSignal } from '@river/contracts/workflow';
import type { ProcessDsl } from '@river/dsl';
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

describe('發起並核准 Request', () => {
  let app: TestApp;
  let designer: ApiClient;
  let initiator: ApiClient;
  let approver: ApiClient;
  let approverId: string;

  async function signInAs(email: string, name: string, permissions: Permission[] = []) {
    const { participantId } = await app.provisionParticipant({
      email,
      name,
      password: PASSWORD,
      permissions,
    });
    return { participantId, client: await app.signIn(email, PASSWORD) };
  }

  /** 建立 Process、儲存草稿並發佈；回傳 Process ID。 */
  async function publish(name: string, dsl: ProcessDsl): Promise<string> {
    const created = (await (await designer.post('/api/processes', { name })).json()) as {
      id: string;
    };
    expect((await designer.put(`/api/processes/${created.id}/draft`, { dsl })).status).toBe(200);
    expect((await designer.post(`/api/processes/${created.id}/versions`, {})).status).toBe(201);
    return created.id;
  }

  async function openTasks(as: ApiClient): Promise<MyTask[]> {
    const res = await as.get('/api/tasks/mine?status=open');
    expect(res.status).toBe(200);
    return (await res.json()) as MyTask[];
  }

  async function startRequest(processId: string, title: string): Promise<RequestDetail> {
    const res = await initiator.post('/api/requests', { processId, title });
    expect(res.status).toBe(201);
    return (await res.json()) as RequestDetail;
  }

  async function detail(id: string, as: ApiClient = initiator): Promise<RequestDetail> {
    const res = await as.get(`/api/requests/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as RequestDetail;
  }

  /** 發起後等到 workflow 建立第一個 Task，回傳這個 Task。 */
  async function startAndWaitForTask(processId: string, title: string, as = approver) {
    const request = await startRequest(processId, title);
    const tasks = await eventually(
      () => openTasks(as),
      (list) => list.some((t) => t.request.id === request.id),
    );
    return { request, task: tasks.find((t) => t.request.id === request.id) as MyTask };
  }

  function approve(task: { id: string; version: number }, comment?: string, as = approver) {
    return as.post(`/api/tasks/${task.id}/complete`, {
      outcome: 'approved',
      version: task.version,
      comment,
    });
  }

  beforeAll(async () => {
    app = await startTestApp();
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    initiator = (await signInAs('initiator@river.test', '王小明')).client;
    const a = await signInAs('approver@river.test', '林美玲');
    approver = a.client;
    approverId = a.participantId;
  });
  afterAll(() => app?.close());

  it('Participant 在入口網站看到已發佈的 Process 與它的步驟，沒發佈過的不會出現', async () => {
    const processId = await publish(
      '請假',
      approvalChain({ id: 'manager', name: '主管審批', approverId }),
    );
    await designer.post('/api/processes', { name: '還在設計的流程' });

    const res = await initiator.get('/api/processes/startable');
    expect(res.status).toBe(200);
    const list = (await res.json()) as StartableProcess[];
    expect(list.map((p) => p.name)).toEqual(['請假']);
    expect(list[0]).toEqual({
      id: processId,
      name: '請假',
      version: 1,
      steps: [
        { nodeId: 'start', type: 'start', name: '開始', assignee: null, formId: null },
        {
          nodeId: 'manager',
          type: 'approval',
          name: '主管審批',
          assignee: { id: approverId, name: '林美玲' },
          formId: null,
        },
        { nodeId: 'end', type: 'end', name: '結束', assignee: null, formId: null },
      ],
      startForm: null,
    });
  });

  it('發起 Request 後，審批人在「我的待辦」看到 Task', async () => {
    const processId = await publish(
      '報銷',
      approvalChain({ id: 'finance', name: '財務審核', approverId }),
    );

    const request = await startRequest(processId, '9 月台中出差交通費');
    expect(request).toMatchObject({
      title: '9 月台中出差交通費',
      status: 'running',
      process: { id: processId, name: '報銷', version: 1 },
      initiator: { name: '王小明' },
    });

    const tasks = await eventually(
      () => openTasks(approver),
      (list) => list.some((t) => t.request.id === request.id),
    );
    expect(tasks.find((t) => t.request.id === request.id)).toMatchObject({
      nodeName: '財務審核',
      status: 'open',
      request: {
        title: '9 月台中出差交通費',
        process: { name: '報銷' },
        initiator: { name: '王小明' },
      },
    });
    expect(await openTasks(initiator)).toEqual([]);
  });

  it('審批人核准後 Request 完成，「我的申請」與時間軸記錄每一次狀態變化', async () => {
    const processId = await publish(
      '採購',
      approvalChain({ id: 'manager', name: '主管審批', approverId }),
    );
    const { request, task } = await startAndWaitForTask(processId, 'JetBrains 授權續約');

    const res = await approve(task, '同意，記得用年約價。');
    expect(res.status).toBe(200);

    const done = await eventually(
      () => detail(request.id),
      (d) => d.status === 'completed',
    );
    expect(done.openTasks).toEqual([]);
    expect(done.tasks).toMatchObject([
      {
        nodeName: '主管審批',
        status: 'completed',
        outcome: 'approved',
        comment: '同意，記得用年約價。',
        completedBy: { id: approverId, name: '林美玲' },
      },
    ]);
    expect(
      done.events.map((e) => [e.type, e.actor?.name ?? null, e.task?.nodeName ?? null, e.comment]),
    ).toEqual([
      ['request.started', '王小明', null, null],
      ['task.created', null, '主管審批', null],
      ['task.completed', '林美玲', '主管審批', '同意，記得用年約價。'],
      ['request.completed', null, null, null],
    ]);

    const mine = (await (await initiator.get('/api/requests/mine')).json()) as RequestSummary[];
    expect(mine.find((r) => r.id === request.id)).toMatchObject({
      status: 'completed',
      openTasks: [],
      updatedAt: done.events.at(-1)?.at,
    });
    expect((await openTasks(approver)).some((t) => t.id === task.id)).toBe(false);
    const handled = (await (
      await approver.get('/api/tasks/mine?status=completed')
    ).json()) as MyTask[];
    expect(handled.find((t) => t.id === task.id)).toMatchObject({
      status: 'completed',
      request: { id: request.id, status: 'completed' },
    });
  });

  it('進行中的 Request 在「我的申請」顯示目前等待的步驟與審批人', async () => {
    const processId = await publish(
      '設備借用',
      approvalChain({ id: 'manager', name: '主管審批', approverId }),
    );
    const { request } = await startAndWaitForTask(processId, '借用 4K 投影機');

    const mine = (await (await initiator.get('/api/requests/mine')).json()) as RequestSummary[];
    expect(mine[0]).toMatchObject({
      id: request.id,
      status: 'running',
      process: { name: '設備借用', version: 1 },
      openTasks: [{ nodeName: '主管審批', assignee: { id: approverId, name: '林美玲' } }],
    });
    expect(mine[0]?.number).toBeGreaterThan(0);
  });

  it('先送出者勝出：同一個 Task 第二次核准收到「已由 X 處理」，時間軸只記一次', async () => {
    const processId = await publish(
      '加班申請',
      approvalChain({ id: 'manager', name: '主管審批', approverId }),
    );
    const { request, task } = await startAndWaitForTask(processId, '9/27 週六上線加班');

    const [first, second] = await Promise.all([approve(task), approve(task)]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(((await loser.json()) as { message: string }).message).toBe('已由 林美玲 處理。');

    const done = await eventually(
      () => detail(request.id),
      (d) => d.status === 'completed',
    );
    expect(done.events.filter((e) => e.type === 'task.completed')).toHaveLength(1);
  });

  it('Task 版本已經變更時不能核准', async () => {
    const processId = await publish(
      '用印',
      approvalChain({ id: 'manager', name: '主管審批', approverId }),
    );
    const { task } = await startAndWaitForTask(processId, '合約用印');

    const res = await approve({ id: task.id, version: task.version + 1 });
    expect(res.status).toBe(409);
    expect((await openTasks(approver)).some((t) => t.id === task.id)).toBe(true);
  });

  it('不是指派對象的人不能核准，也看不到別人的 Request', async () => {
    const processId = await publish(
      '出差',
      approvalChain({ id: 'manager', name: '主管審批', approverId }),
    );
    const { request, task } = await startAndWaitForTask(processId, '台中出差');
    const outsider = (await signInAs('outsider@river.test', '張志豪')).client;

    expect((await approve(task, undefined, initiator)).status).toBe(404);
    expect((await approve(task, undefined, outsider)).status).toBe(404);
    expect((await outsider.get(`/api/requests/${request.id}`)).status).toBe(404);
    expect((await detail(request.id, approver)).title).toBe('台中出差');
  });

  it('標題空白或 Process 還沒發佈時不能發起', async () => {
    const draftOnly = (await (
      await designer.post('/api/processes', { name: '草稿流程' })
    ).json()) as {
      id: string;
    };
    const published = await publish(
      '婚假',
      approvalChain({ id: 'manager', name: '主管審批', approverId }),
    );

    expect(
      (await initiator.post('/api/requests', { processId: published, title: '  ' })).status,
    ).toBe(400);
    expect(
      (await initiator.post('/api/requests', { processId: draftOnly.id, title: '試試看' })).status,
    ).toBe(404);
  });

  it('taskCompleted Signal 是冪等的：重複送出同一個 taskId 不會有任何影響', async () => {
    const processId = await publish(
      '調薪',
      approvalChain(
        { id: 'manager', name: '主管審批', approverId },
        { id: 'hr', name: '人資審核', approverId },
      ),
    );
    const { request, task: first } = await startAndWaitForTask(processId, '年度調薪');
    expect((await approve(first)).status).toBe(200);
    const second = await eventually(
      () => detail(request.id),
      (d) => d.openTasks.length === 1 && d.openTasks[0]?.id !== first.id,
    );

    // API 重試或網路重送：同一個 taskId 的 Signal 再送兩次。
    const handle = app.temporal.workflow.getHandle(request.id);
    const again: TaskCompletedSignal = { taskId: first.id, outcome: 'approved' };
    await handle.signal(TASK_COMPLETED_SIGNAL, again);
    await handle.signal(TASK_COMPLETED_SIGNAL, again);
    // 不存在的 Task 也一樣被忽略。
    await handle.signal(TASK_COMPLETED_SIGNAL, {
      taskId: crypto.randomUUID(),
      outcome: 'approved',
    });

    // workflow 處理完 Signal 後仍停在第二個審批，沒有多建 Task，也沒有提早完成。
    await new Promise((r) => setTimeout(r, 500));
    const after = await detail(request.id);
    expect(after.status).toBe('running');
    expect(after.openTasks).toEqual(second.openTasks);
    expect(after.tasks).toHaveLength(2);
    expect(after.events).toEqual(second.events);

    const secondTask = after.tasks.find((t) => t.status === 'open');
    expect((await approve(secondTask as { id: string; version: number })).status).toBe(200);
    const done = await eventually(
      () => detail(request.id),
      (d) => d.status === 'completed',
    );
    expect(done.events.map((e) => [e.type, e.task?.nodeName ?? null])).toEqual([
      ['request.started', null],
      ['task.created', '主管審批'],
      ['task.completed', '主管審批'],
      ['task.created', '人資審核'],
      ['task.completed', '人資審核'],
      ['request.completed', null],
    ]);

    // 完成之後再送也沒有影響（workflow 已經結束，Signal 送不進去）。
    await expect(handle.signal(TASK_COMPLETED_SIGNAL, again)).rejects.toThrow();
    expect((await detail(request.id)).events).toEqual(done.events);
  });
});
