import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './harness.js';

describe('健康檢查', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startTestApp();
    await app.provisionParticipant({
      email: 'someone@river.test',
      name: '陳小華',
      password: 'correct horse battery staple',
      permissions: [],
    });
  });
  afterAll(() => app?.close());

  it('api 與 Postgres 可以連線', async () => {
    const res = await app.anonymous.get('/api/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('api 可以透過 Temporal 讓 worker 執行 workflow 並存取 Postgres', async () => {
    const session = await app.signIn('someone@river.test', 'correct horse battery staple');

    const res = await session.get('/api/health/temporal');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
