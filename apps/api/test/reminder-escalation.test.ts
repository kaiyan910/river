import type { Permission } from '@river/auth';
import type { MyTask, Process, PublishRejected, RequestDetail } from '@river/contracts';
import type { Assignee, Escalation, ProcessDsl, ProcessNode, Reminder } from '@river/dsl';
import type { EmailMessage } from '@river/email';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiClient, startTestApp, type TestApp } from './harness.js';

const PASSWORD = 'correct horse battery staple';
const HOUR = 3_600_000;

async function eventually<T>(read: () => Promise<T> | T, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`等不到預期的狀態：${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

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
    forms: [],
  };
}

const approval = (
  id: string,
  assignee: Assignee,
  timeout: { reminder?: Reminder; escalation?: Escalation } = {},
): ProcessNode => ({
  id,
  type: 'approval',
  name: `審批 ${id}`,
  assignee,
  position: at(170),
  ...timeout,
});

describe('Reminder 與 Escalation', () => {
  let app: TestApp;
  let designer: ApiClient;
  let employee: ApiClient;
  let approver: ApiClient;
  let approverId: string;
  let boss: ApiClient;
  let bossId: string;
  let director: ApiClient;
  let directorId: string;
  let loner: ApiClient;
  let lonerId: string;
  let hr: ApiClient;
  let hrRoleId: string;
  let financeRoleId: string;
  let finance: ApiClient;

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
    const res = await designer.post(`/api/processes/${created.id}/versions`, {});
    expect(res.status).toBe(201);
    return created.id;
  }

  async function start(as: ApiClient, processId: string, title: string): Promise<RequestDetail> {
    const res = await as.post('/api/requests', { processId, title });
    expect(res.status).toBe(201);
    return (await res.json()) as RequestDetail;
  }

  async function openTasks(as: ApiClient): Promise<MyTask[]> {
    return (await (await as.get('/api/tasks/mine?status=open')).json()) as MyTask[];
  }

  async function waitForTask(requestId: string, as: ApiClient): Promise<MyTask> {
    const tasks = await eventually(
      () => openTasks(as),
      (list) => list.some((t) => t.request.id === requestId),
    );
    return tasks.find((t) => t.request.id === requestId) as MyTask;
  }

  async function detail(id: string, as: ApiClient = employee): Promise<RequestDetail> {
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

  /** 主旨含有 title 的信（每個測試用不同的標題，只看自己那筆 Request 的信）。 */
  const mailsAbout = (title: string, subject?: string): EmailMessage[] =>
    app.emails.sent.filter(
      (m) => m.subject.includes(title) && (!subject || m.subject.includes(subject)),
    );
  const reminders = (title: string) => mailsAbout(title, '提醒');
  const escalations = (title: string) => mailsAbout(title, '逾時轉交');

  /** 等到 workflow 處理完快轉後到期的 timer（例如寄出 count 封 Reminder）。 */
  const waitForMails = (read: () => EmailMessage[], count: number) =>
    eventually(read, (list) => list.length >= count);

  /** 讓 workflow 有機會處理到期的 timer；用來確認「不會」發生的事情。 */
  const settle = () => new Promise((r) => setTimeout(r, 1_000));

  beforeAll(async () => {
    app = await startTestApp();
    const admin = (await signInAs('admin@river.test', '系統管理員', ['user.manage', 'role.manage']))
      .client;
    const setManager = async (id: string, managerId: string) =>
      expect((await admin.patch(`/api/participants/${id}`, { managerId })).status).toBe(200);
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;

    ({ client: director, participantId: directorId } = await signInAs(
      'director@river.test',
      '林協理',
    ));
    ({ client: boss, participantId: bossId } = await signInAs('boss@river.test', '黃淑芬'));
    ({ client: approver, participantId: approverId } = await signInAs(
      'approver@river.test',
      '張家豪',
    ));
    ({ client: loner, participantId: lonerId } = await signInAs('loner@river.test', '周建國'));
    const e = await signInAs('employee@river.test', '王小明');
    employee = e.client;
    await setManager(e.participantId, bossId);
    await setManager(bossId, directorId);
    await setManager(approverId, bossId);

    const h = await signInAs('hr@river.test', '吳雅婷');
    hr = h.client;
    hrRoleId = ((await (await admin.post('/api/roles', { name: '人資' })).json()) as { id: string })
      .id;
    expect((await admin.put(`/api/roles/${hrRoleId}/members/${h.participantId}`)).status).toBe(204);

    financeRoleId = (
      (await (await admin.post('/api/roles', { name: '財務' })).json()) as {
        id: string;
      }
    ).id;
    for (const [address, name] of [
      ['finance.a@river.test', '劉怡君'],
      ['finance.b@river.test', '蔡依林'],
    ] as const) {
      const { participantId, client } = await signInAs(address, name);
      expect((await admin.put(`/api/roles/${financeRoleId}/members/${participantId}`)).status).toBe(
        204,
      );
      finance = client;
    }
  });
  afterAll(() => app?.close());

  it('指派給 Role 的節點設定 Escalation 卻沒有指定目標時不能發佈', async () => {
    const created = (await (
      await designer.post('/api/processes', { name: '採購－沒有 Escalation 目標' })
    ).json()) as Process;
    const dsl = chain(
      approval(
        'finance',
        { type: 'role', roleId: financeRoleId },
        { escalation: { afterHours: 8 } },
      ),
    );
    expect((await designer.put(`/api/processes/${created.id}/draft`, { dsl })).status).toBe(200);

    const res = await designer.post(`/api/processes/${created.id}/versions`, {});
    expect(res.status).toBe(422);
    expect(((await res.json()) as PublishRejected).errors).toEqual([
      { nodeId: 'finance', code: 'ESCALATION_NO_TARGET', message: expect.any(String) },
    ]);
  });

  it('Reminder 時間到時寄信給目前的處理人，只寄一次，不改變 Task 由誰負責', async () => {
    const processId = await publish(
      '請假－一次 Reminder',
      chain(
        approval(
          'approve',
          { type: 'participant', participantId: approverId },
          { reminder: { afterHours: 24, repeat: false } },
        ),
      ),
    );
    const request = await start(employee, processId, '10/3 特休');
    const task = await waitForTask(request.id, approver);

    await app.skipTime(23 * HOUR);
    await settle();
    expect(reminders('10/3 特休')).toEqual([]);

    await app.skipTime(2 * HOUR);
    const [mail] = await waitForMails(() => reminders('10/3 特休'), 1);
    expect(mail?.to).toBe('approver@river.test');
    expect(mail?.text).toContain(`/tasks?id=${task.id}`);

    await app.skipTime(72 * HOUR);
    await settle();
    expect(reminders('10/3 特休')).toHaveLength(1);

    const reminded = await detail(request.id);
    expect(reminded.events.map((e) => [e.type, e.task?.assignee.name ?? null])).toEqual([
      ['request.started', null],
      ['task.created', '張家豪'],
      ['task.reminded', '張家豪'],
    ]);
    expect((await openTasks(approver)).map((t) => t.id)).toContain(task.id);
    expect((await approve(approver, task)).status).toBe(200);
  });

  it('重複的 Reminder：每隔 N 小時寄一次；指派給 Role 時寄給每一位成員', async () => {
    const processId = await publish(
      '採購－重複 Reminder',
      chain(
        approval(
          'finance',
          { type: 'role', roleId: financeRoleId },
          { reminder: { afterHours: 4, repeat: true } },
        ),
      ),
    );
    const request = await start(employee, processId, '筆電採購');
    await waitForTask(request.id, finance);

    await app.skipTime(4 * HOUR + 60_000);
    const first = await waitForMails(() => reminders('筆電採購'), 2);
    expect(first.map((m) => m.to).sort()).toEqual(['finance.a@river.test', 'finance.b@river.test']);

    await app.skipTime(4 * HOUR);
    await waitForMails(() => reminders('筆電採購'), 4);
    await app.skipTime(4 * HOUR);
    await waitForMails(() => reminders('筆電採購'), 6);

    const reminded = await eventually(
      () => detail(request.id),
      (d) => d.events.filter((e) => e.type === 'task.reminded').length === 3,
    );
    expect(reminded.tasks.map((t) => t.status)).toEqual(['open']);
  });

  it('指派給特定人：Escalation 時原 Task 作廢，轉給處理人的 Manager，時間軸記錄原因；絕不自動核准', async () => {
    const processId = await publish(
      '報銷－Escalation 給 Manager',
      chain(
        approval(
          'approve',
          { type: 'participant', participantId: approverId },
          { escalation: { afterHours: 48, fallbackRoleId: hrRoleId } },
        ),
      ),
    );
    const request = await start(employee, processId, '九月交通費');
    const original = await waitForTask(request.id, approver);

    await app.skipTime(49 * HOUR);
    const escalated = await waitForTask(request.id, boss);
    expect(escalated.id).not.toBe(original.id);
    expect(escalated.assignee).toEqual({ type: 'participant', id: bossId, name: '黃淑芬' });
    expect((await openTasks(approver)).some((t) => t.request.id === request.id)).toBe(false);
    const [mail] = await waitForMails(() => escalations('九月交通費'), 1);
    expect(mail?.to).toBe('boss@river.test');
    expect(mail?.text).toContain(`/tasks?id=${escalated.id}`);

    // 原處理人不能再處理作廢的 Task。
    expect((await approve(approver, original)).status).toBe(409);
    const d = await detail(request.id);
    expect(d.status).toBe('running');
    expect(d.tasks.map((t) => [t.assignee.name, t.status])).toEqual([
      ['張家豪', 'superseded'],
      ['黃淑芬', 'open'],
    ]);
    expect(d.events.map((e) => [e.type, e.task?.assignee.name ?? null])).toEqual([
      ['request.started', null],
      ['task.created', '張家豪'],
      ['task.escalated', '黃淑芬'],
    ]);

    expect((await approve(boss, escalated)).status).toBe(200);
    await eventually(
      () => detail(request.id),
      (r) => r.status === 'completed',
    );
  });

  it('處理人沒有 Manager 時，Escalation 轉給 Fallback Role，時間軸記錄原因', async () => {
    const processId = await publish(
      '報銷－處理人沒有 Manager',
      chain(
        approval(
          'approve',
          { type: 'participant', participantId: lonerId },
          { escalation: { afterHours: 8, fallbackRoleId: hrRoleId } },
        ),
      ),
    );
    const request = await start(employee, processId, '文具報銷');
    await waitForTask(request.id, loner);

    await app.skipTime(9 * HOUR);
    const escalated = await waitForTask(request.id, hr);
    expect(escalated.assignee).toEqual({ type: 'role', id: hrRoleId, name: '人資' });
    const event = (await detail(request.id)).events.at(-1);
    expect(event).toMatchObject({ type: 'task.escalated', fallbackReason: 'no_manager' });
    expect((await approve(hr, escalated)).status).toBe(200);
  });

  it('指派給發起人的 Manager：Escalation 轉給這位 Manager 的 Manager', async () => {
    const processId = await publish(
      '請假－Manager 審批',
      chain(
        approval(
          'approve',
          { type: 'manager', fallbackRoleId: hrRoleId },
          { escalation: { afterHours: 24 } },
        ),
      ),
    );
    const request = await start(employee, processId, '育嬰假');
    await waitForTask(request.id, boss);

    await app.skipTime(25 * HOUR);
    const escalated = await waitForTask(request.id, director);
    expect(escalated.assignee).toEqual({ type: 'participant', id: directorId, name: '林協理' });
    expect((await approve(director, escalated)).status).toBe(200);
  });

  it('指派給 Role：Escalation 轉給 Designer 指定的對象；Reminder 之後寄給新的處理人', async () => {
    const processId = await publish(
      '採購－Role Escalation',
      chain(
        approval(
          'finance',
          { type: 'role', roleId: financeRoleId },
          {
            reminder: { afterHours: 10, repeat: true },
            escalation: {
              afterHours: 24,
              target: { type: 'participant', participantId: directorId },
            },
          },
        ),
      ),
    );
    const request = await start(employee, processId, '伺服器採購');
    await waitForTask(request.id, finance);

    await app.skipTime(25 * HOUR);
    const escalated = await waitForTask(request.id, director);
    expect(escalated.assignee).toEqual({ type: 'participant', id: directorId, name: '林協理' });
    // 10、20 小時各寄給兩位成員。
    expect(reminders('伺服器採購')).toHaveLength(4);

    // Escalation 後重新計時，10 小時後提醒新的處理人。
    await app.skipTime(10 * HOUR);
    const all = await waitForMails(() => reminders('伺服器採購'), 5);
    expect(all.at(-1)?.to).toBe('director@river.test');
    expect((await approve(director, escalated)).status).toBe(200);
  });

  it('Task 在逾時前完成：timer 取消，不會發出 Reminder 或 Escalation', async () => {
    const processId = await publish(
      '報銷－準時處理',
      chain(
        approval(
          'first',
          { type: 'participant', participantId: approverId },
          {
            reminder: { afterHours: 4, repeat: true },
            escalation: { afterHours: 8, fallbackRoleId: hrRoleId },
          },
        ),
        {
          ...approval('second', { type: 'participant', participantId: lonerId }),
          position: at(340),
        },
      ),
    );
    const request = await start(employee, processId, '準時的報銷');
    const first = await waitForTask(request.id, approver);
    expect((await approve(approver, first)).status).toBe(200);
    await waitForTask(request.id, loner);

    await app.skipTime(100 * HOUR);
    await settle();
    expect(reminders('準時的報銷')).toEqual([]);
    expect(escalations('準時的報銷')).toEqual([]);
    const d = await detail(request.id);
    expect(d.events.map((e) => e.type)).toEqual([
      'request.started',
      'task.created',
      'task.completed',
      'task.created',
    ]);
    expect((await openTasks(boss)).some((t) => t.request.id === request.id)).toBe(false);
  });
});
