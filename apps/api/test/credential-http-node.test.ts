import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Permission } from '@river/auth';
import type {
  Credential,
  CredentialDirectoryEntry,
  IssuedApiKey,
  Process,
  PublishRejected,
  RequestDetail,
  RequestSummary,
} from '@river/contracts';
import { credentials } from '@river/db';
import type { ProcessDsl, ProcessNode } from '@river/dsl';
import type { FormSchema } from '@river/forms';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ApiClient, startTestApp, type TestApp } from './harness.js';

const PASSWORD = 'correct horse battery staple';
const SECRET = 'erp-secret-4f9a1c7e2b';
const ROTATED = 'erp-secret-rotated-8d3b6a0f5e';
const HEADER_SECRET = 'hr-api-key-2c7e9b1d4a';

async function eventually<T>(read: () => Promise<T> | T, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`等不到預期的狀態：${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** 本機的 stub server：記錄收到的每一個請求，回應的狀態碼可以隨時改。 */
interface StubServer {
  url: string;
  received: { method: string; path: string; headers: IncomingHttpHeaders; body: string }[];
  status: number;
  close(): Promise<void>;
}

async function startStubServer(): Promise<StubServer> {
  const stub = { received: [], status: 200 } as unknown as StubServer;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      stub.received.push({
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(stub.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: stub.status < 400 }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  stub.url = `http://127.0.0.1:${port}`;
  stub.close = () => new Promise((resolve) => server.close(() => resolve()));
  return stub;
}

const trip: FormSchema = {
  id: 'trip',
  name: '出差申請單',
  fields: [
    { id: 'f1', key: 'destination', type: 'text', label: '目的地', required: true, rules: {} },
    { id: 'f2', key: 'amount', type: 'money', label: '預估金額', required: true, rules: {} },
  ],
};

const at = (y: number) => ({ x: 0, y });

/** start（出差申請單）→ HTTP 節點 → end */
function withHttp(http: Partial<Extract<ProcessNode, { type: 'http' }>>): ProcessDsl {
  const nodes: ProcessNode[] = [
    { id: 'start', type: 'start', name: '開始', formId: 'trip', position: at(0) },
    {
      id: 'erp',
      type: 'http',
      name: '建立 ERP 單據',
      method: 'POST',
      url: '',
      body: '{ "destination": destination, "amount": amount }',
      credential: null,
      position: at(170),
      ...http,
    },
    { id: 'end', type: 'end', name: '結束', position: at(340) },
  ];
  return {
    nodes,
    edges: [
      { id: 'e1', source: 'start', target: 'erp' },
      { id: 'e2', source: 'erp', target: 'end' },
    ],
    forms: [trip],
  };
}

/** history 裡的一切（事件、失敗訊息，以及每個解碼成文字的 payload）串成一段文字。 */
function historyText(history: unknown): string {
  const payloads: string[] = [];
  const walk = (value: unknown) => {
    if (value instanceof Uint8Array) payloads.push(Buffer.from(value).toString('utf8'));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(history);
  return [JSON.stringify(history), ...payloads].join('\n');
}

describe('Credential 與 HTTP 節點', () => {
  let app: TestApp;
  let stub: StubServer;
  let keeper: ApiClient;
  let designer: ApiClient;
  let admin: ApiClient;
  let employee: ApiClient;

  async function signInAs(email: string, name: string, permissions: Permission[] = []) {
    await app.provisionParticipant({ email, name, password: PASSWORD, permissions });
    return app.signIn(email, PASSWORD);
  }

  async function publish(name: string, dsl: ProcessDsl): Promise<string> {
    const created = (await (await designer.post('/api/processes', { name })).json()) as Process;
    expect((await designer.put(`/api/processes/${created.id}/draft`, { dsl })).status).toBe(200);
    const res = await designer.post(`/api/processes/${created.id}/versions`, {});
    expect(res.status).toBe(201);
    return created.id;
  }

  async function start(processId: string, title: string, amount = 1200): Promise<string> {
    const res = await employee.post('/api/requests', {
      processId,
      title,
      data: { destination: '台中', amount },
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as RequestDetail).id;
  }

  async function detail(id: string): Promise<RequestDetail> {
    const res = await employee.get(`/api/requests/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as RequestDetail;
  }

  const completed = (id: string) =>
    eventually(
      () => detail(id),
      (d) => d.status === 'completed',
    );
  /** 等到 Request 暫停；activity 的重試有退避時間，所以一邊快轉 Temporal 的時間。 */
  const paused = (id: string) =>
    eventually(
      async () => {
        await app.skipTime('30 seconds');
        return detail(id);
      },
      (d) => d.paused !== null,
    );

  async function createCredential(body: object): Promise<Credential> {
    const res = await keeper.post('/api/credentials', body);
    expect(res.status).toBe(201);
    return (await res.json()) as Credential;
  }

  beforeAll(async () => {
    app = await startTestApp();
    stub = await startStubServer();
    keeper = await signInAs('keeper@river.test', '整合管理員', ['credential.manage']);
    designer = await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish']);
    admin = await signInAs('admin@river.test', '系統管理員', [
      'request.cancel',
      'task.reassign',
      'request.view_all',
      'service_account.manage',
    ]);
    employee = await signInAs('employee@river.test', '王小明');
  });
  afterAll(async () => {
    await stub?.close();
    await app?.close();
  });
  beforeEach(() => {
    stub.received.length = 0;
    stub.status = 200;
  });

  describe('Credential 管理', () => {
    it('建立後 API 永遠不回傳秘密；資料庫裡存的是密文', async () => {
      const res = await keeper.post('/api/credentials', {
        name: 'erp',
        scheme: 'bearer',
        secret: SECRET,
      });
      expect(res.status).toBe(201);
      const text = await res.text();
      expect(text).not.toContain(SECRET);
      const created = JSON.parse(text) as Credential;
      expect(created).toMatchObject({
        name: 'erp',
        scheme: 'bearer',
        headerName: null,
        createdBy: { name: '整合管理員' },
        rotatedBy: { name: '整合管理員' },
      });

      const list = await keeper.get('/api/credentials');
      expect(list.status).toBe(200);
      const listText = await list.text();
      expect(listText).not.toContain(SECRET);
      expect((JSON.parse(listText) as Credential[]).map((c) => c.name)).toContain('erp');

      const [row] = await app.db.select().from(credentials).where(eq(credentials.id, created.id));
      expect(row?.secret).toBeDefined();
      expect(row?.secret).not.toContain(SECRET);
      expect(row?.secret).not.toContain(Buffer.from(SECRET).toString('base64'));
    });

    it('名稱不能重複，格式不對時回 400', async () => {
      await createCredential({ name: 'dup', scheme: 'bearer', secret: 'x' });
      expect(
        (await keeper.post('/api/credentials', { name: 'dup', scheme: 'bearer', secret: 'y' }))
          .status,
      ).toBe(409);
      expect(
        (
          await keeper.post('/api/credentials', {
            name: 'has space',
            scheme: 'bearer',
            secret: 'y',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await keeper.post('/api/credentials', {
            name: 'no-header',
            scheme: 'header',
            secret: 'y',
          })
        ).status,
      ).toBe(400);
      expect(
        (await keeper.post('/api/credentials', { name: 'empty', scheme: 'bearer', secret: '' }))
          .status,
      ).toBe(400);
    });

    it('沒有 credential.manage 不能建立、查看清單、輪替或刪除；Designer 可以挑選名稱', async () => {
      const target = await createCredential({ name: 'guarded', scheme: 'bearer', secret: 'x' });
      for (const as of [designer, admin, employee]) {
        expect((await as.get('/api/credentials')).status).toBe(403);
        expect(
          (await as.post('/api/credentials', { name: 'nope', scheme: 'bearer', secret: 'x' }))
            .status,
        ).toBe(403);
        expect((await as.put(`/api/credentials/${target.id}/secret`, { secret: 'y' })).status).toBe(
          403,
        );
        expect((await as.delete(`/api/credentials/${target.id}`)).status).toBe(403);
      }

      const res = await designer.get('/api/credentials/directory');
      expect(res.status).toBe(200);
      const directory = (await res.json()) as CredentialDirectoryEntry[];
      expect(directory).toContainEqual({ name: 'guarded', scheme: 'bearer', headerName: null });
      expect(Object.keys(directory[0] ?? {}).sort()).toEqual(['headerName', 'name', 'scheme']);
      expect((await employee.get('/api/credentials/directory')).status).toBe(403);
    });

    it('輪替秘密、刪除', async () => {
      const created = await createCredential({ name: 'temp', scheme: 'bearer', secret: 'old' });
      const [before] = await app.db
        .select()
        .from(credentials)
        .where(eq(credentials.id, created.id));

      const rotated = await keeper.put(`/api/credentials/${created.id}/secret`, { secret: 'new' });
      expect(rotated.status).toBe(200);
      expect(((await rotated.json()) as Credential).name).toBe('temp');
      const [after] = await app.db.select().from(credentials).where(eq(credentials.id, created.id));
      expect(after?.secret).not.toBe(before?.secret);

      expect((await keeper.delete(`/api/credentials/${created.id}`)).status).toBe(204);
      expect(
        ((await (await keeper.get('/api/credentials')).json()) as Credential[]).map((c) => c.name),
      ).not.toContain('temp');
      expect((await keeper.delete(`/api/credentials/${created.id}`)).status).toBe(404);
      expect(
        (await keeper.put(`/api/credentials/${created.id}/secret`, { secret: 'x' })).status,
      ).toBe(404);
    });
  });

  describe('HTTP 節點', () => {
    it('Seam ①：stub server 收到 JSONata 組成的 body 與認證 header；Temporal history 找不到秘密與 Form 資料', async () => {
      const processId = await publish(
        '出差－同步 ERP',
        withHttp({ url: `${stub.url}/api/orders?src=river`, credential: 'erp' }),
      );
      const id = await start(processId, '9 月台中出差', 8765.43);
      const done = await completed(id);

      expect(stub.received).toHaveLength(1);
      const [call] = stub.received;
      expect(call?.method).toBe('POST');
      expect(call?.path).toBe('/api/orders?src=river');
      expect(call?.headers.authorization).toBe(`Bearer ${SECRET}`);
      expect(call?.headers['content-type']).toContain('application/json');
      expect(JSON.parse(call?.body ?? '')).toEqual({ destination: '台中', amount: 8765.43 });

      expect(done.events.map((e) => e.type)).toContain('step.http_sent');
      expect(done.events.find((e) => e.type === 'step.http_sent')?.node?.name).toBe(
        '建立 ERP 單據',
      );

      const history = historyText(await app.temporal.workflow.getHandle(id).fetchHistory());
      // 確認真的解開了 payload：httpRequest 的輸入看得到節點 ID。
      expect(history).toContain('"nodeId":"erp"');
      expect(history).not.toContain(SECRET);
      expect(history).not.toContain('8765.43');
    });

    it('header 方式的 Credential 放在指定的 header；沒有 Credential 時不帶認證 header', async () => {
      await createCredential({
        name: 'hr',
        scheme: 'header',
        headerName: 'X-API-Key',
        secret: HEADER_SECRET,
      });
      const withKey = await publish(
        '出差－同步 HR',
        withHttp({ method: 'PUT', url: `${stub.url}/hr`, credential: 'hr' }),
      );
      const anonymous = await publish(
        '出差－通知看板',
        withHttp({ method: 'GET', url: `${stub.url}/board`, body: '' }),
      );
      await completed(await start(withKey, 'HR 同步'));
      await completed(await start(anonymous, '看板通知'));

      const hr = stub.received.find((r) => r.path === '/hr');
      expect(hr?.method).toBe('PUT');
      expect(hr?.headers['x-api-key']).toBe(HEADER_SECRET);
      expect(hr?.headers.authorization).toBeUndefined();
      const board = stub.received.find((r) => r.path === '/board');
      expect(board?.method).toBe('GET');
      expect(board?.body).toBe('');
      expect(board?.headers.authorization).toBeUndefined();
    });

    it('Credential 輪替後，下一次呼叫就使用新的秘密，不需要重新發佈 Process', async () => {
      const [erp] = ((await (await keeper.get('/api/credentials')).json()) as Credential[]).filter(
        (c) => c.name === 'erp',
      );
      const processId = await publish(
        '出差－輪替前發佈',
        withHttp({ url: `${stub.url}/rotate`, credential: 'erp' }),
      );
      await completed(await start(processId, '輪替前'));
      expect(
        (await keeper.put(`/api/credentials/${erp?.id}/secret`, { secret: ROTATED })).status,
      ).toBe(200);
      await completed(await start(processId, '輪替後'));

      expect(stub.received.map((r) => r.headers.authorization)).toEqual([
        `Bearer ${SECRET}`,
        `Bearer ${ROTATED}`,
      ]);
      // 還原，其他測試沿用原本的秘密。
      await keeper.put(`/api/credentials/${erp?.id}/secret`, { secret: SECRET });
    });

    it('重試全部失敗：Request 暫停並通知 Administrator；修好後 Administrator 重試，Request 繼續完成', async () => {
      stub.status = 503;
      const processId = await publish(
        '出差－ERP 故障',
        withHttp({ url: `${stub.url}/flaky`, credential: 'erp' }),
      );
      const id = await start(processId, 'ERP 故障中的出差');

      const stuck = await paused(id);
      expect(stuck.status).toBe('running');
      expect(stuck.paused).toMatchObject({ nodeId: 'erp', nodeName: '建立 ERP 單據' });
      expect(stuck.paused?.reason).toContain('503');
      // activity 帶重試：暫停前呼叫了不只一次。
      expect(stub.received.length).toBeGreaterThan(1);
      const attempts = stub.received.length;
      const failed = stuck.events.find((e) => e.type === 'step.http_failed');
      expect(failed?.node?.name).toBe('建立 ERP 單據');

      const mail = await eventually(
        () => app.emails.sent.filter((m) => m.to === 'admin@river.test'),
        (list) => list.some((m) => m.subject.includes('ERP 故障中的出差')),
      );
      const notice = mail.find((m) => m.subject.includes('ERP 故障中的出差'));
      expect(notice?.text).not.toContain(SECRET);
      expect(notice?.text).toContain('/admin/reassign');

      // Administrator 的清單也看得到暫停。
      const active = (await (await admin.get('/api/requests/active')).json()) as RequestSummary[];
      expect(active.find((r) => r.id === id)?.paused?.nodeName).toBe('建立 ERP 單據');

      // 沒有 request.cancel 不能重試；沒有暫停的 Request 不能重試。
      expect((await employee.post(`/api/requests/${id}/retry`)).status).toBe(403);
      expect((await designer.post(`/api/requests/${id}/retry`)).status).toBe(403);

      stub.status = 200;
      const res = await admin.post(`/api/requests/${id}/retry`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as RequestSummary).paused).toBeNull();
      const done = await completed(id);
      expect(stub.received.length).toBe(attempts + 1);
      expect(
        done.events
          .map((e) => e.type)
          .filter((t) => t.startsWith('step.http') || t === 'request.retried'),
      ).toEqual(['step.http_failed', 'request.retried', 'step.http_sent']);
      expect(done.events.find((e) => e.type === 'request.retried')?.actor?.name).toBe('系統管理員');
      expect((await admin.post(`/api/requests/${id}/retry`)).status).toBe(409);

      const history = historyText(await app.temporal.workflow.getHandle(id).fetchHistory());
      expect(history).not.toContain(SECRET);
    });

    it('暫停中的 Request 可以 Cancel', async () => {
      stub.status = 500;
      const processId = await publish(
        '出差－ERP 停機',
        withHttp({ url: `${stub.url}/down`, credential: 'erp' }),
      );
      const id = await start(processId, 'ERP 停機中的出差');
      await paused(id);

      const res = await admin.post(`/api/requests/${id}/cancel`, { comment: 'ERP 停機，改走人工' });
      expect(res.status).toBe(200);
      const cancelled = await eventually(
        () => detail(id),
        (d) => d.status === 'cancelled',
      );
      expect(cancelled.paused).toBeNull();
      await eventually(
        async () => (await app.temporal.workflow.getHandle(id).describe()).status.name,
        (s) => s === 'COMPLETED',
      );
    });

    it('找不到 Credential 時不重試，直接暫停；建立 Credential 後重試就成功', async () => {
      const processId = await publish(
        '出差－還沒有 Credential',
        withHttp({ url: `${stub.url}/later`, credential: 'later' }),
      );
      const id = await start(processId, '等 Credential 的出差');
      const stuck = await paused(id);
      expect(stuck.paused?.reason).toContain('later');
      expect(stub.received).toHaveLength(0);

      await createCredential({ name: 'later', scheme: 'bearer', secret: 'late-secret' });
      expect((await admin.post(`/api/requests/${id}/retry`)).status).toBe(200);
      await completed(id);
      expect(stub.received.map((r) => r.headers.authorization)).toEqual(['Bearer late-secret']);
    });

    it('Service Account 沒有代表任何人發起（沒有發起人）時一樣組出 body；失敗時暫停、通知 Administrator，重試後完成', async () => {
      const processId = await publish(
        '出差－外部系統發起',
        withHttp({ url: `${stub.url}/external`, credential: 'erp' }),
      );
      const issued = await admin.post('/api/service-accounts', {
        name: '差旅系統',
        processIds: [processId],
      });
      expect(issued.status).toBe(201);
      const external = app.anonymous.withApiKey(((await issued.json()) as IssuedApiKey).apiKey);
      const view = async (id: string) =>
        (await (await admin.get(`/api/requests/${id}`)).json()) as RequestDetail;

      stub.status = 502;
      const res = await external.post('/api/external/requests', {
        processId,
        title: '外部發起的出差',
        data: { destination: '高雄', amount: 4321 },
      });
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };

      const stuck = await eventually(
        async () => {
          await app.skipTime('30 seconds');
          return view(id);
        },
        (d) => d.paused !== null,
      );
      expect(stuck.initiator.type).toBe('service_account');
      await eventually(
        () => app.emails.sent.filter((m) => m.to === 'admin@river.test'),
        (list) => list.some((m) => m.subject.includes('外部發起的出差')),
      );

      stub.status = 200;
      expect((await admin.post(`/api/requests/${id}/retry`)).status).toBe(200);
      await eventually(
        () => view(id),
        (d) => d.status === 'completed',
      );
      const last = stub.received.at(-1);
      expect(last?.headers.authorization).toBe(`Bearer ${SECRET}`);
      expect(JSON.parse(last?.body ?? '')).toEqual({ destination: '高雄', amount: 4321 });
    });

    it('HTTP 節點沒有 URL、URL 不正確或 body 語法錯誤時不能發佈', async () => {
      for (const [http, code] of [
        [{ url: ' ' }, 'HTTP_NO_URL'],
        [{ url: 'erp.internal/api' }, 'HTTP_INVALID_URL'],
        [{ url: 'https://erp.internal/api', body: '{ "a": ' }, 'INVALID_JSONATA'],
      ] as const) {
        const created = (await (
          await designer.post('/api/processes', { name: `HTTP 檢查 ${code}` })
        ).json()) as Process;
        await designer.put(`/api/processes/${created.id}/draft`, { dsl: withHttp(http) });
        const res = await designer.post(`/api/processes/${created.id}/versions`, {});
        expect(res.status).toBe(422);
        expect(
          ((await res.json()) as PublishRejected).errors.map((e) => [e.code, e.nodeId]),
        ).toEqual([[code, 'erp']]);
      }
    });
  });
});
