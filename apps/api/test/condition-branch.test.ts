import type { Permission } from '@river/auth';
import type {
  MyTask,
  Process,
  PublishRejected,
  RequestDetail,
  StartableProcess,
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

const purchase: FormSchema = {
  id: 'purchase',
  name: '採購申請單',
  fields: [
    { id: 'f1', key: 'item', type: 'text', label: '品項', required: true, rules: {} },
    { id: 'f2', key: 'amount', type: 'money', label: '金額', required: true, rules: {} },
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
  source: 'amount-check',
  target,
  branch: { type: 'expression', expression },
});

/**
 * start（採購申請單）→ 金額判斷
 *   ├ amount > 100000 → 董事長審批 → 總經理審批
 *   ├ amount > 10000  → 總經理審批
 *   └ 預設            → 財務審批
 * 總經理審批 → 財務審批 → end
 */
function purchaseFlow(people: { chairmanId: string; gmId: string; financeId: string }): ProcessDsl {
  return {
    nodes: [
      { id: 'start', type: 'start', name: '開始', formId: 'purchase', position: at(0) },
      { id: 'amount-check', type: 'condition', name: '金額判斷', position: at(170) },
      approval('chairman', '董事長審批', people.chairmanId),
      approval('gm', '總經理審批', people.gmId),
      approval('finance', '財務審批', people.financeId),
      { id: 'end', type: 'end', name: '結束', position: at(680) },
    ],
    edges: [
      { id: 'e-start', source: 'start', target: 'amount-check' },
      when('over-100k', 'chairman', 'amount > 100000'),
      when('over-10k', 'gm', 'amount > 10000'),
      { id: 'otherwise', source: 'amount-check', target: 'finance', branch: { type: 'default' } },
      { id: 'e-chairman', source: 'chairman', target: 'gm' },
      { id: 'e-gm', source: 'gm', target: 'finance' },
      { id: 'e-finance', source: 'finance', target: 'end' },
    ],
    forms: [purchase],
  };
}

describe('條件分支（JSONata）', () => {
  let app: TestApp;
  let designer: ApiClient;
  let employee: ApiClient;
  let chairman: ApiClient;
  let gm: ApiClient;
  let finance: ApiClient;
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

  async function startPurchase(title: string, amount: number): Promise<string> {
    const res = await employee.post('/api/requests', {
      processId,
      title,
      data: { item: '筆電', amount },
    });
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

  beforeAll(async () => {
    app = await startTestApp();
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    employee = (await signInAs('employee@river.test', '王小明')).client;
    const c = await signInAs('chairman@river.test', '郭董');
    const g = await signInAs('gm@river.test', '林總');
    const f = await signInAs('finance@river.test', '李會計');
    chairman = c.client;
    gm = g.client;
    finance = f.client;

    processId = await saveDraft(
      '採購',
      purchaseFlow({
        chairmanId: c.participantId,
        gmId: g.participantId,
        financeId: f.participantId,
      }),
    );
    expect((await designer.post(`/api/processes/${processId}/versions`, {})).status).toBe(201);
  });
  afterAll(() => app?.close());

  it('金額高於門檻時加走總經理審批', async () => {
    const id = await startPurchase('採購伺服器', 50000);

    await approve(gm, id);
    await approve(finance, id);
    expect(await completedPath(id)).toEqual(['總經理審批', '財務審批']);
  });

  it('金額低於門檻時直接到財務審批（沒有任何條件成立時走預設出邊）', async () => {
    const id = await startPurchase('採購滑鼠', 800);

    await approve(finance, id);
    expect(await completedPath(id)).toEqual(['財務審批']);
    expect((await openTasks(gm)).some((t) => t.request.id === id)).toBe(false);
  });

  it('時間軸記錄條件選中的出邊；明細帶有畫流程圖用的節點與連線', async () => {
    const id = await startPurchase('採購鍵盤', 50000);
    await waitForTask(gm, id);

    const d = await detail(id);
    const chosen = d.events.filter((e) => e.type === 'step.branch_chosen');
    expect(chosen).toEqual([
      expect.objectContaining({
        actor: null,
        task: null,
        node: { id: 'amount-check', name: '金額判斷' },
        edge: {
          id: 'over-10k',
          branch: { type: 'expression', expression: 'amount > 10000' },
          target: { id: 'gm', name: '總經理審批' },
        },
      }),
    ]);
    expect(d.flow.nodes.map((n) => [n.id, n.type])).toContainEqual(['amount-check', 'condition']);
    expect(d.flow.edges).toContainEqual({
      id: 'otherwise',
      source: 'amount-check',
      target: 'finance',
      branch: { type: 'default' },
    });
    expect(d.flow.edges).toContainEqual({
      id: 'e-start',
      source: 'start',
      target: 'amount-check',
      branch: null,
    });
  });

  it('依出邊順序評估，第一個成立的條件勝出', async () => {
    const id = await startPurchase('採購產線設備', 250000);

    await approve(chairman, id);
    await approve(gm, id);
    await approve(finance, id);
    expect(await completedPath(id)).toEqual(['董事長審批', '總經理審批', '財務審批']);
  });

  it('Return 後修改金額重新送出，條件依新一輪的資料判斷', async () => {
    const id = await startPurchase('採購螢幕', 8000);
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
    await approve(gm, id);
    await approve(finance, id);
    const done = await eventually(
      () => detail(id),
      (d) => d.status === 'completed',
    );
    expect(done.tasks.filter((t) => t.round === 2).map((t) => t.nodeName)).toEqual([
      '總經理審批',
      '財務審批',
    ]);
    // 每一輪各記錄一次判斷，畫面只看最後一次重新送出之後的那一筆。
    expect(
      done.events.filter((e) => e.type === 'step.branch_chosen').map((e) => e.edge?.id),
    ).toEqual(['otherwise', 'over-10k']);
  });

  it('流程預覽列出每條分支上的步驟，不列出條件節點', async () => {
    const res = await employee.get('/api/processes/startable');
    const process = ((await res.json()) as StartableProcess[]).find((p) => p.id === processId);
    expect(process?.steps.map((s) => s.name)).toEqual([
      '開始',
      '董事長審批',
      '總經理審批',
      '財務審批',
      '結束',
    ]);
  });

  it('安全：Form 的值不會出現在 Temporal history 中', async () => {
    const id = await startPurchase('採購機密設備', 98765.43);
    await approve(gm, id);
    await approve(finance, id);
    await completedPath(id);

    const history = await app.temporal.workflow.getHandle(id).fetchHistory();
    const everything = payloadTexts(history).join('\n');
    // 確認真的解開了 payload：evaluateCondition 回傳的出邊 ID 看得到。
    expect(everything).toContain('over-10k');
    expect(everything).not.toContain('98765');
  });

  it('JSONata 語法錯誤或缺少預設出邊時不能發佈', async () => {
    const dsl = purchaseFlow({ chairmanId: 'x', gmId: 'x', financeId: 'x' });
    dsl.edges = dsl.edges
      .filter((e) => e.id !== 'otherwise')
      .map((e) => (e.id === 'over-10k' ? when('over-10k', 'gm', 'amount >') : e));
    const id = await saveDraft('採購－有錯', dsl);

    const res = await designer.post(`/api/processes/${id}/versions`, {});
    expect(res.status).toBe(422);
    expect(
      ((await res.json()) as PublishRejected).errors.map((e) => [e.code, e.nodeId, e.edgeId]),
    ).toEqual([
      ['CONDITION_NO_DEFAULT', 'amount-check', undefined],
      ['INVALID_JSONATA', 'amount-check', 'over-10k'],
    ]);
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
