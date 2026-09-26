import { PERMISSION_PRESETS, type Permission } from '@river/auth';
import type {
  DeactivationImpact,
  MyTask,
  Participant,
  Process,
  RequestDetail,
  RequestSummary,
} from '@river/contracts';
import type { Assignee, Escalation, ProcessDsl, ProcessNode, Reminder } from '@river/dsl';
import type { EmailMessage } from '@river/email';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiClient, startTestApp, type TestApp } from './harness.js';

const PASSWORD = 'correct horse battery staple';
const HOUR = 3_600_000;
/** harness 裡瀏覽器所在的 origin；信件裡的連結以它為準。 */
const ORIGIN = 'http://river.test';

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

/** start → 依序經過每個審批節點 → end */
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
  name: string,
  assignee: Assignee,
  timeout: { reminder?: Reminder; escalation?: Escalation } = {},
): ProcessNode => ({
  id,
  type: 'approval',
  name,
  assignee,
  position: at(170),
  ...timeout,
});

const person = (participantId: string) => ({ type: 'participant' as const, participantId });

/** start → 並行分支（兩位審批人同時審批）→ 匯合 → end */
function parallel(aId: string, bId: string): ProcessDsl {
  return {
    nodes: [
      { id: 'start', type: 'start', name: '開始', position: at(0) },
      { id: 'split', type: 'parallelSplit', name: '同時審批', position: at(170) },
      approval('a', '審批 A', person(aId)),
      approval('b', '審批 B', person(bId)),
      { id: 'join', type: 'parallelJoin', name: '匯合', position: at(510) },
      { id: 'end', type: 'end', name: '結束', position: at(680) },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'split' },
      { id: 'e2', source: 'split', target: 'a' },
      { id: 'e3', source: 'split', target: 'b' },
      { id: 'e4', source: 'a', target: 'join' },
      { id: 'e5', source: 'b', target: 'join' },
      { id: 'e6', source: 'join', target: 'end' },
    ],
    forms: [],
  };
}

describe('Cancel、Reassign 與停用帳號', () => {
  let app: TestApp;
  let admin: ApiClient;
  let adminId: string;
  let designer: ApiClient;
  let employee: ApiClient;
  let reviewer: ApiClient;
  let reviewerId: string;
  let deputy: ApiClient;
  let deputyId: string;

  let counter = 0;
  async function signInAs(email: string, name: string, permissions: Permission[] = []) {
    const { participantId } = await app.provisionParticipant({
      email,
      name,
      password: PASSWORD,
      permissions,
    });
    return { participantId, client: await app.signIn(email, PASSWORD) };
  }

  /** 每個測試各自的新人，停用或改派不會影響其他測試。 */
  function newPerson(name: string, permissions: Permission[] = []) {
    counter += 1;
    const email = `person${counter}@river.test`;
    return signInAs(email, name, permissions).then((p) => ({ ...p, email }));
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
    const res = await as.get('/api/tasks/mine?status=open');
    expect(res.status).toBe(200);
    return (await res.json()) as MyTask[];
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

  const approve = (as: ApiClient, task: { id: string; version: number }) =>
    as.post(`/api/tasks/${task.id}/complete`, { outcome: 'approved', version: task.version });

  const cancel = (id: string, comment?: string, as = admin) =>
    as.post(`/api/requests/${id}/cancel`, comment === undefined ? {} : { comment });

  const reassign = (taskId: string, assigneeId: string, as = admin, comment?: string) =>
    as.post(`/api/tasks/${taskId}/reassign`, { assigneeId, comment });

  async function pendingReassign(as = admin): Promise<MyTask[]> {
    const res = await as.get('/api/tasks/pending-reassign');
    expect(res.status).toBe(200);
    return (await res.json()) as MyTask[];
  }

  const mailsTo = (address: string): EmailMessage[] =>
    app.emails.sent.filter((m) => m.to === address);

  beforeAll(async () => {
    app = await startTestApp();
    ({ participantId: adminId, client: admin } = await signInAs('admin@river.test', '系統管理員', [
      ...PERMISSION_PRESETS.administrator,
    ]));
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    employee = (await signInAs('employee@river.test', '王小明')).client;
    ({ participantId: reviewerId, client: reviewer } = await signInAs(
      'reviewer@river.test',
      '林美玲',
    ));
    ({ participantId: deputyId, client: deputy } = await signInAs('deputy@river.test', '黃淑芬'));
  });
  afterAll(() => app?.close());

  describe('Cancel', () => {
    it('沒有 request.cancel 不能 Cancel；Cancel 必須填寫原因', async () => {
      const processId = await publish(
        '請假－Cancel 權限',
        chain(approval('a', '主管審批', person(reviewerId))),
      );
      const request = await start(employee, processId, '10/1 特休');
      await waitForTask(request.id, reviewer);

      expect((await cancel(request.id, '重複申請', employee)).status).toBe(403);
      expect((await cancel(request.id, '重複申請', reviewer)).status).toBe(403);
      expect((await cancel(request.id)).status).toBe(400);
      expect((await cancel(request.id, '   ')).status).toBe(400);
      expect((await detail(request.id)).status).toBe('running');
    });

    it('Administrator Cancel 執行中的 Request：所有 open 的 Task 作廢，Request 變成 cancelled，時間軸記錄原因', async () => {
      const processId = await publish('採購－Cancel', parallel(reviewerId, deputyId));
      const request = await start(employee, processId, '筆電採購（重複）');
      const a = await waitForTask(request.id, reviewer);
      await waitForTask(request.id, deputy);

      const res = await cancel(request.id, '與 R-000001 重複');
      expect(res.status).toBe(200);
      expect(((await res.json()) as RequestSummary).status).toBe('cancelled');

      const cancelled = await detail(request.id);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.openTasks).toEqual([]);
      expect(cancelled.tasks.map((t) => t.status)).toEqual(['superseded', 'superseded']);
      const cancelEvent = cancelled.events.find((e) => e.type === 'request.cancelled');
      expect(cancelEvent).toMatchObject({
        actor: { id: adminId, name: '系統管理員' },
        comment: '與 R-000001 重複',
      });
      expect(cancelled.events.filter((e) => e.type === 'task.superseded')).toHaveLength(2);
      expect((await openTasks(reviewer)).some((t) => t.request.id === request.id)).toBe(false);
      expect((await openTasks(deputy)).some((t) => t.request.id === request.id)).toBe(false);

      // 審批人畫面上還是舊的 Task：核准會被拒絕，而且說明原因。
      const late = await approve(reviewer, a);
      expect(late.status).toBe(409);
      expect(((await late.json()) as { message: string }).message).toContain('Cancel');

      // workflow 已經結束，Request 不會再往下走。
      await eventually(
        async () => (await app.temporal.workflow.getHandle(request.id).describe()).status.name,
        (s) => s === 'COMPLETED',
      );
      expect((await detail(request.id)).events).toEqual(cancelled.events);
      expect((await cancel(request.id, '再一次')).status).toBe(409);
    });

    it('被 Return 的 Request 也可以 Cancel；已完成的不行', async () => {
      const processId = await publish(
        '出差－Cancel',
        chain(approval('a', '主管審批', person(reviewerId))),
      );
      const returned = await start(employee, processId, '高雄出差');
      const task = await waitForTask(returned.id, reviewer);
      const r = await reviewer.post(`/api/tasks/${task.id}/complete`, {
        outcome: 'returned',
        version: task.version,
        comment: '請附議程',
      });
      expect(r.status).toBe(200);

      expect((await cancel(returned.id, '出差取消')).status).toBe(200);
      expect((await detail(returned.id)).status).toBe('cancelled');
      expect(
        (await employee.post(`/api/requests/${returned.id}/resubmit`, { title: '高雄出差' }))
          .status,
      ).toBe(409);
      await eventually(
        async () => (await app.temporal.workflow.getHandle(returned.id).describe()).status.name,
        (s) => s === 'COMPLETED',
      );

      const completed = await start(employee, processId, '台南出差');
      const t = await waitForTask(completed.id, reviewer);
      expect((await approve(reviewer, t)).status).toBe(200);
      await eventually(
        () => detail(completed.id),
        (d) => d.status === 'completed',
      );
      expect((await cancel(completed.id, '太晚了')).status).toBe(409);
    });

    it('持有 request.cancel 或 task.reassign 的人看得到所有進行中的 Request', async () => {
      const processId = await publish(
        '請假－進行中清單',
        chain(approval('a', '主管審批', person(reviewerId))),
      );
      const request = await start(employee, processId, '10/20 事假');
      await waitForTask(request.id, reviewer);

      expect((await employee.get('/api/requests/active')).status).toBe(403);
      const res = await admin.get('/api/requests/active');
      expect(res.status).toBe(200);
      const active = (await res.json()) as RequestSummary[];
      expect(active.find((r) => r.id === request.id)).toMatchObject({
        status: 'running',
        openTasks: [{ nodeName: '主管審批', assignee: { id: reviewerId, name: '林美玲' } }],
      });
      expect(active.every((r) => r.status === 'running' || r.status === 'returned')).toBe(true);
    });
  });

  describe('Reassign', () => {
    it('沒有 task.reassign 不能 Reassign；不能改派給已停用或不存在的人', async () => {
      const processId = await publish(
        '請假－Reassign 權限',
        chain(approval('a', '主管審批', person(reviewerId))),
      );
      const request = await start(employee, processId, '10/3 特休');
      const task = await waitForTask(request.id, reviewer);

      expect((await reassign(task.id, deputyId, reviewer)).status).toBe(403);
      const gone = await newPerson('已離職');
      expect((await admin.post(`/api/participants/${gone.participantId}/deactivate`)).status).toBe(
        200,
      );
      expect((await reassign(task.id, gone.participantId)).status).toBe(400);
      expect((await reassign(task.id, '00000000-0000-4000-8000-000000000000')).status).toBe(400);
      expect((await reassign(task.id, reviewerId)).status).toBe(400);
      expect((await openTasks(reviewer)).some((t) => t.id === task.id)).toBe(true);
    });

    it('Reassign 後原 Task 作廢，新的處理人收到 Task 與通知信，核准後 Request 照常完成', async () => {
      const processId = await publish(
        '報銷－Reassign',
        chain(
          approval('a', '主管審批', person(reviewerId)),
          approval('b', '財務審批', person(deputyId)),
        ),
      );
      const request = await start(employee, processId, '9 月交通費');
      const original = await waitForTask(request.id, reviewer);

      const res = await reassign(original.id, deputyId, admin, '主管請假');
      expect(res.status).toBe(200);
      const moved = (await res.json()) as MyTask;
      expect(moved).toMatchObject({
        nodeName: '主管審批',
        status: 'open',
        assignee: { type: 'participant', id: deputyId, name: '黃淑芬' },
        request: { id: request.id },
      });
      expect(moved.id).not.toBe(original.id);

      expect((await openTasks(reviewer)).some((t) => t.request.id === request.id)).toBe(false);
      const late = await approve(reviewer, original);
      expect(late.status).toBe(409);
      expect(((await late.json()) as { message: string }).message).toContain('Reassign');

      const mail = await eventually(
        () => mailsTo('deputy@river.test').filter((m) => m.subject.includes('9 月交通費')),
        (list) => list.length >= 1,
      );
      expect(mail[0]?.text).toContain(`${ORIGIN}/tasks?id=${moved.id}`);

      const mine = await waitForTask(request.id, deputy);
      expect(mine.id).toBe(moved.id);
      expect((await approve(deputy, mine)).status).toBe(200);
      // 下一步也照常建立。
      const next = await eventually(
        () => openTasks(deputy),
        (list) => list.some((t) => t.request.id === request.id && t.nodeName === '財務審批'),
      );
      const finance = next.find((t) => t.request.id === request.id) as MyTask;
      expect((await approve(deputy, finance)).status).toBe(200);

      const done = await eventually(
        () => detail(request.id),
        (d) => d.status === 'completed',
      );
      expect(done.tasks.map((t) => [t.nodeName, t.assignee.name, t.status])).toEqual([
        ['主管審批', '林美玲', 'superseded'],
        ['主管審批', '黃淑芬', 'completed'],
        ['財務審批', '黃淑芬', 'completed'],
      ]);
      expect(
        done.events.map((e) => [
          e.type,
          e.actor?.name ?? null,
          e.task?.assignee.name ?? null,
          e.comment,
        ]),
      ).toEqual([
        ['request.started', '王小明', null, null],
        ['task.created', null, '林美玲', null],
        ['task.superseded', '系統管理員', '林美玲', null],
        ['task.reassigned', '系統管理員', '黃淑芬', '主管請假'],
        ['task.completed', '黃淑芬', '黃淑芬', null],
        ['task.created', null, '黃淑芬', null],
        ['task.completed', '黃淑芬', '黃淑芬', null],
        ['request.completed', null, null, null],
      ]);
    });

    it('指派給 Role 的 Task 可以 Reassign 給特定人；可以連續 Reassign', async () => {
      const role = (await (await admin.post('/api/roles', { name: '法務' })).json()) as {
        id: string;
      };
      expect((await admin.put(`/api/roles/${role.id}/members/${reviewerId}`)).status).toBe(204);
      const processId = await publish(
        '合約－Reassign',
        chain(approval('a', '法務審閱', { type: 'role', roleId: role.id })),
      );
      const request = await start(employee, processId, '供應商合約');
      const first = await waitForTask(request.id, reviewer);
      expect(first.assignee.type).toBe('role');

      const r1 = await reassign(first.id, deputyId);
      expect(r1.status).toBe(200);
      const second = (await r1.json()) as MyTask;
      const r2 = await reassign(second.id, reviewerId);
      expect(r2.status).toBe(200);
      const third = (await r2.json()) as MyTask;
      expect(third.assignee).toMatchObject({ type: 'participant', id: reviewerId });
      expect((await openTasks(deputy)).some((t) => t.request.id === request.id)).toBe(false);
      // 同一個 Task 不能 Reassign 兩次。
      expect((await reassign(first.id, deputyId)).status).toBe(409);

      const mine = await waitForTask(request.id, reviewer);
      expect(mine.id).toBe(third.id);
      expect((await approve(reviewer, mine)).status).toBe(200);
      const done = await eventually(
        () => detail(request.id),
        (d) => d.status === 'completed',
      );
      expect(done.tasks.map((t) => t.status)).toEqual(['superseded', 'superseded', 'completed']);
    });

    it('已經處理完的 Task 不能 Reassign', async () => {
      const processId = await publish(
        '請假－已處理',
        chain(approval('a', '主管審批', person(reviewerId))),
      );
      const request = await start(employee, processId, '10/5 特休');
      const task = await waitForTask(request.id, reviewer);
      expect((await approve(reviewer, task)).status).toBe(200);
      expect((await reassign(task.id, deputyId)).status).toBe(409);
      expect((await reassign('00000000-0000-4000-8000-000000000000', deputyId)).status).toBe(404);
    });
  });

  describe('停用帳號', () => {
    it('停用前預覽影響範圍：直接指派給此人的 open Task，以及以此人為 Manager 的 Participant', async () => {
      const leaving = await newPerson('張家豪');
      const report = await newPerson('劉怡君');
      expect(
        (
          await admin.patch(`/api/participants/${report.participantId}`, {
            managerId: leaving.participantId,
          })
        ).status,
      ).toBe(200);
      const processId = await publish(
        '請假－停用預覽',
        chain(approval('a', '主管審批', person(leaving.participantId))),
      );
      const request = await start(employee, processId, '10/7 特休');
      const task = await waitForTask(request.id, leaving.client);

      expect(
        (await reviewer.get(`/api/participants/${leaving.participantId}/deactivation-impact`))
          .status,
      ).toBe(403);
      const res = await admin.get(`/api/participants/${leaving.participantId}/deactivation-impact`);
      expect(res.status).toBe(200);
      const impact = (await res.json()) as DeactivationImpact;
      expect(impact.openTasks).toMatchObject([
        { id: task.id, nodeName: '主管審批', request: { id: request.id, title: '10/7 特休' } },
      ]);
      expect(impact.directReports).toMatchObject([{ id: report.participantId, name: '劉怡君' }]);
      // 預覽不會改變任何東西。
      expect((await leaving.client.get('/api/me')).status).toBe(200);
    });

    it('停用後 session 立即失效、無法再登入；資料不刪除；此人發起的 Request 照常繼續', async () => {
      const leaving = await newPerson('周杰');
      const processId = await publish(
        '報銷－發起人離職',
        chain(approval('a', '主管審批', person(reviewerId))),
      );
      const request = await start(leaving.client, processId, '離職前的報銷');
      const task = await waitForTask(request.id, reviewer);

      expect(
        (await leaving.client.post(`/api/participants/${leaving.participantId}/deactivate`)).status,
      ).toBe(403);
      expect((await admin.post(`/api/participants/${adminId}/deactivate`)).status).toBe(409);
      const res = await admin.post(`/api/participants/${leaving.participantId}/deactivate`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as Participant).status).toBe('deactivated');

      expect((await leaving.client.get('/api/me')).status).toBe(401);
      expect((await leaving.client.get('/api/tasks/mine')).status).toBe(401);
      await expect(app.signIn(leaving.email, PASSWORD)).rejects.toThrow(/403/);

      const people = (await (await admin.get('/api/participants')).json()) as Participant[];
      expect(people.find((p) => p.id === leaving.participantId)).toMatchObject({
        name: '周杰',
        status: 'deactivated',
      });
      // 再停用一次沒有影響。
      expect(
        (await admin.post(`/api/participants/${leaving.participantId}/deactivate`)).status,
      ).toBe(200);

      expect((await approve(reviewer, task)).status).toBe(200);
      const done = await eventually(
        () => detail(request.id, reviewer),
        (d) => d.status === 'completed',
      );
      expect(done.initiator).toEqual({ id: leaving.participantId, name: '周杰' });
    });

    it('直接指派給已停用 Participant 的 open Task 出現在「待 Reassign」清單，並寄信通知 Administrator', async () => {
      const leaving = await newPerson('吳宗憲');
      const processId = await publish(
        '請假－待 Reassign',
        chain(approval('a', '主管審批', person(leaving.participantId))),
      );
      const request = await start(employee, processId, '10/9 事假');
      const task = await waitForTask(request.id, leaving.client);

      expect((await employee.get('/api/tasks/pending-reassign')).status).toBe(403);
      expect((await pendingReassign()).some((t) => t.id === task.id)).toBe(false);
      const before = mailsTo('admin@river.test').length;

      expect(
        (await admin.post(`/api/participants/${leaving.participantId}/deactivate`)).status,
      ).toBe(200);
      const pending = await pendingReassign();
      expect(pending.find((t) => t.id === task.id)).toMatchObject({
        nodeName: '主管審批',
        assignee: { id: leaving.participantId, name: '吳宗憲' },
        request: { id: request.id, title: '10/9 事假' },
      });

      const mails = await eventually(
        () => mailsTo('admin@river.test').slice(before),
        (list) => list.length >= 1,
      );
      expect(mails[0]?.subject).toContain('待 Reassign');
      expect(mails[0]?.text).toContain('吳宗憲');
      expect(mails[0]?.text).toContain(`${ORIGIN}/admin/reassign`);

      const moved = await reassign(task.id, reviewerId);
      expect(moved.status).toBe(200);
      expect((await pendingReassign()).some((t) => t.request.id === request.id)).toBe(false);
      const mine = await waitForTask(request.id, reviewer);
      expect((await approve(reviewer, mine)).status).toBe(200);
      await eventually(
        () => detail(request.id),
        (d) => d.status === 'completed',
      );
    });

    it('流程走到指派給已停用 Participant 的步驟時，Task 進入「待 Reassign」清單並寄信通知 Administrator', async () => {
      const leaving = await newPerson('蔡依林');
      const processId = await publish(
        '採購－停用後才走到',
        chain(
          approval('a', '主管審批', person(reviewerId)),
          approval('b', '採購審批', person(leaving.participantId)),
        ),
      );
      const request = await start(employee, processId, '螢幕採購');
      const first = await waitForTask(request.id, reviewer);
      expect(
        (await admin.post(`/api/participants/${leaving.participantId}/deactivate`)).status,
      ).toBe(200);
      const before = mailsTo('admin@river.test').length;

      expect((await approve(reviewer, first)).status).toBe(200);
      const pending = await eventually(
        () => pendingReassign(),
        (list) => list.some((t) => t.request.id === request.id),
      );
      expect(pending.find((t) => t.request.id === request.id)).toMatchObject({
        nodeName: '採購審批',
        assignee: { id: leaving.participantId },
      });
      const mails = await eventually(
        () => mailsTo('admin@river.test').slice(before),
        (list) => list.length >= 1,
      );
      expect(mails[0]?.subject).toContain('待 Reassign');
      expect(mails[0]?.text).toContain('螢幕採購');
      expect(mails[0]?.text).toContain(`${ORIGIN}/admin/reassign`);
      // 已停用的人收不到信。
      expect(mailsTo(leaving.email).some((m) => m.subject.includes('螢幕採購'))).toBe(false);
    });
  });
  describe('Reassign 與 Reminder、Escalation', () => {
    const subjects = (title: string, keyword: string, to?: string) =>
      app.emails.sent.filter(
        (m) => m.subject.includes(title) && m.subject.includes(keyword) && (!to || m.to === to),
      );
    const settle = () => new Promise((r) => setTimeout(r, 1_000));

    async function newRole(name: string, members: string[] = []): Promise<string> {
      const role = (await (await admin.post('/api/roles', { name })).json()) as { id: string };
      for (const id of members)
        expect((await admin.put(`/api/roles/${role.id}/members/${id}`)).status).toBe(204);
      return role.id;
    }

    it('Reassign 後 timer 跟著新的 Task：Reminder 寄給新的處理人，Escalation 轉給新處理人的 Manager', async () => {
      const fallbackRoleId = await newRole('逾時後備－Reassign');
      const handler = await newPerson('新處理人');
      const boss = await newPerson('新處理人的主管');
      expect(
        (
          await admin.patch(`/api/participants/${handler.participantId}`, {
            managerId: boss.participantId,
          })
        ).status,
      ).toBe(200);
      const processId = await publish(
        '請假－Reassign 與逾時',
        chain(
          approval('a', '主管審批', person(reviewerId), {
            reminder: { afterHours: 4, repeat: true },
            escalation: { afterHours: 10, fallbackRoleId },
          }),
        ),
      );
      const request = await start(employee, processId, '逾時假單');
      const original = await waitForTask(request.id, reviewer);

      await app.skipTime(5 * HOUR);
      await eventually(
        () => subjects('逾時假單', '提醒', 'reviewer@river.test'),
        (list) => list.length === 1,
      );

      const res = await reassign(original.id, handler.participantId);
      expect(res.status).toBe(200);
      const moved = (await res.json()) as MyTask;
      await waitForTask(request.id, handler.client);

      // Reminder 從 Reassign 起重新計時，寄給新的處理人；原處理人不再收到。
      await app.skipTime(5 * HOUR);
      await eventually(
        () => subjects('逾時假單', '提醒', handler.email),
        (list) => list.length === 1,
      );
      // Escalation 的時限也從 Reassign 起重新計時（10 小時），轉給新處理人的 Manager。
      await app.skipTime(6 * HOUR);
      const escalated = await waitForTask(request.id, boss.client);
      expect(escalated.assignee).toMatchObject({ id: boss.participantId });
      expect(escalated.replacesTaskId).toBe(moved.id);
      expect(subjects('逾時假單', '提醒', 'reviewer@river.test')).toHaveLength(1);

      expect((await approve(boss.client, escalated)).status).toBe(200);
      const done = await eventually(
        () => detail(request.id),
        (d) => d.status === 'completed',
      );
      expect(done.tasks.map((t) => [t.assignee.name, t.status])).toEqual([
        ['林美玲', 'superseded'],
        ['新處理人', 'superseded'],
        ['新處理人的主管', 'completed'],
      ]);
    });

    it('Escalation 轉給已停用的 Participant：Task 進入「待 Reassign」清單並通知 Administrator；Reassign 後照常完成', async () => {
      const roleId = await newRole('逾時審批－停用', [reviewerId]);
      const leaving = await newPerson('已離職的協理');
      const processId = await publish(
        '採購－Escalation 給已停用',
        chain(
          approval(
            'a',
            '採購審批',
            { type: 'role', roleId },
            { escalation: { afterHours: 24, target: person(leaving.participantId) } },
          ),
        ),
      );
      const request = await start(employee, processId, '機房採購');
      await waitForTask(request.id, reviewer);
      expect(
        (await admin.post(`/api/participants/${leaving.participantId}/deactivate`)).status,
      ).toBe(200);
      const before = mailsTo('admin@river.test').length;

      await app.skipTime(25 * HOUR);
      const pending = await eventually(
        () => pendingReassign(),
        (list) => list.some((t) => t.request.id === request.id),
      );
      const escalated = pending.find((t) => t.request.id === request.id) as MyTask;
      expect(escalated.assignee).toMatchObject({ id: leaving.participantId });
      const mails = await eventually(
        () => mailsTo('admin@river.test').slice(before),
        (list) => list.length >= 1,
      );
      expect(mails[0]?.subject).toContain('待 Reassign');
      expect(mails[0]?.text).toContain('機房採購');

      expect((await reassign(escalated.id, deputyId)).status).toBe(200);
      const mine = await waitForTask(request.id, deputy);
      await settle();
      expect((await approve(deputy, mine)).status).toBe(200);
      await eventually(
        () => detail(request.id),
        (d) => d.status === 'completed',
      );
    });
  });
});
