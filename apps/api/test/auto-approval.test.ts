import type { Permission } from '@river/auth';
import type {
  MyTask,
  Process,
  PublishRejected,
  RequestDetail,
  StartableProcess,
} from '@river/contracts';
import type { ProcessDsl } from '@river/dsl';
import type { FormSchema } from '@river/forms';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiClient, startTestApp, type TestApp } from './harness.js';

const PASSWORD = 'correct horse battery staple';
const THRESHOLD = 'amount < 1000';

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`等不到預期的狀態：${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const purchase: FormSchema = {
  id: 'purchase',
  name: '採購申請單',
  fields: [
    { id: 'f1', key: 'item', type: 'text', label: '品項', required: true, rules: {} },
    { id: 'f2', key: 'amount', type: 'money', label: '金額', required: true, rules: {} },
  ],
};

const at = (y: number) => ({ x: 0, y });

/** start（採購申請單）→ 主管審批（條件成立時自動核准）→ 財務審批 → end */
function purchaseFlow(
  people: { managerId: string; financeId: string },
  expression: string = THRESHOLD,
): ProcessDsl {
  return {
    nodes: [
      { id: 'start', type: 'start', name: '開始', formId: 'purchase', position: at(0) },
      {
        id: 'manager',
        type: 'approval',
        name: '主管審批',
        assignee: { type: 'participant', participantId: people.managerId },
        autoApprove: { expression },
        position: at(170),
      },
      {
        id: 'finance',
        type: 'approval',
        name: '財務審批',
        assignee: { type: 'participant', participantId: people.financeId },
        position: at(340),
      },
      { id: 'end', type: 'end', name: '結束', position: at(510) },
    ],
    edges: [
      { id: 'e-start', source: 'start', target: 'manager' },
      { id: 'e-manager', source: 'manager', target: 'finance' },
      { id: 'e-finance', source: 'finance', target: 'end' },
    ],
    forms: [purchase],
  };
}

describe('自動核准（Auto-approval）', () => {
  let app: TestApp;
  let designer: ApiClient;
  let employee: ApiClient;
  let manager: ApiClient;
  let finance: ApiClient;
  let people: { managerId: string; financeId: string };
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

  async function publish(name: string, dsl: ProcessDsl): Promise<string> {
    const id = await saveDraft(name, dsl);
    expect((await designer.post(`/api/processes/${id}/versions`, {})).status).toBe(201);
    return id;
  }

  async function tasksOf(as: ApiClient, status: 'open' | 'completed'): Promise<MyTask[]> {
    const res = await as.get(`/api/tasks/mine?status=${status}`);
    expect(res.status).toBe(200);
    return (await res.json()) as MyTask[];
  }

  async function waitForTask(as: ApiClient, requestId: string): Promise<MyTask> {
    const tasks = await eventually(
      () => tasksOf(as, 'open'),
      (list) => list.some((t) => t.request.id === requestId),
    );
    return tasks.find((t) => t.request.id === requestId) as MyTask;
  }

  async function approve(as: ApiClient, requestId: string): Promise<void> {
    const task = await waitForTask(as, requestId);
    const res = await as.post(`/api/tasks/${task.id}/complete`, {
      outcome: 'approved',
      version: task.version,
    });
    expect(res.status).toBe(200);
  }

  async function detail(id: string): Promise<RequestDetail> {
    const res = await employee.get(`/api/requests/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as RequestDetail;
  }

  async function completed(id: string): Promise<RequestDetail> {
    return eventually(
      () => detail(id),
      (d) => d.status === 'completed',
    );
  }

  async function startPurchase(title: string, amount: number, process = processId) {
    const res = await employee.post('/api/requests', {
      processId: process,
      title,
      data: { item: '筆電', amount },
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as RequestDetail).id;
  }

  const autoApprovals = (d: RequestDetail) =>
    d.events.filter((e) => e.type === 'step.auto_approved').map((e) => e.node?.name);

  beforeAll(async () => {
    app = await startTestApp();
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    employee = (await signInAs('employee@river.test', '王小明')).client;
    const m = await signInAs('manager@river.test', '張經理');
    const f = await signInAs('finance@river.test', '李會計');
    manager = m.client;
    finance = f.client;
    people = { managerId: m.participantId, financeId: f.participantId };
    processId = await publish('採購', purchaseFlow(people));
  });
  afterAll(() => app?.close());

  it('條件成立時自動核准：不建立 Task，不出現在審批人的待辦中，時間軸記錄自動核准', async () => {
    const id = await startPurchase('採購滑鼠', 800);

    await approve(finance, id);
    const done = await completed(id);
    expect(done.tasks.map((t) => t.nodeName)).toEqual(['財務審批']);
    expect(autoApprovals(done)).toEqual(['主管審批']);
    const auto = done.events.find((e) => e.type === 'step.auto_approved');
    expect(auto).toMatchObject({ actor: null, task: null, node: { id: 'manager' } });
    // 自動核准發生在財務審批的 Task 建立之前。
    expect(done.events.map((e) => e.type)).toEqual([
      'request.started',
      'step.auto_approved',
      'task.created',
      'task.completed',
      'request.completed',
    ]);
    for (const status of ['open', 'completed'] as const)
      expect((await tasksOf(manager, status)).some((t) => t.request.id === id)).toBe(false);
  });

  it('時間軸與流程預覽都不露出自動核准的條件', async () => {
    const id = await startPurchase('採購鍵盤', 900);
    await approve(finance, id);
    expect(JSON.stringify(await completed(id))).not.toContain(THRESHOLD);

    const res = await employee.get('/api/processes/startable');
    const process = ((await res.json()) as StartableProcess[]).find((p) => p.id === processId);
    expect(process?.steps.map((s) => s.name)).toEqual(['開始', '主管審批', '財務審批', '結束']);
    expect(JSON.stringify(process)).not.toContain(THRESHOLD);
  });

  it('條件不成立時照常建立 Task 交給審批人', async () => {
    const id = await startPurchase('採購筆電', 35000);

    await approve(manager, id);
    await approve(finance, id);
    const done = await completed(id);
    expect(done.tasks.map((t) => t.nodeName)).toEqual(['主管審批', '財務審批']);
    expect(autoApprovals(done)).toEqual([]);
  });

  it('表達式執行出錯時照常建立 Task 交給審批人', async () => {
    const failing = await publish('採購－條件會出錯', purchaseFlow(people, '$number(item) < 1000'));
    const id = await startPurchase('採購耳機', 500, failing);

    await approve(manager, id);
    await approve(finance, id);
    const done = await completed(id);
    expect(done.tasks.map((t) => t.nodeName)).toEqual(['主管審批', '財務審批']);
    expect(autoApprovals(done)).toEqual([]);
  });

  it('Return 後重新送出會依新一輪的資料重新判斷', async () => {
    const id = await startPurchase('採購螢幕', 800);
    const task = await waitForTask(finance, id);
    const returned = await finance.post(`/api/tasks/${task.id}/complete`, {
      outcome: 'returned',
      version: task.version,
      comment: '規格要升級',
    });
    expect(returned.status).toBe(200);
    await eventually(
      () => detail(id),
      (d) => d.status === 'returned',
    );

    const res = await employee.post(`/api/requests/${id}/resubmit`, {
      title: '採購螢幕',
      data: { item: '4K 螢幕', amount: 18000 },
    });
    expect(res.status).toBe(200);
    await approve(manager, id);
    await approve(finance, id);
    const done = await completed(id);
    expect(done.tasks.filter((t) => t.round === 2).map((t) => t.nodeName)).toEqual([
      '主管審批',
      '財務審批',
    ]);
    // 只有第一輪自動核准過。
    expect(autoApprovals(done)).toEqual(['主管審批']);
  });

  it('安全：Form 的值不會出現在 Temporal history 中', async () => {
    const id = await startPurchase('採購機密零件', 987.65);
    await approve(finance, id);
    await completed(id);

    const history = await app.temporal.workflow.getHandle(id).fetchHistory();
    const everything = payloadTexts(history).join('\n');
    // 確認真的解開了 payload：evaluateAutoApproval 的輸入看得到節點 ID。
    expect(everything).toContain('"nodeId":"manager"');
    expect(everything).not.toContain('987.65');
  });

  it('啟用自動核准卻沒有表達式，或表達式有語法錯誤時不能發佈', async () => {
    const blank = await saveDraft('採購－沒有條件', purchaseFlow(people, ' '));
    const invalid = await saveDraft('採購－語法錯誤', purchaseFlow(people, 'amount <'));

    for (const [id, code] of [
      [blank, 'AUTO_APPROVAL_NO_EXPRESSION'],
      [invalid, 'INVALID_JSONATA'],
    ] as const) {
      const res = await designer.post(`/api/processes/${id}/versions`, {});
      expect(res.status).toBe(422);
      expect(
        ((await res.json()) as PublishRejected).errors.map((e) => [e.code, e.nodeId, e.edgeId]),
      ).toEqual([[code, 'manager', undefined]]);
    }
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
