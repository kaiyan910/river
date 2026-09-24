import { PERMISSION_PRESETS } from '@river/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './harness.js';

describe('取得自己的資料', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startTestApp();
    await app.provisionParticipant({
      email: 'admin@river.test',
      name: '王小明',
      password: 'correct horse battery staple',
      permissions: PERMISSION_PRESETS.administrator,
    });
  });
  afterAll(() => app?.close());

  it('Administrator 登入後可以取得自己的資料與 Permission', async () => {
    const session = await app.signIn('admin@river.test', 'correct horse battery staple');

    const res = await session.get('/api/me');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: expect.any(String),
      name: '王小明',
      email: 'admin@river.test',
      permissions: [...PERMISSION_PRESETS.administrator].sort(),
    });
  });

  it('session cookie 是 httpOnly 且 SameSite=Lax', async () => {
    const session = await app.signIn('admin@river.test', 'correct horse battery staple');

    expect(session.cookie).toMatch(/HttpOnly/i);
    expect(session.cookie).toMatch(/SameSite=Lax/i);
  });

  it('密碼錯誤無法登入', async () => {
    await expect(app.signIn('admin@river.test', 'wrong password')).rejects.toThrow(/401/);
  });

  it('未登入時取得自己的資料會回 401', async () => {
    const res = await app.anonymous.get('/api/me');

    expect(res.status).toBe(401);
  });

  it('不能自行註冊帳號', async () => {
    const res = await app.anonymous.post('/api/auth/sign-up/email', {
      email: 'someone@river.test',
      name: '路人',
      password: 'correct horse battery staple',
    });

    expect(res.ok).toBe(false);
  });
});
