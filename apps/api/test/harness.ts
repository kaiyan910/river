import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { connectDatabase, createCredentialCipher, type Database, migrateDatabase } from '@river/db';
import { RecordingEmailSender } from '@river/email';
import { createWorker } from '@river/worker';
import type { Client } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, makeTelemetryFilterString, Runtime } from '@temporalio/worker';
import pg from 'pg';
import { inject } from 'vitest';
import { S3AttachmentStorage } from '../src/attachment/attachment-storage.js';
import { createAuth } from '../src/auth/create-auth.js';
import { createApp } from '../src/create-app.js';
import {
  type ProvisionParticipantInput,
  provisionParticipant,
} from '../src/org/provision-participant.js';

/** 測試裡瀏覽器所在的 origin；Better Auth 只信任這個 origin 送來的請求。 */
const ORIGIN = 'http://river.test';
const TASK_QUEUE = 'river-test';

// 測試輸出只保留 Temporal 的錯誤。每個測試檔跑在自己的 process，這裡只會執行一次。
Runtime.install({
  logger: new DefaultLogger('ERROR'),
  telemetryOptions: { logging: { filter: makeTelemetryFilterString({ core: 'ERROR' }) } },
});

/** 以某個身分呼叫 HTTP API 的 client。 */
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    /** 登入後拿到的 session cookie（原始 Set-Cookie 內容）；匿名時為 undefined。 */
    readonly cookie?: string,
    /** Service Account 的 API key；外部 API 以 `Authorization: Bearer <key>` 驗證。 */
    private readonly apiKey?: string,
  ) {}

  /** 以 Service Account 的 API key 呼叫的 client（不帶 session cookie）。 */
  withApiKey(apiKey: string): ApiClient {
    return new ApiClient(this.baseUrl, undefined, apiKey);
  }

  get(path: string): Promise<Response> {
    return this.request('GET', path);
  }

  post(path: string, body?: unknown): Promise<Response> {
    return this.request('POST', path, body);
  }

  patch(path: string, body: unknown): Promise<Response> {
    return this.request('PATCH', path, body);
  }

  put(path: string, body?: unknown): Promise<Response> {
    return this.request('PUT', path, body);
  }

  delete(path: string): Promise<Response> {
    return this.request('DELETE', path);
  }

  private request(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { origin: ORIGIN };
    if (this.cookie) headers.cookie = this.cookie.split(';')[0] ?? '';
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    return fetch(new URL(path, this.baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}

export interface TestApp {
  db: Database;
  anonymous: ApiClient;
  /** 取代 SMTP / Resend 的 fake，記錄 api 與 worker 寄出的每一封信。 */
  emails: RecordingEmailSender;
  /** 直接對 Temporal 送 Signal，模擬 API 重試或重複送出。 */
  temporal: Client;
  /** 快轉 Temporal 的時間（time skipping），讓 Reminder、Escalation 等 durable timer 到期。 */
  skipTime(duration: Parameters<TestWorkflowEnvironment['sleep']>[0]): Promise<void>;
  provisionParticipant(input: ProvisionParticipantInput): Promise<{ participantId: string }>;
  /** 用 email + 密碼登入，回傳帶著 session cookie 的 client；失敗時丟出錯誤。 */
  signIn(email: string, password: string): Promise<ApiClient>;
  close(): Promise<void>;
}

export interface TestAppOptions {
  /**
   * Temporal 測試環境：預設是 time skipping（可以快轉 durable timer）；
   * time skipping 的測試 server 不支援 Temporal Schedule，排程發起的測試改用 local（Temporal CLI 的 dev server，沒有快轉）。
   */
  temporal?: 'time-skipping' | 'local';
}

/**
 * Seam ①：真實的 Postgres（Testcontainers，每個測試檔一個獨立 database）、真實的 Garage（附件）、
 * Temporal TestWorkflowEnvironment（time skipping）與真實的 worker，外加完整的 Nest app。
 */
export async function startTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const { url: databaseUrl, drop: dropDatabase } = await createIsolatedDatabase(
    inject('postgresUrl'),
  );
  const database = connectDatabase(databaseUrl);
  await migrateDatabase(database.db);

  const emails = new RecordingEmailSender();
  // api 加密、worker 解密 Credential 用同一把金鑰；每個測試檔各自產生。
  const credentialCipher = createCredentialCipher(randomBytes(32).toString('base64'));
  const temporal =
    options.temporal === 'local'
      ? // dev server 的 log 只會干擾測試輸出（關閉時還會印出一串 shard 錯誤），全部關掉。
        await TestWorkflowEnvironment.createLocal({
          server: { log: { format: 'pretty', level: 'never' } },
        })
      : await TestWorkflowEnvironment.createTimeSkipping();
  const worker = await createWorker({
    connection: temporal.nativeConnection,
    namespace: temporal.namespace ?? 'default',
    taskQueue: TASK_QUEUE,
    db: database.db,
    emailSender: emails,
    appUrl: ORIGIN,
    credentialCipher,
  });
  const workerRun = worker.run();

  const auth = createAuth(database.db, {
    secret: 'test-secret-that-is-at-least-32-characters',
    baseURL: ORIGIN,
  });
  const app: INestApplication = await createApp({
    db: database.db,
    auth,
    emailSender: emails,
    appUrl: ORIGIN,
    storage: new S3AttachmentStorage(inject('s3')),
    temporal: temporal.client,
    taskQueue: TASK_QUEUE,
    log: { LOG_LEVEL: 'silent', LOG_FORMAT: 'json' },
    credentialCipher,
  });
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();
  const anonymous = new ApiClient(baseUrl);

  return {
    db: database.db,
    anonymous,
    emails,
    temporal: temporal.client,
    skipTime: (duration) => temporal.sleep(duration),
    provisionParticipant: (input) => provisionParticipant(auth, database.db, input),
    async signIn(email, password) {
      const res = await anonymous.post('/api/auth/sign-in/email', { email, password });
      if (!res.ok) throw new Error(`登入失敗：${res.status} ${await res.text()}`);
      const cookie = res.headers.getSetCookie().find((c) => c.includes('session_token='));
      if (!cookie) throw new Error('登入回應沒有 session cookie');
      return new ApiClient(baseUrl, cookie);
    },
    async close() {
      await app.close();
      worker.shutdown();
      await workerRun;
      await temporal.teardown();
      await database.close();
      await dropDatabase();
    },
  };
}

async function createIsolatedDatabase(serverUrl: string) {
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    async drop() {
      const client = new pg.Client({ connectionString: serverUrl });
      await client.connect();
      await client.query(`drop database if exists ${name} with (force)`);
      await client.end();
    },
  };
}

/** 從邀請信中取出設定密碼連結裡的 token。 */
export function invitationToken(email: { text: string } | undefined): string {
  const token = email?.text.match(/\/invite\/([\w-]+)/)?.[1];
  if (!token) throw new Error(`信件裡沒有邀請連結：${email?.text}`);
  return token;
}
