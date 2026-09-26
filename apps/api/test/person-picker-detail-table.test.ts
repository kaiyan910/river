import type { Permission } from '@river/auth';
import type {
  FormRejected,
  MyTask,
  PersonOption,
  Process,
  PublishRejected,
  RequestDetail,
} from '@river/contracts';
import type { ProcessDsl, ProcessEdge, ProcessNode } from '@river/dsl';
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

/** 報銷單：專案負責人（人員選擇器）＋ 報銷明細（明細表，每一行有項目、金額、收款人）。 */
const expense: FormSchema = {
  id: 'expense',
  name: '報銷單',
  fields: [
    { id: 'f1', key: 'owner', type: 'person', label: '專案負責人', required: true, rules: {} },
    {
      id: 'f2',
      key: 'items',
      type: 'table',
      label: '報銷明細',
      required: true,
      rules: {},
      columns: [
        { id: 'c1', key: 'item', type: 'text', label: '項目', required: true, rules: {} },
        { id: 'c2', key: 'amount', type: 'money', label: '金額', required: true, rules: {} },
        { id: 'c3', key: 'payee', type: 'person', label: '收款人', required: false, rules: {} },
      ],
    },
  ],
};

const at = (y: number) => ({ x: 0, y });

const approval = (id: string, name: string, participantId: string): ProcessNode => ({
  id,
  type: 'approval',
  name,
  assignee: { type: 'participant', participantId },
  position: at(340),
});

const when = (id: string, target: string, expression: string): ProcessEdge => ({
  id,
  source: 'check',
  target,
  branch: { type: 'expression', expression },
});

/**
 * start（報銷單）→ 判斷
 *   ├ 明細金額加總 > 10000      → 總經理審批
 *   ├ 專案負責人是總經理        → 總經理審批
 *   └ 預設                      → 財務審批
 * 總經理審批 → 財務審批 → end
 */
function expenseFlow(people: { gmId: string; financeId: string }): ProcessDsl {
  return {
    nodes: [
      { id: 'start', type: 'start', name: '開始', formId: 'expense', position: at(0) },
      { id: 'check', type: 'condition', name: '報銷判斷', position: at(170) },
      approval('gm', '總經理審批', people.gmId),
      approval('finance', '財務審批', people.financeId),
      { id: 'end', type: 'end', name: '結束', position: at(680) },
    ],
    edges: [
      { id: 'e-start', source: 'start', target: 'check' },
      when('over-10k', 'gm', '$sum(items.amount) > 10000'),
      when('owner-is-gm', 'gm', `owner = "${people.gmId}"`),
      { id: 'otherwise', source: 'check', target: 'finance', branch: { type: 'default' } },
      { id: 'e-gm', source: 'gm', target: 'finance' },
      { id: 'e-finance', source: 'finance', target: 'end' },
    ],
    forms: [expense],
  };
}

describe('人員選擇器與明細表', () => {
  let app: TestApp;
  let designer: ApiClient;
  let admin: ApiClient;
  let employee: ApiClient;
  let employeeId: string;
  let gm: ApiClient;
  let gmId: string;
  let finance: ApiClient;
  let financeId: string;
  let leaverId: string;
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

  async function approve(as: ApiClient, requestId: string): Promise<void> {
    const tasks = await eventually(
      () => openTasks(as),
      (list) => list.some((t) => t.request.id === requestId),
    );
    const task = tasks.find((t) => t.request.id === requestId) as MyTask;
    const res = await as.post(`/api/tasks/${task.id}/complete`, {
      outcome: 'approved',
      version: task.version,
    });
    expect(res.status).toBe(200);
  }

  async function detail(id: string, as: ApiClient = employee): Promise<RequestDetail> {
    const res = await as.get(`/api/requests/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as RequestDetail;
  }

  function start(title: string, data: Record<string, unknown>): Promise<Response> {
    return employee.post('/api/requests', { processId, title, data });
  }

  async function started(title: string, data: Record<string, unknown>): Promise<string> {
    const res = await start(title, data);
    expect(res.status).toBe(201);
    return ((await res.json()) as RequestDetail).id;
  }

  /** 跑完一筆 Request，回傳依序處理過的節點。 */
  async function completedPath(requestId: string): Promise<string[]> {
    const done = await eventually(
      () => detail(requestId),
      (d) => d.status === 'completed',
    );
    return done.tasks.map((t) => t.nodeName);
  }

  async function search(as: ApiClient, q: string): Promise<PersonOption[]> {
    const res = await as.get(`/api/participants/search?q=${encodeURIComponent(q)}`);
    expect(res.status).toBe(200);
    return (await res.json()) as PersonOption[];
  }

  beforeAll(async () => {
    app = await startTestApp();
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    admin = (await signInAs('admin@river.test', '張管理', ['user.manage'])).client;
    const e = await signInAs('employee@river.test', '王小明');
    const g = await signInAs('gm@river.test', '林總');
    const f = await signInAs('finance@river.test', '李會計');
    employee = e.client;
    employeeId = e.participantId;
    gm = g.client;
    gmId = g.participantId;
    finance = f.client;
    financeId = f.participantId;
    leaverId = (await signInAs('leaver@river.test', '林已離職')).participantId;
    expect((await admin.post(`/api/participants/${leaverId}/deactivate`)).status).toBe(200);

    processId = await saveDraft('報銷', expenseFlow({ gmId, financeId }));
    expect((await designer.post(`/api/processes/${processId}/versions`, {})).status).toBe(201);
  });
  afterAll(() => app?.close());

  describe('人員選擇器', () => {
    it('任何 Participant 都可以依姓名或 email 搜尋，只列出沒有停用的人', async () => {
      expect(await search(employee, '林')).toEqual([
        { id: gmId, name: '林總', email: 'gm@river.test' },
      ]);
      expect((await search(employee, 'FINANCE@')).map((p) => p.name)).toEqual(['李會計']);
      expect(await search(employee, '找不到的人')).toEqual([]);
    });

    it('存下 Participant ID，明細以唯讀方式帶出選到的人的姓名', async () => {
      const id = await started('差旅報銷', {
        owner: gmId,
        items: [{ item: '計程車', amount: '350', payee: financeId }],
      });

      const d = await detail(id);
      expect(d.data).toEqual([
        expect.objectContaining({
          nodeId: 'start',
          data: { owner: gmId, items: [{ item: '計程車', amount: 350, payee: financeId }] },
        }),
      ]);
      expect(d.data[0]?.people).toEqual(
        expect.arrayContaining([
          { id: gmId, name: '林總' },
          { id: financeId, name: '李會計' },
        ]),
      );
    });

    it('選到已停用或不存在的人時拒絕發起（422），錯誤標在那一格', async () => {
      const res = await start('差旅報銷', {
        owner: leaverId,
        items: [
          { item: '計程車', amount: 350, payee: employeeId },
          { item: '住宿', amount: 2400, payee: '00000000-0000-4000-8000-000000000000' },
        ],
      });

      expect(res.status).toBe(422);
      expect(((await res.json()) as FormRejected).errors).toEqual({
        owner: '找不到這個人，或帳號已停用',
        'items[1].payee': '找不到這個人，或帳號已停用',
      });
    });
  });

  describe('明細表', () => {
    it('每一行分別驗證，錯誤的鍵標出第幾行的哪一欄', async () => {
      const res = await start('差旅報銷', {
        owner: gmId,
        items: [
          { item: '計程車', amount: 350 },
          { item: '', amount: 'abc' },
        ],
      });

      expect(res.status).toBe(422);
      expect(((await res.json()) as FormRejected).errors).toEqual({
        'items[1].item': '必填',
        'items[1].amount': '請輸入數字',
      });
    });

    it('必填的明細表至少要有一行', async () => {
      const res = await start('差旅報銷', { owner: gmId, items: [] });

      expect(res.status).toBe(422);
      expect(((await res.json()) as FormRejected).errors).toEqual({ items: '至少要有一行' });
    });

    it('明細表沒有欄位時不能發佈', async () => {
      const dsl = expenseFlow({ gmId, financeId });
      dsl.forms = [{ ...expense, fields: expense.fields.map((f) => ({ ...f, columns: [] })) }];
      const id = await saveDraft('報銷－沒有欄', dsl);

      const res = await designer.post(`/api/processes/${id}/versions`, {});
      expect(res.status).toBe(422);
      expect(
        ((await res.json()) as PublishRejected).errors.map((e) => [e.code, e.fieldId]),
      ).toEqual([['FIELD_NO_COLUMNS', 'f2']]);
    });
  });

  describe('JSONata 讀取人員選擇器與明細表', () => {
    it('明細金額加總超過門檻時加走總經理審批', async () => {
      const id = await started('採購與差旅', {
        owner: financeId,
        items: [
          { item: '機票', amount: 6000 },
          { item: '住宿', amount: 4500.5 },
        ],
      });

      await approve(gm, id);
      await approve(finance, id);
      expect(await completedPath(id)).toEqual(['總經理審批', '財務審批']);
    });

    it('明細金額加總沒有超過門檻時直接到財務審批', async () => {
      const id = await started('小額報銷', {
        owner: financeId,
        items: [
          { item: '文具', amount: 600 },
          { item: '郵資', amount: 80 },
        ],
      });

      await approve(finance, id);
      expect(await completedPath(id)).toEqual(['財務審批']);
    });

    it('條件可以比對人員選擇器存下的 Participant ID', async () => {
      const id = await started('專案報銷', {
        owner: gmId,
        items: [{ item: '文具', amount: 600 }],
      });

      await approve(gm, id);
      await approve(finance, id);
      expect(await completedPath(id)).toEqual(['總經理審批', '財務審批']);
    });
  });
});
