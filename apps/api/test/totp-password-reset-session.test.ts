import { TOTP_REQUIRED_ERROR_CODE } from '@river/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ApiClient,
  resetPasswordToken,
  startTestApp,
  type TestApp,
  totpCode,
} from './harness.js';

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a brand new passphrase 2026';

describe('TOTP、重設密碼與 session 撤銷', () => {
  let app: TestApp;
  let admin: ApiClient;

  beforeAll(async () => {
    app = await startTestApp();
    // Administrator 持有 user.manage；harness 替持有敏感 Permission 的帳號預先啟用 TOTP。
    await app.provisionParticipant({
      email: 'admin@river.test',
      name: '王小明',
      password: PASSWORD,
      permissions: ['user.manage'],
    });
    admin = await app.signIn('admin@river.test', PASSWORD);
  });
  afterAll(() => app?.close());

  describe('自行啟用 TOTP', () => {
    it('Participant 可以自行啟用 TOTP，之後登入要輸入驗證碼', async () => {
      await app.provisionParticipant({
        email: 'optional@river.test',
        name: '陳小華',
        password: PASSWORD,
        permissions: [],
      });
      const session = await app.signIn('optional@river.test', PASSWORD);
      expect(await (await session.get('/api/me')).json()).toMatchObject({
        twoFactorEnabled: false,
      });

      // 密碼錯誤不能啟用。
      expect(
        (await session.post('/api/auth/two-factor/enable', { password: 'wrong password!!' }))
          .status,
      ).toBe(400);

      const enable = await session.post('/api/auth/two-factor/enable', { password: PASSWORD });
      expect(enable.status).toBe(200);
      const { totpURI, backupCodes } = (await enable.json()) as {
        totpURI: string;
        backupCodes: string[];
      };
      expect(totpURI).toMatch(/^otpauth:\/\/totp\//);
      expect(backupCodes.length).toBeGreaterThan(0);

      // 還沒輸入驗證碼確認前不算啟用。
      expect(await (await session.get('/api/me')).json()).toMatchObject({
        twoFactorEnabled: false,
      });
      expect(
        (await session.post('/api/auth/two-factor/verify-totp', { code: '000000' })).status,
      ).toBe(401);

      const verify = await session.post('/api/auth/two-factor/verify-totp', {
        code: totpCode(totpURI),
      });
      expect(verify.status).toBe(200);
      const enrolled = session.withSetCookie(verify);
      expect(await (await enrolled.get('/api/me')).json()).toMatchObject({
        twoFactorEnabled: true,
      });

      // 再次登入：密碼正確後還要驗證碼，這時還沒有 session。
      const signIn = await app.anonymous.post('/api/auth/sign-in/email', {
        email: 'optional@river.test',
        password: PASSWORD,
      });
      expect(await signIn.json()).toMatchObject({ twoFactorRedirect: true });
      const challenge = app.anonymous.withSetCookie(signIn);
      expect((await challenge.get('/api/me')).status).toBe(401);

      expect(
        (await challenge.post('/api/auth/two-factor/verify-totp', { code: '000000' })).status,
      ).toBe(401);
      const passed = await challenge.post('/api/auth/two-factor/verify-totp', {
        code: totpCode(totpURI),
      });
      expect(passed.status).toBe(200);
      expect((await challenge.withSetCookie(passed).get('/api/me')).status).toBe(200);

      // 手機不在身邊時可以改用備用碼，每組只能用一次。
      const again = await app.anonymous.post('/api/auth/sign-in/email', {
        email: 'optional@river.test',
        password: PASSWORD,
      });
      const backup = await app.anonymous
        .withSetCookie(again)
        .post('/api/auth/two-factor/verify-backup-code', { code: backupCodes[0] });
      expect(backup.status).toBe(200);
    });
  });

  describe('敏感 Permission 需要 TOTP', () => {
    it.each([
      ['credential.manage', '/api/credentials'],
      ['user.manage', '/api/participants'],
      ['process.publish', '/api/processes'],
    ] as const)(
      '持有 %s 但還沒啟用 TOTP 時，%s 回 403 TOTP_REQUIRED；啟用後就能使用',
      async (permission, path) => {
        const email = `${permission.replace('.', '-')}@river.test`;
        await app.provisionParticipant({
          email,
          name: '林志豪',
          password: PASSWORD,
          permissions: [permission],
          totp: false,
        });
        const session = await app.signIn(email, PASSWORD);

        const me = await (await session.get('/api/me')).json();
        expect(me).toMatchObject({ permissions: [permission], twoFactorEnabled: false });

        const blocked = await session.get(path);
        expect(blocked.status).toBe(403);
        expect(await blocked.json()).toMatchObject({
          code: TOTP_REQUIRED_ERROR_CODE,
          message: expect.stringContaining('TOTP'),
        });

        const { client } = await app.enableTotp(session, PASSWORD);
        expect((await client.get(path)).status).toBe(200);
      },
    );

    it('不需要 TOTP 的 Permission 照常可用；沒有持有的 Permission 仍是一般的 403', async () => {
      await app.provisionParticipant({
        email: 'designer@river.test',
        name: '張雅婷',
        password: PASSWORD,
        permissions: ['process.edit', 'process.publish'],
        totp: false,
      });
      const session = await app.signIn('designer@river.test', PASSWORD);

      // process.edit 不需要 TOTP，列出 Process（edit 或 publish 任一個即可）照常可用。
      expect((await session.get('/api/processes')).status).toBe(200);
      const created = await session.post('/api/processes', { name: '請假申請' });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };

      // 發佈需要 process.publish，還沒啟用 TOTP。
      const publish = await session.post(`/api/processes/${id}/versions`);
      expect(publish.status).toBe(403);
      expect(await publish.json()).toMatchObject({ code: TOTP_REQUIRED_ERROR_CODE });

      // 完全沒有持有的 Permission：一般的 403，不會要求設定 TOTP。
      const credentials = await session.get('/api/credentials');
      expect(credentials.status).toBe(403);
      expect(await credentials.json()).not.toMatchObject({ code: TOTP_REQUIRED_ERROR_CODE });
    });

    it('停用 TOTP 後，下一次呼叫敏感 Permission 的 API 就會被擋下', async () => {
      await app.provisionParticipant({
        email: 'keeper@river.test',
        name: '黃建國',
        password: PASSWORD,
        permissions: ['credential.manage'],
      });
      const session = await app.signIn('keeper@river.test', PASSWORD);
      expect((await session.get('/api/credentials')).status).toBe(200);

      const disable = await session.post('/api/auth/two-factor/disable', { password: PASSWORD });
      expect(disable.status).toBe(200);
      const after = session.withSetCookie(disable);

      const blocked = await after.get('/api/credentials');
      expect(blocked.status).toBe(403);
      expect(await blocked.json()).toMatchObject({ code: TOTP_REQUIRED_ERROR_CODE });
    });
  });

  describe('重設密碼', () => {
    it('忘記密碼時可以收到重設信並設定新密碼；其他裝置的 session 會被登出', async () => {
      await app.provisionParticipant({
        email: 'forgetful@river.test',
        name: '李佩珊',
        password: PASSWORD,
        permissions: [],
      });
      const oldSession = await app.signIn('forgetful@river.test', PASSWORD);
      const before = app.emails.sent.length;

      const res = await app.anonymous.post('/api/auth/request-password-reset', {
        email: 'forgetful@river.test',
      });
      expect(res.status).toBe(200);

      const mail = app.emails.sent.slice(before).find((m) => m.to === 'forgetful@river.test');
      expect(mail?.subject).toContain('重設密碼');
      const token = resetPasswordToken(mail);

      // 太短的密碼不接受，token 也不會因此失效。
      expect(
        (await app.anonymous.post('/api/auth/reset-password', { newPassword: 'short', token }))
          .status,
      ).toBe(400);
      const reset = await app.anonymous.post('/api/auth/reset-password', {
        newPassword: NEW_PASSWORD,
        token,
      });
      expect(reset.status).toBe(200);

      await expect(app.signIn('forgetful@river.test', PASSWORD)).rejects.toThrow(/401/);
      expect(
        (await (await app.signIn('forgetful@river.test', NEW_PASSWORD)).get('/api/me')).status,
      ).toBe(200);
      expect((await oldSession.get('/api/me')).status).toBe(401);

      // 連結只能用一次。
      expect(
        (await app.anonymous.post('/api/auth/reset-password', { newPassword: NEW_PASSWORD, token }))
          .status,
      ).toBe(400);
    });

    it('不存在或已停用的帳號不會收到重設信，回應也看不出差別', async () => {
      const { participantId: id } = await app.provisionParticipant({
        email: 'leaver@river.test',
        name: '周俊傑',
        password: PASSWORD,
        permissions: [],
      });
      expect((await admin.post(`/api/participants/${id}/deactivate`)).status).toBe(200);
      const before = app.emails.sent.length;

      for (const email of ['nobody@river.test', 'leaver@river.test']) {
        const res = await app.anonymous.post('/api/auth/request-password-reset', { email });
        expect(res.status).toBe(200);
      }
      expect(app.emails.sent.slice(before)).toEqual([]);
    });
  });

  describe('Permission 撤銷立即生效', () => {
    it('Permission 被撤銷後，下一次呼叫 API 就會失敗，不需要重新登入', async () => {
      const { participantId: id } = await app.provisionParticipant({
        email: 'demoted@river.test',
        name: '吳淑芬',
        password: PASSWORD,
        permissions: ['process.edit', 'role.manage'],
      });
      const session = await app.signIn('demoted@river.test', PASSWORD);
      expect((await session.get('/api/roles')).status).toBe(200);
      expect((await session.get('/api/processes')).status).toBe(200);

      const res = await admin.put(`/api/participants/${id}/permissions`, {
        permissions: ['process.edit'],
      });
      expect(res.status).toBe(200);

      // 同一個 session：被撤銷的 role.manage 立刻失效，保留的 process.edit 照常可用。
      expect((await session.get('/api/roles')).status).toBe(403);
      expect((await session.get('/api/processes')).status).toBe(200);
      expect(await (await session.get('/api/me')).json()).toMatchObject({
        permissions: ['process.edit'],
      });
    });
  });
});
