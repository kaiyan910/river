import type { Permission } from '@river/auth';
import type {
  MyTask,
  Process,
  RequestDetail,
  RequestSummary,
  StartableProcess,
} from '@river/contracts';
import type { Assignee, ProcessDsl } from '@river/dsl';
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

/** start → 一個審批節點 → end */
function oneApproval(assignee: Assignee): ProcessDsl {
  return {
    nodes: [
      { id: 'start', type: 'start', name: '開始', position: at(0) },
      { id: 'approve', type: 'approval', name: '審批', assignee, position: at(170) },
      { id: 'end', type: 'end', name: '結束', position: at(340) },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'approve' },
      { id: 'e2', source: 'approve', target: 'end' },
    ],
    forms: [],
  };
}

describe('可見範圍', () => {
  let app: TestApp;
  let admin: ApiClient;
  let designer: ApiClient;
  let editorOnly: ApiClient;
  /** 王小明：一般 Participant，「請假」「調薪申請」的發起人。 */
  let initiator: ApiClient;
  /** 林美玲：「請假」的審批人（指派給特定人）。 */
  let approver: ApiClient;
  let approverId: string;
  /** 張志豪：「採購審批」Role 的成員。 */
  let buyer: ApiClient;
  /** 黃淑芬：「HR」Role 的成員，「請假」的 Observer。 */
  let hr: ApiClient;
  let hrId: string;
  /** 吳佩珊：「部門助理」Role 的成員，唯一可以發起「採購申請」的人。 */
  let assistant: ApiClient;
  /** 周建國：持有 request.view_all。 */
  let auditor: ApiClient;
  /** 李建宏：和任何 Request 都沒有關係。 */
  let outsider: ApiClient;

  let hrRoleId: string;
  let assistantRoleId: string;
  let purchaseRoleId: string;
  let leaveId: string;
  let purchaseId: string;
  let leaveRequest: RequestDetail;
  let purchaseRequest: RequestDetail;

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
    expect((await designer.post(`/api/processes/${created.id}/versions`, {})).status).toBe(201);
    return created.id;
  }

  function setAccess(
    processId: string,
    access: { initiatorRoleIds: string[]; observerRoleIds: string[] },
    as: ApiClient = designer,
  ) {
    return as.put(`/api/processes/${processId}/access`, access);
  }

  async function startable(as: ApiClient): Promise<string[]> {
    const res = await as.get('/api/processes/startable');
    expect(res.status).toBe(200);
    return ((await res.json()) as StartableProcess[]).map((p) => p.name);
  }

  async function start(as: ApiClient, processId: string, title: string): Promise<RequestDetail> {
    const res = await as.post('/api/requests', { processId, title });
    expect(res.status).toBe(201);
    return (await res.json()) as RequestDetail;
  }

  async function visible(as: ApiClient): Promise<string[]> {
    const res = await as.get('/api/requests');
    expect(res.status).toBe(200);
    return ((await res.json()) as RequestSummary[]).map((r) => r.title);
  }

  async function canView(as: ApiClient, request: RequestDetail): Promise<boolean> {
    const res = await as.get(`/api/requests/${request.id}`);
    expect([200, 404]).toContain(res.status);
    return res.status === 200;
  }

  async function waitForTask(requestId: string, as: ApiClient): Promise<MyTask> {
    const tasks = await eventually(
      async () => (await (await as.get('/api/tasks/mine?status=open')).json()) as MyTask[],
      (list) => list.some((t) => t.request.id === requestId),
    );
    return tasks.find((t) => t.request.id === requestId) as MyTask;
  }

  beforeAll(async () => {
    app = await startTestApp();
    admin = (await signInAs('admin@river.test', '系統管理員', ['role.manage'])).client;
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    editorOnly = (await signInAs('editor@river.test', '許文傑', ['process.edit'])).client;
    initiator = (await signInAs('initiator@river.test', '王小明')).client;
    const a = await signInAs('approver@river.test', '林美玲');
    approver = a.client;
    approverId = a.participantId;
    const b = await signInAs('buyer@river.test', '張志豪');
    buyer = b.client;
    const h = await signInAs('hr@river.test', '黃淑芬');
    hr = h.client;
    hrId = h.participantId;
    const s = await signInAs('assistant@river.test', '吳佩珊');
    assistant = s.client;
    auditor = (await signInAs('auditor@river.test', '周建國', ['request.view_all'])).client;
    outsider = (await signInAs('outsider@river.test', '李建宏')).client;

    hrRoleId = await createRole('HR', [hrId]);
    assistantRoleId = await createRole('部門助理', [s.participantId]);
    purchaseRoleId = await createRole('採購審批', [b.participantId]);

    leaveId = await publish(
      '請假',
      oneApproval({ type: 'participant', participantId: approverId }),
    );
    purchaseId = await publish('採購申請', oneApproval({ type: 'role', roleId: purchaseRoleId }));
    expect(
      (await setAccess(leaveId, { initiatorRoleIds: [], observerRoleIds: [hrRoleId] })).status,
    ).toBe(200);
    expect(
      (await setAccess(purchaseId, { initiatorRoleIds: [assistantRoleId], observerRoleIds: [] }))
        .status,
    ).toBe(200);

    leaveRequest = await start(initiator, leaveId, '王小明 10/3 特休');
    purchaseRequest = await start(assistant, purchaseId, '會議室螢幕');
    await waitForTask(leaveRequest.id, approver);
    await waitForTask(purchaseRequest.id, buyer);
  });
  afterAll(() => app?.close());

  describe('Process 的 Initiator Role 與 Observer Role 設定', () => {
    it('Designer 設定後，Process 帶著 Role 名稱', async () => {
      const res = await designer.get(`/api/processes/${purchaseId}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        initiatorRoles: [{ id: assistantRoleId, name: '部門助理' }],
        observerRoles: [],
      });
      const leave = (await (await designer.get(`/api/processes/${leaveId}`)).json()) as Process;
      expect(leave).toMatchObject({
        initiatorRoles: [],
        observerRoles: [{ id: hrRoleId, name: 'HR' }],
      });
    });

    it('沒有 process.publish 不能設定；不存在的 Role 回 422', async () => {
      const access = { initiatorRoleIds: [], observerRoleIds: [] };
      expect((await setAccess(leaveId, access, editorOnly)).status).toBe(403);
      expect((await setAccess(leaveId, access, initiator)).status).toBe(403);
      const unknown = await setAccess(leaveId, {
        initiatorRoleIds: ['00000000-0000-4000-8000-000000000000'],
        observerRoleIds: [],
      });
      expect(unknown.status).toBe(422);
      const leave = (await (await designer.get(`/api/processes/${leaveId}`)).json()) as Process;
      expect(leave.observerRoles.map((r) => r.id)).toEqual([hrRoleId]);
    });
  });

  describe('Initiator Role', () => {
    it('沒有設定 Initiator Role 時，所有 Participant 都可以發起', async () => {
      expect(await startable(outsider)).toContain('請假');
      await start(outsider, leaveId, '李建宏 病假');
    });

    it('設定後只有成員看得到、也只有成員可以發起', async () => {
      expect(await startable(assistant)).toEqual(expect.arrayContaining(['請假', '採購申請']));
      expect(await startable(initiator)).not.toContain('採購申請');
      expect(await startable(auditor)).not.toContain('採購申請');

      const denied = await initiator.post('/api/requests', {
        processId: purchaseId,
        title: '偷買',
      });
      expect(denied.status).toBe(403);
      expect(await visible(auditor)).not.toContain('偷買');
    });

    it('清空 Initiator Role 後恢復所有人都可以發起', async () => {
      const processId = await publish(
        '文具申請',
        oneApproval({ type: 'role', roleId: purchaseRoleId }),
      );
      const access = { initiatorRoleIds: [assistantRoleId], observerRoleIds: [] };
      expect((await setAccess(processId, access)).status).toBe(200);
      expect(await startable(outsider)).not.toContain('文具申請');

      expect((await setAccess(processId, { ...access, initiatorRoleIds: [] })).status).toBe(200);
      expect(await startable(outsider)).toContain('文具申請');
    });
  });

  describe('Request 的列表與明細依可見範圍過濾', () => {
    it('發起人看得到自己發起的 Request，看不到別人發起的', async () => {
      expect(await canView(initiator, leaveRequest)).toBe(true);
      expect(await visible(initiator)).toContain('王小明 10/3 特休');
      expect(await canView(initiator, purchaseRequest)).toBe(false);
      expect(await visible(initiator)).not.toContain('會議室螢幕');
    });

    it('被指派 Task 的人看得到那筆 Request，處理完之後也看得到；看不到沒有經手的', async () => {
      expect(await canView(approver, leaveRequest)).toBe(true);
      expect(await visible(approver)).toContain('王小明 10/3 特休');
      expect(await canView(approver, purchaseRequest)).toBe(false);
      expect(await visible(approver)).not.toContain('會議室螢幕');

      const task = await waitForTask(leaveRequest.id, approver);
      const res = await approver.post(`/api/tasks/${task.id}/complete`, {
        outcome: 'approved',
        version: task.version,
      });
      expect(res.status).toBe(200);
      expect(await canView(approver, leaveRequest)).toBe(true);
      expect(await visible(approver)).toContain('王小明 10/3 特休');
    });

    it('Task 指派給 Role 時，Role 成員看得到那筆 Request；看不到其他 Request', async () => {
      expect(await canView(buyer, purchaseRequest)).toBe(true);
      expect(await visible(buyer)).toEqual(['會議室螢幕']);
      expect(await canView(buyer, leaveRequest)).toBe(false);
    });

    it('Observer Role 的成員看得到該 Process 的所有 Request；看不到其他 Process 的', async () => {
      expect(await canView(hr, leaveRequest)).toBe(true);
      expect(await visible(hr)).toEqual(
        expect.arrayContaining(['王小明 10/3 特休', '李建宏 病假']),
      );
      expect(await canView(hr, purchaseRequest)).toBe(false);
      expect(await visible(hr)).not.toContain('會議室螢幕');
    });

    it('移出 Observer Role 之後就看不到', async () => {
      const tempId = await createRole('臨時稽核', [hrId]);
      const processId = await publish(
        '出差申請',
        oneApproval({ type: 'participant', participantId: approverId }),
      );
      expect(
        (await setAccess(processId, { initiatorRoleIds: [], observerRoleIds: [tempId] })).status,
      ).toBe(200);
      const trip = await start(initiator, processId, '新竹出差');
      expect(await canView(hr, trip)).toBe(true);

      expect((await admin.delete(`/api/roles/${tempId}/members/${hrId}`)).status).toBe(204);
      expect(await canView(hr, trip)).toBe(false);
      expect(await visible(hr)).not.toContain('新竹出差');
    });

    it('持有 request.view_all 的人看得到所有 Request；沒有的人看不到無關的 Request', async () => {
      expect(await canView(auditor, leaveRequest)).toBe(true);
      expect(await canView(auditor, purchaseRequest)).toBe(true);
      expect(await visible(auditor)).toEqual(
        expect.arrayContaining(['王小明 10/3 特休', '會議室螢幕', '李建宏 病假', '新竹出差']),
      );

      expect(await canView(outsider, leaveRequest)).toBe(false);
      expect(await canView(outsider, purchaseRequest)).toBe(false);
      expect(await visible(outsider)).toEqual(['李建宏 病假']);
    });

    it('看得到的 Request 仍然只有發起人可以 Withdraw', async () => {
      const res = await hr.post(`/api/requests/${leaveRequest.id}/withdraw`, {});
      expect(res.status).toBe(404);
      const own = await auditor.post(`/api/requests/${purchaseRequest.id}/withdraw`, {});
      expect(own.status).toBe(404);
    });
  });
});
