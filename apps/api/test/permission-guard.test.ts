import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiClient, startTestApp, type TestApp } from './harness.js';

const PASSWORD = 'correct horse battery staple';
const SOME_ID = '00000000-0000-0000-0000-000000000000';

describe('Permission 檢查', () => {
  let app: TestApp;
  let participant: ApiClient;
  let roleManager: ApiClient;
  let userManager: ApiClient;

  beforeAll(async () => {
    app = await startTestApp();
    await app.provisionParticipant({
      email: 'someone@river.test',
      name: '陳小華',
      password: PASSWORD,
      permissions: ['process.edit', 'request.view_all'],
    });
    await app.provisionParticipant({
      email: 'roles@river.test',
      name: '李佩珊',
      password: PASSWORD,
      permissions: ['role.manage'],
    });
    await app.provisionParticipant({
      email: 'users@river.test',
      name: '王怡君',
      password: PASSWORD,
      permissions: ['user.manage'],
    });
    participant = await app.signIn('someone@river.test', PASSWORD);
    roleManager = await app.signIn('roles@river.test', PASSWORD);
    userManager = await app.signIn('users@river.test', PASSWORD);
  });
  afterAll(() => app?.close());

  it('沒有 user.manage 的人不能管理 Participant', async () => {
    const calls = [
      participant.get('/api/participants'),
      participant.post('/api/participants', { name: '甲', email: 'a@river.test' }),
      participant.patch(`/api/participants/${SOME_ID}`, { managerId: null }),
      participant.put(`/api/participants/${SOME_ID}/permissions`, { permissions: [] }),
      participant.post(`/api/participants/${SOME_ID}/invitation`),
    ];

    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    expect(app.emails.sent).toHaveLength(0);
  });

  it('沒有 role.manage 的人不能管理 Role', async () => {
    const calls = [
      participant.get('/api/roles'),
      participant.post('/api/roles', { name: '財務審批人' }),
      userManager.post('/api/roles', { name: '財務審批人' }),
      participant.patch(`/api/roles/${SOME_ID}`, { name: '改名' }),
      participant.put(`/api/roles/${SOME_ID}/members/${SOME_ID}`),
      participant.delete(`/api/roles/${SOME_ID}/members/${SOME_ID}`),
    ];

    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
  });

  it('持有 role.manage 的人可以讀取人員清單（挑選成員用），但不能建立 Participant', async () => {
    expect((await roleManager.get('/api/participants')).status).toBe(200);
    expect(
      (await roleManager.post('/api/participants', { name: '甲', email: 'a@river.test' })).status,
    ).toBe(403);
  });

  it('未登入時回 401', async () => {
    expect((await app.anonymous.get('/api/participants')).status).toBe(401);
    expect((await app.anonymous.get('/api/roles')).status).toBe(401);
  });
});
