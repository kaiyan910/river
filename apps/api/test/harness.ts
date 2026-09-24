import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { connectDatabase, type Database, migrateDatabase } from '@river/db';
import { createWorker } from '@river/worker';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, makeTelemetryFilterString, Runtime } from '@temporalio/worker';
import pg from 'pg';
import { inject } from 'vitest';
import { createAuth } from '../src/auth/create-auth.js';
import { createApp } from '../src/create-app.js';
import {
  type ProvisionParticipantInput,
  provisionParticipant,
} from '../src/participants/provision-participant.js';

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
  ) {}

  get(path: string): Promise<Response> {
    return this.request('GET', path);
  }

  post(path: string, body: unknown): Promise<Response> {
    return this.request('POST', path, body);
  }

  private request(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { origin: ORIGIN };
    if (this.cookie) headers.cookie = this.cookie.split(';')[0] ?? '';
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
  provisionParticipant(input: ProvisionParticipantInput): Promise<{ participantId: string }>;
  /** 用 email + 密碼登入，回傳帶著 session cookie 的 client；失敗時丟出錯誤。 */
  signIn(email: string, password: string): Promise<ApiClient>;
  close(): Promise<void>;
}

/**
 * Seam ①：真實的 Postgres（Testcontainers，每個測試檔一個獨立 database）、
 * Temporal TestWorkflowEnvironment（time skipping）與真實的 worker，外加完整的 Nest app。
 */
export async function startTestApp(): Promise<TestApp> {
  const { url: databaseUrl, drop: dropDatabase } = await createIsolatedDatabase(
    inject('postgresUrl'),
  );
  const database = connectDatabase(databaseUrl);
  await migrateDatabase(database.db);

  const temporal = await TestWorkflowEnvironment.createTimeSkipping();
  const worker = await createWorker({
    connection: temporal.nativeConnection,
    namespace: temporal.namespace ?? 'default',
    taskQueue: TASK_QUEUE,
    db: database.db,
  });
  const workerRun = worker.run();

  const auth = createAuth(database.db, {
    secret: 'test-secret-that-is-at-least-32-characters',
    baseURL: ORIGIN,
  });
  const app: INestApplication = await createApp({
    db: database.db,
    auth,
    temporal: temporal.client,
    taskQueue: TASK_QUEUE,
    logLevel: 'silent',
  });
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();
  const anonymous = new ApiClient(baseUrl);

  return {
    db: database.db,
    anonymous,
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
