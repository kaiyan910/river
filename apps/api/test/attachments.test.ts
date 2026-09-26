import type { Permission } from '@river/auth';
import type {
  AttachmentDownload,
  AttachmentUpload,
  FormRejected,
  MyTask,
  Process,
  PublishRejected,
  RequestDetail,
  StartableProcess,
} from '@river/contracts';
import type { ProcessDsl, ProcessNode } from '@river/dsl';
import type { AttachmentRef, FormSchema } from '@river/forms';
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

/** 開始表單：金額 + 收據（只收 PDF、PNG，每個最多 1 MB，最多 2 個，必填）。 */
const expense: FormSchema = {
  id: 'expense',
  name: '報銷單',
  fields: [
    { id: 'f1', key: 'amount', type: 'money', label: '金額', required: true, rules: {} },
    {
      id: 'f2',
      key: 'receipts',
      type: 'attachment',
      label: '收據',
      required: true,
      rules: { accept: ['.pdf', '.png'], maxSizeMb: 1, maxFiles: 2 },
    },
  ],
};

/** 財務填表：附上報價單（不限類型）。 */
const quotation: FormSchema = {
  id: 'quotation',
  name: '報價單',
  fields: [
    {
      id: 'q1',
      key: 'quote',
      type: 'attachment',
      label: '報價單',
      required: false,
      rules: {},
    },
  ],
};

const at = (y: number) => ({ x: 0, y });

/** start（報銷單）→ 財務填表（報價單）→ 主管審批 → end */
function expenseFlow(people: { financeId: string; managerId: string }): ProcessDsl {
  const nodes: ProcessNode[] = [
    { id: 'start', type: 'start', name: '開始', formId: 'expense', position: at(0) },
    {
      id: 'finance',
      type: 'form',
      name: '財務附上報價單',
      formId: 'quotation',
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
    forms: [expense, quotation],
  };
}

describe('附件欄位', () => {
  let app: TestApp;
  let designer: ApiClient;
  /** 王小明：報銷的發起人。 */
  let initiator: ApiClient;
  /** 林會計：財務填表。 */
  let finance: ApiClient;
  /** 陳主管：審批人。 */
  let manager: ApiClient;
  /** 李建宏：和 Request 沒有關係。 */
  let outsider: ApiClient;
  let people: { financeId: string; managerId: string };
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

  /** 登記檔案、取得 presigned 上傳 URL。 */
  function register(as: ApiClient, fileName: string, content: string, contentType: string) {
    return as.post('/api/attachments', {
      fileName,
      contentType,
      size: Buffer.byteLength(content),
    });
  }

  /** 瀏覽器直接把檔案上傳到 object storage（不經過 API）。 */
  function put(upload: AttachmentUpload['upload'], content: string | Buffer) {
    return fetch(upload.url, { method: upload.method, headers: upload.headers, body: content });
  }

  /** 登記並上傳一個檔案，回傳要放進 Form 資料的附件。 */
  async function upload(
    as: ApiClient,
    fileName: string,
    content: string,
    contentType = 'application/pdf',
  ): Promise<AttachmentRef> {
    const res = await register(as, fileName, content, contentType);
    expect(res.status).toBe(201);
    const body = (await res.json()) as AttachmentUpload;
    expect((await put(body.upload, content)).status).toBe(200);
    return body.attachment;
  }

  function start(data: Record<string, unknown>, title = '三月交通費') {
    return initiator.post('/api/requests', { processId, title, data });
  }

  async function started(data: Record<string, unknown>, title?: string): Promise<RequestDetail> {
    const res = await start(data, title);
    expect(res.status).toBe(201);
    return (await res.json()) as RequestDetail;
  }

  function download(as: ApiClient, attachmentId: string) {
    return as.get(`/api/attachments/${attachmentId}/download`);
  }

  async function downloaded(as: ApiClient, attachmentId: string) {
    const res = await download(as, attachmentId);
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as AttachmentDownload;
    const file = await fetch(url);
    expect(file.status).toBe(200);
    return { url, file, text: await file.text() };
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

  const complete = (as: ApiClient, task: MyTask, body: object) =>
    as.post(`/api/tasks/${task.id}/complete`, { version: task.version, ...body });

  beforeAll(async () => {
    app = await startTestApp();
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    initiator = (await signInAs('initiator@river.test', '王小明')).client;
    const f = await signInAs('finance@river.test', '林會計');
    const m = await signInAs('manager@river.test', '陳主管');
    outsider = (await signInAs('outsider@river.test', '李建宏')).client;
    finance = f.client;
    manager = m.client;
    people = { financeId: f.participantId, managerId: m.participantId };
    processId = await publish('報銷', expenseFlow(people));
  });
  afterAll(() => app?.close());

  it('附件欄位可以設定允許的檔案類型、大小上限和數量，隨 Process Version 發佈', async () => {
    const list = (await (
      await initiator.get('/api/processes/startable')
    ).json()) as StartableProcess[];
    expect(list.find((p) => p.id === processId)?.startForm?.fields[1]).toEqual({
      id: 'f2',
      key: 'receipts',
      type: 'attachment',
      label: '收據',
      required: true,
      rules: { accept: ['.pdf', '.png'], maxSizeMb: 1, maxFiles: 2 },
    });

    const bad = expenseFlow(people);
    bad.forms = [
      {
        ...expense,
        fields: [
          { ...(expense.fields[1] as FormSchema['fields'][number]), rules: { accept: ['pdf'] } },
        ],
      },
      quotation,
    ];
    const id = await createWithDraft('報銷（副檔名錯誤）', bad);
    const res = await designer.post(`/api/processes/${id}/versions`, {});
    expect(res.status).toBe(422);
    expect(((await res.json()) as PublishRejected).errors.map((e) => [e.code, e.fieldId])).toEqual([
      ['FIELD_BAD_ACCEPT', 'f2'],
    ]);
  });

  it('API 發出 presigned 上傳 URL，瀏覽器直接上傳；送出表單後附件跟著 Request，看得到的人都能下載', async () => {
    const content = '%PDF-1.4 高鐵票收據';
    const res = await register(initiator, '高鐵票收據.pdf', content, 'application/pdf');
    expect(res.status).toBe(201);
    const registered = (await res.json()) as AttachmentUpload;
    expect(registered.attachment).toEqual({
      id: expect.any(String),
      name: '高鐵票收據.pdf',
      size: Buffer.byteLength(content),
      contentType: 'application/pdf',
    });
    // 上傳 URL 直接指向 object storage，不是 API。
    expect(registered.upload.url).not.toContain('/api/');
    expect((await put(registered.upload, content)).status).toBe(200);

    const request = await started({ amount: 1490, receipts: [registered.attachment] });
    expect(request.data[0]?.data).toEqual({ amount: 1490, receipts: [registered.attachment] });

    // 發起人、經手的填表人都看得到並下載得到。
    const mine = await downloaded(initiator, registered.attachment.id);
    expect(mine.text).toBe(content);
    expect(mine.file.headers.get('content-disposition')).toContain(
      encodeURIComponent('高鐵票收據.pdf'),
    );
    await waitForTask(finance, request.id);
    expect((await downloaded(finance, registered.attachment.id)).text).toBe(content);
  });

  it('填表 Task 也可以附上檔案，下一步的審批人看得到並下載得到', async () => {
    const receipt = await upload(initiator, 'taxi.png', 'PNG taxi', 'image/png');
    const request = await started({ amount: 320, receipts: [receipt] });

    const task = await waitForTask(finance, request.id);
    const quote = await upload(finance, '報價單.xlsx', 'xlsx quote', 'application/vnd.ms-excel');
    expect(
      (await complete(finance, task, { outcome: 'submitted', data: { quote: [quote] } })).status,
    ).toBe(200);

    await waitForTask(manager, request.id);
    const seen = await detail(request.id, manager);
    expect(seen.data.map((d) => d.data)).toEqual([
      { amount: 320, receipts: [receipt] },
      { quote: [quote] },
    ]);
    expect((await downloaded(manager, receipt.id)).text).toBe('PNG taxi');
    expect((await downloaded(manager, quote.id)).text).toBe('xlsx quote');
  });

  it('看不到該 Request 的人拿不到下載 URL；還沒送出的附件只有上傳的人拿得到', async () => {
    const receipt = await upload(initiator, 'hotel.pdf', 'hotel');
    expect((await download(finance, receipt.id)).status).toBe(404);
    expect((await downloaded(initiator, receipt.id)).text).toBe('hotel');

    const request = await started({ amount: 2000, receipts: [receipt] });
    expect((await download(outsider, receipt.id)).status).toBe(404);
    expect((await download(manager, receipt.id)).status).toBe(404);
    await waitForTask(finance, request.id);
    expect((await download(finance, receipt.id)).status).toBe(200);

    expect((await download(outsider, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await app.anonymous.get(`/api/attachments/${receipt.id}/download`)).status).toBe(401);
  });

  it('檔案類型、大小與數量不符合欄位設定時拒絕送出', async () => {
    const docx = await upload(initiator, '收據.docx', 'docx');
    const big = await upload(initiator, 'big.pdf', 'x'.repeat(1024 * 1024 + 1));
    const [a, b, c] = [
      await upload(initiator, 'a.pdf', 'a'),
      await upload(initiator, 'b.pdf', 'b'),
      await upload(initiator, 'c.pdf', 'c'),
    ];

    for (const [receipts, error] of [
      [[docx], '「收據.docx」的檔案類型不允許，只接受 .pdf、.png'],
      [[big], '「big.pdf」超過 1 MB'],
      [[a, b, c], '最多 2 個檔案'],
      [[], '至少上傳一個檔案'],
    ] as const) {
      const res = await start({ amount: 100, receipts });
      expect(res.status).toBe(422);
      expect(((await res.json()) as FormRejected).errors).toEqual({ receipts: error });
    }

    // 超過系統上限的檔案連上傳 URL 都拿不到。
    expect(
      (
        await initiator.post('/api/attachments', {
          fileName: 'huge.pdf',
          contentType: 'application/pdf',
          size: 51 * 1024 * 1024,
        })
      ).status,
    ).toBe(400);
  });

  it('送出時確認檔案真的上傳了：還沒上傳、或上傳的大小和登記的不符都會被拒絕', async () => {
    const res = await register(initiator, 'pending.pdf', 'pending', 'application/pdf');
    const pending = (await res.json()) as AttachmentUpload;
    const notYet = await start({ amount: 100, receipts: [pending.attachment] });
    expect(notYet.status).toBe(422);
    expect(((await notYet.json()) as FormRejected).errors).toEqual({
      receipts: '「pending.pdf」還沒上傳完成',
    });

    // 上傳 URL 簽入了大小，不能拿來上傳別的檔案。
    expect((await put(pending.upload, 'a much longer file than registered')).ok).toBe(false);

    // 瀏覽器送出的中繼資料不算數，以 API 登記的為準。
    await put(pending.upload, 'pending');
    const lied = await started({
      amount: 100,
      receipts: [{ ...pending.attachment, name: 'renamed.pdf', size: 1 }],
    });
    expect(lied.data[0]?.data.receipts).toEqual([pending.attachment]);
  });

  it('不能用別人上傳、或已經屬於其他 Request 的附件', async () => {
    const theirs = await upload(finance, 'finance.pdf', 'finance');
    const res = await start({ amount: 100, receipts: [theirs] });
    expect(res.status).toBe(422);
    expect(((await res.json()) as FormRejected).errors).toEqual({
      receipts: '找不到附件，請重新上傳',
    });

    const receipt = await upload(initiator, 'once.pdf', 'once');
    await started({ amount: 100, receipts: [receipt] });
    const again = await start({ amount: 100, receipts: [receipt] });
    expect(again.status).toBe(422);
    expect(((await again.json()) as FormRejected).errors).toEqual({
      receipts: '找不到附件，請重新上傳',
    });
  });

  it('Return 後重新送出時可以沿用原本的附件，也可以加上新的', async () => {
    const receipt = await upload(initiator, 'first.pdf', 'first');
    const request = await started({ amount: 100, receipts: [receipt] });
    const task = await waitForTask(finance, request.id);
    expect((await complete(finance, task, { outcome: 'submitted', data: {} })).status).toBe(200);
    const approval = await waitForTask(manager, request.id);
    expect(
      (await complete(manager, approval, { outcome: 'returned', comment: '缺計程車收據' })).status,
    ).toBe(200);

    const extra = await upload(initiator, 'second.png', 'second', 'image/png');
    const res = await initiator.post(`/api/requests/${request.id}/resubmit`, {
      title: '三月交通費（補收據）',
      data: { amount: 100, receipts: [receipt, extra] },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as RequestDetail).data[0]?.data.receipts).toEqual([receipt, extra]);
    expect((await downloaded(initiator, extra.id)).text).toBe('second');
  });

  it('安全（Seam ①）：附件內容與下載 URL 都不會進入 Temporal', async () => {
    const secret = 'SECRET-ATTACHMENT-CONTENT-3c9e';
    const receipt = await upload(initiator, 'SECRET-FILENAME-7d21.pdf', secret);
    const request = await started({ amount: 100, receipts: [receipt] });

    const task = await waitForTask(finance, request.id);
    const quote = await upload(finance, 'quote.pdf', 'SECRET-QUOTE-CONTENT-a8f0');
    expect(
      (await complete(finance, task, { outcome: 'submitted', data: { quote: [quote] } })).status,
    ).toBe(200);
    const approval = await waitForTask(manager, request.id);
    // 審批人在處理 Task 時下載附件。
    const { url } = await downloaded(manager, receipt.id);
    expect((await complete(manager, approval, { outcome: 'approved' })).status).toBe(200);
    await eventually(
      () => detail(request.id),
      (d) => d.status === 'completed',
    );

    const history = await app.temporal.workflow.getHandle(request.id).fetchHistory();
    const payloads = payloadTexts(history);
    expect(payloads.some((p) => p.includes(request.id))).toBe(true);
    const everything = payloads.join('\n');
    const signature = new URL(url).searchParams.get('X-Amz-Signature') ?? '';
    expect(signature).not.toBe('');
    for (const value of [
      secret,
      'SECRET-QUOTE-CONTENT-a8f0',
      'SECRET-FILENAME-7d21',
      url,
      signature,
      receipt.id,
      quote.id,
    ])
      expect(everything).not.toContain(value);
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
