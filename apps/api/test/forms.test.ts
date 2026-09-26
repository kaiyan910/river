import type { Permission } from '@river/auth';
import type {
  FormRejected,
  MyTask,
  Process,
  PublishRejected,
  RequestDetail,
  StartableProcess,
} from '@river/contracts';
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

const trip: FormSchema = {
  id: 'trip',
  name: '出差申請單',
  fields: [
    { id: 'f1', key: 'destination', type: 'text', label: '目的地', required: true, rules: {} },
    {
      id: 'f2',
      key: 'days',
      type: 'number',
      label: '天數',
      required: true,
      rules: { min: 1, max: 30 },
    },
    {
      id: 'f3',
      key: 'transport',
      type: 'radio',
      label: '交通方式',
      required: false,
      rules: {},
      options: ['高鐵', '飛機'],
    },
  ],
};

const advance: FormSchema = {
  id: 'advance',
  name: '預支款確認',
  fields: [
    { id: 'a1', key: 'amount', type: 'money', label: '核定預支金額', required: true, rules: {} },
    { id: 'a2', key: 'note', type: 'textarea', label: '會計備註', required: false, rules: {} },
  ],
};

const at = (y: number) => ({ x: 0, y });

/** start（開始表單：出差申請單）→ 財務填表（預支款確認）→ 主管審批 → end */
function tripFlow(people: { financeId: string; managerId: string }): ProcessDsl {
  const nodes: ProcessNode[] = [
    { id: 'start', type: 'start', name: '開始', formId: 'trip', position: at(0) },
    {
      id: 'finance',
      type: 'form',
      name: '財務確認預支',
      formId: 'advance',
      assignee: { type: 'participant', participantId: people.financeId },
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
      { id: 'e1', source: 'start', target: 'finance' },
      { id: 'e2', source: 'finance', target: 'manager' },
      { id: 'e3', source: 'manager', target: 'end' },
    ],
    forms: [trip, advance],
  };
}

describe('表單設計器與開始表單', () => {
  let app: TestApp;
  let designer: ApiClient;
  let initiator: ApiClient;
  let finance: ApiClient;
  let manager: ApiClient;
  let people: { financeId: string; managerId: string };

  async function signInAs(email: string, name: string, permissions: Permission[] = []) {
    const { participantId } = await app.provisionParticipant({
      email,
      name,
      password: PASSWORD,
      permissions,
    });
    return { participantId, client: await app.signIn(email, PASSWORD) };
  }

  async function createWithDraft(name: string, dsl: ProcessDsl): Promise<string> {
    const created = (await (await designer.post('/api/processes', { name })).json()) as Process;
    expect((await designer.put(`/api/processes/${created.id}/draft`, { dsl })).status).toBe(200);
    return created.id;
  }

  async function publish(name: string, dsl: ProcessDsl): Promise<string> {
    const id = await createWithDraft(name, dsl);
    expect((await designer.post(`/api/processes/${id}/versions`, {})).status).toBe(201);
    return id;
  }

  async function detail(id: string, as: ApiClient = initiator): Promise<RequestDetail> {
    const res = await as.get(`/api/requests/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as RequestDetail;
  }

  async function waitForTask(as: ApiClient, requestId: string): Promise<MyTask> {
    const list = await eventually(
      async () => (await (await as.get('/api/tasks/mine?status=open')).json()) as MyTask[],
      (tasks) => tasks.some((t) => t.request.id === requestId),
    );
    return list.find((t) => t.request.id === requestId) as MyTask;
  }

  beforeAll(async () => {
    app = await startTestApp();
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    initiator = (await signInAs('initiator@river.test', '王小明')).client;
    const f = await signInAs('finance@river.test', '林會計');
    const m = await signInAs('manager@river.test', '陳主管');
    finance = f.client;
    manager = m.client;
    people = { financeId: f.participantId, managerId: m.participantId };
  });
  afterAll(() => app?.close());

  it('Form 屬於 Process，發佈時隨 Process Version 存成快照；之後改草稿不影響已發佈的版本', async () => {
    const id = await publish('出差（快照）', tripFlow(people));

    const changed = tripFlow(people);
    changed.forms = [
      { ...trip, name: '出差申請單（新版）', fields: trip.fields.slice(0, 1) },
      advance,
    ];
    expect((await designer.put(`/api/processes/${id}/draft`, { dsl: changed })).status).toBe(200);

    const process = (await (await designer.get(`/api/processes/${id}`)).json()) as Process;
    expect(process.versions[0]?.dsl.forms).toEqual([trip, advance]);
    expect(process.draft?.dsl.forms[0]?.name).toBe('出差申請單（新版）');
  });

  it('填表節點沒有指定 Form、或用到的 Form 有問題時不能發佈', async () => {
    const dsl = tripFlow(people);
    dsl.nodes[1] = { ...(dsl.nodes[1] as ProcessNode), formId: null } as ProcessNode;
    dsl.forms = [
      {
        ...trip,
        fields: [
          ...trip.fields,
          { ...advance.fields[0], id: 'dup', key: 'days' } as FormSchema['fields'][number],
        ],
      },
    ];
    const id = await createWithDraft('出差（有問題）', dsl);

    const res = await designer.post(`/api/processes/${id}/versions`, {});
    expect(res.status).toBe(422);
    const body = (await res.json()) as PublishRejected;
    expect(body.errors.map((e) => [e.code, e.nodeId, e.formId ?? null, e.fieldId ?? null])).toEqual(
      [
        ['FORM_NODE_NO_FORM', 'finance', null, null],
        ['FIELD_DUPLICATE_KEY', null, 'trip', 'dup'],
      ],
    );
  });

  it('入口網站列出 Process 的開始表單與每一步用的 Form', async () => {
    const id = await publish('出差（入口）', tripFlow(people));

    const list = (await (
      await initiator.get('/api/processes/startable')
    ).json()) as StartableProcess[];
    const process = list.find((p) => p.id === id);
    expect(process?.startForm).toEqual(trip);
    expect(
      process?.steps.map((s) => [
        s.type,
        s.name,
        s.formId,
        s.assignee && 'name' in s.assignee ? s.assignee.name : null,
      ]),
    ).toEqual([
      ['start', '開始', 'trip', null],
      ['form', '財務確認預支', 'advance', '林會計'],
      ['approval', '主管審批', null, '陳主管'],
      ['end', '結束', null, null],
    ]);
  });

  it('開始表單的資料不合法時拒絕發起，回報每個欄位的錯誤，也不會建立 Request', async () => {
    const id = await publish('出差（驗證）', tripFlow(people));

    const res = await initiator.post('/api/requests', {
      processId: id,
      title: '高雄出差',
      data: { destination: '', days: '45', transport: '火箭' },
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as FormRejected).toEqual({
      message: expect.any(String),
      errors: { destination: '必填', days: '不能大於 30', transport: '不是有效的選項' },
    });
    const mine = (await (await initiator.get('/api/requests/mine')).json()) as RequestDetail[];
    expect(mine.some((r) => r.process.id === id)).toBe(false);
  });

  /** 發起出差申請（開始表單合法），回傳 Request。 */
  async function startTrip(processId: string, title: string, data: Record<string, unknown>) {
    const res = await initiator.post('/api/requests', { processId, title, data });
    expect(res.status).toBe(201);
    return (await res.json()) as RequestDetail;
  }

  it('開始表單的資料依步驟存下，發起人、填表人與審批人都以唯讀方式看到', async () => {
    const id = await publish('出差（資料）', tripFlow(people));

    const request = await startTrip(id, '高雄客戶拜訪', {
      destination: ' 高雄 ',
      days: '3',
      transport: '高鐵',
    });
    expect(request.forms).toEqual([trip, advance]);
    expect(request.data).toEqual([
      {
        nodeId: 'start',
        nodeName: '開始',
        formId: 'trip',
        data: { destination: '高雄', days: 3, transport: '高鐵' },
        people: [],
        submittedBy: { id: expect.any(String), name: '王小明' },
        submittedAt: expect.any(String),
      },
    ]);

    await waitForTask(finance, request.id);
    expect((await detail(request.id, finance)).data).toEqual(request.data);
  });

  it('填表 Task：送出不合法的資料被拒絕；合法時存下並往下一步，審批人看到每一步的資料', async () => {
    const id = await publish('出差（填表）', tripFlow(people));
    const request = await startTrip(id, '台中出差', { destination: '台中', days: 1 });

    const task = await waitForTask(finance, request.id);
    expect(task).toMatchObject({ kind: 'form', nodeName: '財務確認預支' });

    const approveInstead = await finance.post(`/api/tasks/${task.id}/complete`, {
      outcome: 'approved',
      version: task.version,
    });
    expect(approveInstead.status).toBe(422);

    const invalid = await finance.post(`/api/tasks/${task.id}/complete`, {
      outcome: 'submitted',
      version: task.version,
      data: { amount: '12.345' },
    });
    expect(invalid.status).toBe(422);
    expect(((await invalid.json()) as FormRejected).errors).toEqual({
      amount: '最多到小數點後兩位',
    });

    const ok = await finance.post(`/api/tasks/${task.id}/complete`, {
      outcome: 'submitted',
      version: task.version,
      data: { amount: '5000', note: '請在出發前撥款' },
    });
    expect(ok.status).toBe(200);

    const approval = await waitForTask(manager, request.id);
    expect(approval.kind).toBe('approval');
    const seen = await detail(request.id, manager);
    expect(seen.data.map((d) => [d.nodeName, d.submittedBy.name, d.data])).toEqual([
      ['開始', '王小明', { destination: '台中', days: 1, transport: null }],
      ['財務確認預支', '林會計', { amount: 5000, note: '請在出發前撥款' }],
    ]);
    expect(seen.tasks.map((t) => [t.nodeName, t.kind, t.status, t.outcome])).toEqual([
      ['財務確認預支', 'form', 'completed', 'submitted'],
      ['主管審批', 'approval', 'open', null],
    ]);
    expect(seen.events.find((e) => e.type === 'task.completed')?.task?.kind).toBe('form');
  });

  it('沒有開始表單的 Process 不接受表單資料', async () => {
    const dsl = tripFlow(people);
    dsl.nodes[0] = { id: 'start', type: 'start', name: '開始', position: at(0) };
    const id = await publish('出差（無開始表單）', dsl);

    const res = await initiator.post('/api/requests', {
      processId: id,
      title: 'x',
      data: { a: 1 },
    });
    expect(res.status).toBe(422);
    expect(
      (await initiator.post('/api/requests', { processId: id, title: '只有標題' })).status,
    ).toBe(201);
  });

  it('安全：跑完一筆 Request 後，Temporal history 的所有 payload 中都找不到任何表單欄位的值', async () => {
    const id = await publish('出差（安全）', tripFlow(people));
    const secrets = {
      destination: 'SECRET-DESTINATION-7f3a',
      amount: 987654.32,
      note: 'SECRET-NOTE-b41c',
    };

    const request = await startTrip(id, '機密出差', { destination: secrets.destination, days: 2 });
    const task = await waitForTask(finance, request.id);
    expect(
      (
        await finance.post(`/api/tasks/${task.id}/complete`, {
          outcome: 'submitted',
          version: task.version,
          data: { amount: secrets.amount, note: secrets.note },
        })
      ).status,
    ).toBe(200);
    const approval = await waitForTask(manager, request.id);
    expect(
      (
        await manager.post(`/api/tasks/${approval.id}/complete`, {
          outcome: 'approved',
          version: approval.version,
        })
      ).status,
    ).toBe(200);
    await eventually(
      () => detail(request.id),
      (d) => d.status === 'completed',
    );

    const history = await app.temporal.workflow.getHandle(request.id).fetchHistory();
    const payloads = payloadTexts(history);
    // 確認真的解開了 payload：workflow 的輸入（Request ID）看得到。
    expect(payloads.some((p) => p.includes(request.id))).toBe(true);
    const everything = payloads.join('\n');
    for (const value of [secrets.destination, String(secrets.amount), secrets.note, '987654'])
      expect(everything).not.toContain(value);
    // Form schema 也不進 history：流程圖之外只有 ID 與決策結果。
    expect(everything).not.toContain('預支款確認');
  });
});

/** history 裡每個 payload（workflow 輸入、activity 輸入與回傳值、Signal…）解碼成文字。 */
function payloadTexts(history: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (value instanceof Uint8Array) out.push(Buffer.from(value).toString('utf8'));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(history);
  return out;
}
