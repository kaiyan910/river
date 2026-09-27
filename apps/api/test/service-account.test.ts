import { PERMISSION_PRESETS, type Permission } from '@river/auth';
import type {
  AttachmentUpload,
  ExternalProcess,
  ExternalProcessDetail,
  ExternalRequest,
  IssuedApiKey,
  MyTask,
  Process,
  RequestDetail,
  RequestSummary,
  ServiceAccount,
  ServiceAccountProcessOption,
} from '@river/contracts';
import { participants, serviceAccounts } from '@river/db';
import type { Assignee, ProcessDsl } from '@river/dsl';
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

const at = (y: number) => ({ x: 0, y });

const onboarding: FormSchema = {
  id: 'onboarding',
  name: '入職設備',
  fields: [
    { id: 'f1', key: 'employee', type: 'text', label: '新人姓名', required: true, rules: {} },
  ],
};

/** start（開始表單「入職設備」）→ 一個審批節點 → end */
function oneApproval(assignee: Assignee): ProcessDsl {
  return {
    nodes: [
      { id: 'start', type: 'start', name: '開始', formId: 'onboarding', position: at(0) },
      { id: 'approve', type: 'approval', name: '主管審批', assignee, position: at(170) },
      { id: 'end', type: 'end', name: '結束', position: at(340) },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'approve' },
      { id: 'e2', source: 'approve', target: 'end' },
    ],
    forms: [onboarding],
  };
}

describe('Service Account 與外部 API', () => {
  let app: TestApp;
  let admin: ApiClient;
  let designer: ApiClient;
  /** 黃淑芬：王小明的 Manager。 */
  let manager: ApiClient;
  let managerId: string;
  /** 吳雅婷：「人資」Role 的成員（Fallback Role）。 */
  let hr: ApiClient;
  /** 王小明：一般 Participant，外部系統代表他發起。 */
  let employee: ApiClient;
  let employeeId: string;
  let hrRoleId: string;
  /** 「入職設備申請」：指派給發起人的 Manager，Fallback Role 是「人資」。 */
  let equipmentId: string;
  /** 「採購申請」：Service Account 一開始沒有被授權發起。 */
  let purchaseId: string;

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

  async function createServiceAccount(name: string, processIds: string[]): Promise<IssuedApiKey> {
    const res = await admin.post('/api/service-accounts', { name, processIds });
    expect(res.status).toBe(201);
    return (await res.json()) as IssuedApiKey;
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

  async function detail(id: string, as: ApiClient): Promise<RequestDetail> {
    const res = await as.get(`/api/requests/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as RequestDetail;
  }

  async function status(external: ApiClient, id: string): Promise<ExternalRequest> {
    const res = await external.get(`/api/external/requests/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as ExternalRequest;
  }

  function approve(as: ApiClient, task: { id: string; version: number }) {
    return as.post(`/api/tasks/${task.id}/complete`, {
      outcome: 'approved',
      version: task.version,
    });
  }

  beforeAll(async () => {
    app = await startTestApp();
    admin = (
      await signInAs('admin@river.test', '系統管理員', [...PERMISSION_PRESETS.administrator])
    ).client;
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    const m = await signInAs('manager@river.test', '黃淑芬');
    manager = m.client;
    managerId = m.participantId;
    const h = await signInAs('hr@river.test', '吳雅婷');
    hr = h.client;
    const e = await signInAs('employee@river.test', '王小明');
    employee = e.client;
    employeeId = e.participantId;
    expect((await admin.patch(`/api/participants/${employeeId}`, { managerId })).status).toBe(200);

    hrRoleId = ((await (await admin.post('/api/roles', { name: '人資' })).json()) as { id: string })
      .id;
    expect((await admin.put(`/api/roles/${hrRoleId}/members/${h.participantId}`)).status).toBe(204);

    equipmentId = await publish(
      '入職設備申請',
      oneApproval({ type: 'manager', fallbackRoleId: hrRoleId }),
    );
    purchaseId = await publish('採購申請', oneApproval({ type: 'role', roleId: hrRoleId }));
  });
  afterAll(() => app?.close());

  it('只有持有 service_account.manage 的人可以管理 Service Account', async () => {
    expect((await designer.get('/api/service-accounts')).status).toBe(403);
    expect((await designer.post('/api/service-accounts', { name: 'HR 系統' })).status).toBe(403);
    expect((await app.anonymous.get('/api/service-accounts')).status).toBe(401);
  });

  it('建立 Service Account、設定可發起的 Process 並發放 API key；key 只存 hash、只顯示一次', async () => {
    const options = (await (
      await admin.get('/api/service-accounts/process-options')
    ).json()) as ServiceAccountProcessOption[];
    expect(options.map((o) => o.name)).toEqual(['入職設備申請', '採購申請']);

    const issued = await createServiceAccount('HR 系統', [equipmentId]);
    expect(issued.apiKey).toMatch(/^river_sk_[\w-]{40,}$/);
    expect(issued.serviceAccount).toMatchObject({
      name: 'HR 系統',
      processes: [{ id: equipmentId, name: '入職設備申請' }],
      apiKey: { prefix: issued.apiKey.slice(0, issued.serviceAccount.apiKey.prefix.length) },
    });
    expect(issued.apiKey.startsWith(issued.serviceAccount.apiKey.prefix)).toBe(true);
    expect(issued.serviceAccount.apiKey.prefix.length).toBeLessThan(20);

    // 清單上只有前綴，不會再出現明文。
    const listRes = await admin.get('/api/service-accounts');
    expect(listRes.status).toBe(200);
    const listText = await listRes.text();
    expect(listText).not.toContain(issued.apiKey);
    const list = JSON.parse(listText) as ServiceAccount[];
    expect(list.find((s) => s.id === issued.serviceAccount.id)).toEqual(issued.serviceAccount);

    // 資料庫裡也只有 hash。
    const [row] = await app.db
      .select()
      .from(serviceAccounts)
      .where(eq(serviceAccounts.id, issued.serviceAccount.id));
    expect(JSON.stringify(row)).not.toContain(issued.apiKey);
    expect(JSON.stringify(row)).not.toContain(issued.apiKey.slice(20));

    // 名稱不能重複。
    expect((await admin.post('/api/service-accounts', { name: 'HR 系統' })).status).toBe(409);
    // 不存在的 Process 不能授權。
    const bad = await admin.post('/api/service-accounts', {
      name: '另一個系統',
      processIds: ['00000000-0000-4000-8000-000000000000'],
    });
    expect(bad.status).toBe(400);
  });

  it('外部 API 只接受有效的 Bearer key；session 不能呼叫外部 API，key 也不能呼叫內部 API', async () => {
    const { apiKey } = await createServiceAccount('驗證測試', [equipmentId]);
    const body = { processId: equipmentId, title: '驗證', data: { employee: '新人' } };

    expect((await app.anonymous.post('/api/external/requests', body)).status).toBe(401);
    expect(
      (
        await app.anonymous
          .withApiKey('river_sk_not-a-real-key')
          .post('/api/external/requests', body)
      ).status,
    ).toBe(401);
    expect((await employee.post('/api/external/requests', body)).status).toBe(401);
    expect((await employee.get('/api/external/requests')).status).toBe(401);

    const external = app.anonymous.withApiKey(apiKey);
    expect((await external.get('/api/requests')).status).toBe(401);
    expect((await external.get('/api/me')).status).toBe(401);
    expect((await external.post('/api/requests', body)).status).toBe(401);
  });

  it('只能發起被授權的 Process；Administrator 調整範圍後立刻生效', async () => {
    const issued = await createServiceAccount('採購系統', [equipmentId]);
    const external = app.anonymous.withApiKey(issued.apiKey);
    const body = { processId: purchaseId, title: '筆電 x 3', data: { employee: '—' } };

    expect((await external.post('/api/external/requests', body)).status).toBe(403);
    expect(
      (
        await external.post('/api/external/requests', {
          ...body,
          processId: '00000000-0000-4000-8000-000000000000',
        })
      ).status,
    ).toBe(403);

    const set = await admin.put(`/api/service-accounts/${issued.serviceAccount.id}/processes`, {
      processIds: [purchaseId],
    });
    expect(set.status).toBe(200);
    expect(((await set.json()) as ServiceAccount).processes).toEqual([
      { id: purchaseId, name: '採購申請' },
    ]);

    expect((await external.post('/api/external/requests', body)).status).toBe(201);
    expect(
      (await external.post('/api/external/requests', { ...body, processId: equipmentId })).status,
    ).toBe(403);
  });

  it('輪替 API key 後舊的 key 立即失效，新的 key 只顯示一次', async () => {
    const issued = await createServiceAccount('輪替測試', [equipmentId]);
    const old = app.anonymous.withApiKey(issued.apiKey);
    expect((await old.get('/api/external/requests')).status).toBe(200);

    const res = await admin.post(`/api/service-accounts/${issued.serviceAccount.id}/api-key`);
    expect(res.status).toBe(201);
    const rotated = (await res.json()) as IssuedApiKey;
    expect(rotated.apiKey).not.toBe(issued.apiKey);
    expect(rotated.serviceAccount.apiKey.prefix).not.toBe(issued.serviceAccount.apiKey.prefix);

    expect((await old.get('/api/external/requests')).status).toBe(401);
    expect(
      (await app.anonymous.withApiKey(rotated.apiKey).get('/api/external/requests')).status,
    ).toBe(200);
    expect(await (await admin.get('/api/service-accounts')).text()).not.toContain(rotated.apiKey);
  });

  it('帶 on_behalf_of：該 Participant 是發起人，指派給 Manager 的步驟交給他的 Manager', async () => {
    const { apiKey, serviceAccount } = await createServiceAccount('HR 系統－代理', [equipmentId]);
    const external = app.anonymous.withApiKey(apiKey);

    // 開始表單照樣驗證。
    const invalid = await external.post('/api/external/requests', {
      processId: equipmentId,
      title: '入職設備',
      data: {},
      on_behalf_of: 'employee@river.test',
    });
    expect(invalid.status).toBe(422);

    const res = await external.post('/api/external/requests', {
      processId: equipmentId,
      title: '新人筆電',
      data: { employee: '林小華' },
      on_behalf_of: 'Employee@River.test',
    });
    expect(res.status).toBe(201);
    const started = (await res.json()) as ExternalRequest;
    expect(started).toMatchObject({
      title: '新人筆電',
      status: 'running',
      process: { id: equipmentId, name: '入職設備申請', version: 1 },
      initiator: { type: 'participant', id: employeeId, name: '王小明' },
    });

    const task = await waitForTask(started.id, manager);
    expect(task.assignee).toEqual({ type: 'participant', id: managerId, name: '黃淑芬' });
    expect((await openTasks(hr)).some((t) => t.request.id === started.id)).toBe(false);

    // 在發起人的「我的申請」裡，並標出是哪個 Service Account 代為發起。
    const mine = (await (await employee.get('/api/requests/mine')).json()) as RequestSummary[];
    expect(mine.find((r) => r.id === started.id)).toMatchObject({
      initiator: { type: 'participant', id: employeeId },
      serviceAccount: { id: serviceAccount.id, name: 'HR 系統－代理' },
    });
    const d = await detail(started.id, employee);
    expect(d.data).toEqual([
      expect.objectContaining({
        nodeId: 'start',
        data: { employee: '林小華' },
        submittedBy: { id: employeeId, name: '王小明' },
      }),
    ]);
    expect(d.events[0]).toMatchObject({
      type: 'request.started',
      actor: { id: employeeId, name: '王小明' },
    });
    expect((await status(external, started.id)).pendingSteps).toEqual(['主管審批']);

    expect((await approve(manager, task)).status).toBe(200);
    const done = await eventually(
      () => status(external, started.id),
      (r) => r.status === 'completed',
    );
    expect(done.pendingSteps).toEqual([]);
  });

  it('on_behalf_of 不是有效的 Participant 時拒絕發起', async () => {
    const { apiKey } = await createServiceAccount('HR 系統－錯誤', [equipmentId]);
    const external = app.anonymous.withApiKey(apiKey);
    const body = { processId: equipmentId, title: '入職', data: { employee: '林小華' } };

    const unknown = await external.post('/api/external/requests', {
      ...body,
      on_behalf_of: 'nobody@river.test',
    });
    expect(unknown.status).toBe(422);

    const gone = await signInAs('gone@river.test', '離職者');
    await app.db
      .update(participants)
      .set({ deactivatedAt: new Date() })
      .where(eq(participants.id, gone.participantId));
    const deactivated = await external.post('/api/external/requests', {
      ...body,
      on_behalf_of: 'gone@river.test',
    });
    expect(deactivated.status).toBe(422);
    expect((await external.get('/api/external/requests')).status).toBe(200);
    expect((await (await external.get('/api/external/requests')).json()) as unknown[]).toEqual([]);
  });

  it('沒有帶 on_behalf_of：發起人是 Service Account，指派給 Manager 的步驟改派給 Fallback Role', async () => {
    const { apiKey, serviceAccount } = await createServiceAccount('門禁系統', [equipmentId]);
    const external = app.anonymous.withApiKey(apiKey);

    const res = await external.post('/api/external/requests', {
      processId: equipmentId,
      title: '門禁卡',
      data: { employee: '陳大文' },
    });
    expect(res.status).toBe(201);
    const started = (await res.json()) as ExternalRequest;
    expect(started.initiator).toEqual({
      type: 'service_account',
      id: serviceAccount.id,
      name: '門禁系統',
    });

    const task = await waitForTask(started.id, hr);
    expect(task.assignee).toEqual({ type: 'role', id: hrRoleId, name: '人資' });
    expect(task.request.initiator).toEqual(started.initiator);
    expect((await openTasks(manager)).some((t) => t.request.id === started.id)).toBe(false);

    const d = await detail(started.id, hr);
    expect(d).toMatchObject({
      initiator: { type: 'service_account', id: serviceAccount.id, name: '門禁系統' },
      serviceAccount: { id: serviceAccount.id, name: '門禁系統' },
    });
    expect(d.data[0]?.submittedBy).toEqual({ id: serviceAccount.id, name: '門禁系統' });
    expect(d.events.map((e) => [e.type, e.actor?.name ?? null, e.fallbackReason])).toEqual([
      ['request.started', '門禁系統', null],
      ['task.created', null, 'no_manager'],
    ]);

    // 不會出現在任何 Participant 的「我的申請」。
    expect(
      ((await (await employee.get('/api/requests/mine')).json()) as RequestSummary[]).some(
        (r) => r.id === started.id,
      ),
    ).toBe(false);

    expect((await approve(hr, task)).status).toBe(200);
    await eventually(
      () => status(external, started.id),
      (r) => r.status === 'completed',
    );
  });

  it('外部 API 不能引用附件（包括帶 on_behalf_of 時），回 422 且不會綁走 Participant 的附件', async () => {
    const withReceipt: FormSchema = {
      id: 'onboarding',
      name: '入職設備',
      fields: [
        ...onboarding.fields,
        {
          id: 'f2',
          key: 'photo',
          type: 'attachment',
          label: '照片',
          required: false,
          rules: { accept: ['.png'], maxSizeMb: 1, maxFiles: 1 },
        },
      ],
    };
    const processId = await publish('入職設備－附件', {
      ...oneApproval({ type: 'manager', fallbackRoleId: hrRoleId }),
      forms: [withReceipt],
    });
    const { apiKey } = await createServiceAccount('附件測試', [processId]);
    const external = app.anonymous.withApiKey(apiKey);

    const content = 'png';
    const registered = await employee.post('/api/attachments', {
      fileName: 'me.png',
      contentType: 'image/png',
      size: Buffer.byteLength(content),
    });
    expect(registered.status).toBe(201);
    const { attachment, upload } = (await registered.json()) as AttachmentUpload;
    const put = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: content,
    });
    expect(put.status).toBe(200);

    for (const onBehalfOf of [undefined, 'employee@river.test']) {
      const res = await external.post('/api/external/requests', {
        processId,
        title: '帶附件',
        data: { employee: '林小華', photo: [attachment.id] },
        on_behalf_of: onBehalfOf,
      });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { errors: Record<string, string> }).errors).toHaveProperty(
        'photo',
      );
    }
    // 沒有附件時照常發起。
    expect(
      (
        await external.post('/api/external/requests', {
          processId,
          title: '不帶附件',
          data: { employee: '林小華' },
        })
      ).status,
    ).toBe(201);
    // 附件仍然屬於上傳的 Participant，他自己發起時可以使用。
    expect(
      (
        await employee.post('/api/requests', {
          processId,
          title: '自己發起',
          data: { employee: '林小華', photo: [attachment.id] },
        })
      ).status,
    ).toBe(201);
  });

  it('外部系統只查得到自己發起的 Request', async () => {
    const a = await createServiceAccount('系統 A', [equipmentId]);
    const b = await createServiceAccount('系統 B', [equipmentId]);
    const externalA = app.anonymous.withApiKey(a.apiKey);
    const externalB = app.anonymous.withApiKey(b.apiKey);

    const res = await externalA.post('/api/external/requests', {
      processId: equipmentId,
      title: 'A 發起的',
      data: { employee: '甲' },
    });
    const fromA = (await res.json()) as ExternalRequest;
    const fromPortal = (await (
      await employee.post('/api/requests', {
        processId: equipmentId,
        title: '自己發起的',
        data: { employee: '乙' },
      })
    ).json()) as RequestDetail;

    expect((await status(externalA, fromA.id)).title).toBe('A 發起的');
    expect((await externalB.get(`/api/external/requests/${fromA.id}`)).status).toBe(404);
    expect((await externalA.get(`/api/external/requests/${fromPortal.id}`)).status).toBe(404);
    expect(
      (await externalA.get('/api/external/requests/00000000-0000-4000-8000-000000000000')).status,
    ).toBe(404);

    const listA = (await (
      await externalA.get('/api/external/requests')
    ).json()) as ExternalRequest[];
    expect(listA.map((r) => r.id)).toEqual([fromA.id]);
    const listB = (await (
      await externalB.get('/api/external/requests')
    ).json()) as ExternalRequest[];
    expect(listB).toEqual([]);
  });

  it('外部系統列得出被授權發起的 Process，調整授權範圍後立刻反映', async () => {
    const issued = await createServiceAccount('清單測試', [purchaseId, equipmentId]);
    const external = app.anonymous.withApiKey(issued.apiKey);

    const res = await external.get('/api/external/processes');
    expect(res.status).toBe(200);
    const list = (await res.json()) as ExternalProcess[];
    expect(list.map((p) => [p.id, p.name, p.version])).toEqual([
      [equipmentId, '入職設備申請', 1],
      [purchaseId, '採購申請', 1],
    ]);
    expect(Object.keys(list[0] ?? {}).sort()).toEqual(['id', 'name', 'publishedAt', 'version']);
    expect(Number.isNaN(Date.parse(list[0]?.publishedAt ?? ''))).toBe(false);

    expect(
      (
        await admin.put(`/api/service-accounts/${issued.serviceAccount.id}/processes`, {
          processIds: [purchaseId],
        })
      ).status,
    ).toBe(200);
    const after = (await (
      await external.get('/api/external/processes')
    ).json()) as ExternalProcess[];
    expect(after.map((p) => p.id)).toEqual([purchaseId]);

    const none = await createServiceAccount('清單測試－空', []);
    const empty = await app.anonymous.withApiKey(none.apiKey).get('/api/external/processes');
    expect(await empty.json()).toEqual([]);

    expect((await app.anonymous.get('/api/external/processes')).status).toBe(401);
    expect((await employee.get('/api/external/processes')).status).toBe(401);
  });

  it('外部系統查得到 Process 目前版本的開始表單欄位；沒被授權或不存在的回 404', async () => {
    const expense: FormSchema = {
      id: 'expense',
      name: '報銷單',
      fields: [
        {
          id: 'f1',
          key: 'amount',
          type: 'money',
          label: '金額',
          required: true,
          help: '新台幣',
          rules: { min: 1 },
        },
        {
          id: 'f2',
          key: 'category',
          type: 'radio',
          label: '類別',
          required: false,
          rules: {},
          options: ['交通', '餐費'],
        },
        {
          id: 'f3',
          key: 'items',
          type: 'table',
          label: '明細',
          required: false,
          rules: {},
          columns: [
            { id: 'c1', key: 'desc', type: 'text', label: '說明', required: true, rules: {} },
          ],
        },
      ],
    };
    const dsl = oneApproval({ type: 'role', roleId: hrRoleId });
    const expenseId = await publish('報銷申請', {
      ...dsl,
      nodes: dsl.nodes.map((n) => (n.type === 'start' ? { ...n, formId: 'expense' } : n)),
      forms: [expense],
    });
    const plainDsl = oneApproval({ type: 'role', roleId: hrRoleId });
    const plainId = await publish('無表單申請', {
      ...plainDsl,
      nodes: plainDsl.nodes.map((n) => (n.type === 'start' ? { ...n, formId: undefined } : n)),
      forms: [],
    });
    const issued = await createServiceAccount('欄位測試', [expenseId, plainId]);
    const external = app.anonymous.withApiKey(issued.apiKey);

    const res = await external.get(`/api/external/processes/${expenseId}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as ExternalProcessDetail;
    expect(detail).toMatchObject({ id: expenseId, name: '報銷申請', version: 1 });
    expect(detail.startForm?.fields).toEqual([
      {
        key: 'amount',
        type: 'money',
        label: '金額',
        required: true,
        help: '新台幣',
        rules: { min: 1 },
      },
      {
        key: 'category',
        type: 'radio',
        label: '類別',
        required: false,
        rules: {},
        options: ['交通', '餐費'],
      },
      {
        key: 'items',
        type: 'table',
        label: '明細',
        required: false,
        rules: {},
        columns: [{ key: 'desc', type: 'text', label: '說明', required: true, rules: {} }],
      },
    ]);

    const plain = (await (
      await external.get(`/api/external/processes/${plainId}`)
    ).json()) as ExternalProcessDetail;
    expect(plain.startForm).toBeNull();

    // Designer 發佈新版本後，回傳新的版本與開始表單。
    const renamed = { ...expense, fields: [{ ...expense.fields[0], key: 'total' }] } as FormSchema;
    expect(
      (
        await designer.put(`/api/processes/${expenseId}/draft`, {
          dsl: {
            ...dsl,
            nodes: dsl.nodes.map((n) => (n.type === 'start' ? { ...n, formId: 'expense' } : n)),
            forms: [renamed],
          },
        })
      ).status,
    ).toBe(200);
    expect((await designer.post(`/api/processes/${expenseId}/versions`, {})).status).toBe(201);
    const v2 = (await (
      await external.get(`/api/external/processes/${expenseId}`)
    ).json()) as ExternalProcessDetail;
    expect(v2.version).toBe(2);
    expect(v2.startForm?.fields.map((f) => f.key)).toEqual(['total']);

    expect((await external.get(`/api/external/processes/${equipmentId}`)).status).toBe(404);
    expect(
      (await external.get('/api/external/processes/00000000-0000-4000-8000-000000000000')).status,
    ).toBe(404);
    expect((await external.get('/api/external/processes/not-a-uuid')).status).toBe(400);
  });

  it('外部 API 有 OpenAPI 文件，只包含外部 API', async () => {
    const res = await app.anonymous.get('/api/external/docs-json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, Record<string, { security?: unknown[] }>>;
      components: {
        securitySchemes: Record<string, { type: string; scheme?: string }>;
        schemas: Record<string, { properties?: Record<string, unknown> }>;
      };
    };
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/external/processes',
      '/api/external/processes/{id}',
      '/api/external/requests',
      '/api/external/requests/{id}',
    ]);
    expect(Object.values(doc.components.securitySchemes)).toContainEqual(
      expect.objectContaining({ type: 'http', scheme: 'bearer' }),
    );
    for (const operation of Object.values(doc.paths).flatMap((p) => Object.values(p)))
      expect(operation.security?.length).toBeGreaterThan(0);
    expect(Object.keys(doc.components.schemas.ExternalStartRequestDto?.properties ?? {})).toEqual([
      'processId',
      'title',
      'data',
      'on_behalf_of',
    ]);

    expect((await app.anonymous.get('/api/external/docs')).status).toBe(200);
  });
});
