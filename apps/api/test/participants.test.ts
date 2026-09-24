import { PERMISSION_PRESETS } from '@river/auth';
import type { MeResponse, Participant } from '@river/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiClient, invitationToken, startTestApp, type TestApp } from './harness.js';

const PASSWORD = 'correct horse battery staple';

async function me(session: ApiClient): Promise<MeResponse> {
  return (await (await session.get('/api/me')).json()) as MeResponse;
}

describe('Participant 管理', () => {
  let app: TestApp;
  let admin: ApiClient;
  let adminId: string;

  beforeAll(async () => {
    app = await startTestApp();
    ({ participantId: adminId } = await app.provisionParticipant({
      email: 'admin@river.test',
      name: '林雅婷',
      password: PASSWORD,
      permissions: PERMISSION_PRESETS.administrator,
    }));
    admin = await app.signIn('admin@river.test', PASSWORD);
  });
  afterAll(() => app?.close());

  async function create(body: Record<string, unknown>): Promise<Participant> {
    const res = await admin.post('/api/participants', body);
    expect(res.status).toBe(201);
    return (await res.json()) as Participant;
  }

  async function list(): Promise<Participant[]> {
    const res = await admin.get('/api/participants');
    expect(res.status).toBe(200);
    return (await res.json()) as Participant[];
  }

  it('Administrator 建立 Participant 後，對方收到邀請信，設定密碼後就能登入', async () => {
    const created = await create({
      name: '劉冠廷',
      email: 'Guanting.Liu@river.test',
      permissions: PERMISSION_PRESETS.designer,
    });
    expect(created).toMatchObject({
      name: '劉冠廷',
      email: 'guanting.liu@river.test',
      status: 'invited',
      permissions: [...PERMISSION_PRESETS.designer].sort(),
    });

    const email = app.emails.lastTo('guanting.liu@river.test');
    expect(email?.subject).toBe('你已受邀加入 River');
    expect(email?.text).toContain('林雅婷');
    const token = invitationToken(email);

    const invitation = await app.anonymous.get(`/api/invitations/${token}`);
    expect(invitation.status).toBe(200);
    expect(await invitation.json()).toEqual({ name: '劉冠廷', email: 'guanting.liu@river.test' });

    const reset = await app.anonymous.post('/api/auth/reset-password', {
      token,
      newPassword: PASSWORD,
    });
    expect(reset.status).toBe(200);

    const session = await app.signIn('guanting.liu@river.test', PASSWORD);
    expect(await me(session)).toMatchObject({
      name: '劉冠廷',
      permissions: [...PERMISSION_PRESETS.designer].sort(),
    });

    const after = (await list()).find((p) => p.id === created.id);
    expect(after?.status).toBe('active');
  });

  it('還沒設定密碼的 Participant 不能登入', async () => {
    await create({ name: '許雅雯', email: 'yawen.hsu@river.test' });

    await expect(app.signIn('yawen.hsu@river.test', PASSWORD)).rejects.toThrow(/401/);
  });

  it('邀請連結只能使用一次', async () => {
    await create({ name: '蔡宜蓁', email: 'yizhen.tsai@river.test' });
    const token = invitationToken(app.emails.lastTo('yizhen.tsai@river.test'));
    await app.anonymous.post('/api/auth/reset-password', { token, newPassword: PASSWORD });

    expect((await app.anonymous.get(`/api/invitations/${token}`)).status).toBe(404);
    const again = await app.anonymous.post('/api/auth/reset-password', {
      token,
      newPassword: 'another password 1234',
    });
    expect(again.ok).toBe(false);
  });

  it('不存在的邀請連結回 404', async () => {
    expect((await app.anonymous.get('/api/invitations/not-a-real-token')).status).toBe(404);
  });

  it('重寄邀請信後，舊的連結失效、新的連結可以使用', async () => {
    const p = await create({ name: '楊承恩', email: 'chengen.yang@river.test' });
    const oldToken = invitationToken(app.emails.lastTo('chengen.yang@river.test'));

    const res = await admin.post(`/api/participants/${p.id}/invitation`);
    expect(res.status).toBe(204);
    const newToken = invitationToken(app.emails.lastTo('chengen.yang@river.test'));

    expect(newToken).not.toBe(oldToken);
    expect((await app.anonymous.get(`/api/invitations/${oldToken}`)).status).toBe(404);
    expect((await app.anonymous.get(`/api/invitations/${newToken}`)).status).toBe(200);
  });

  it('已經設定密碼的 Participant 不能重寄邀請信', async () => {
    const res = await admin.post(`/api/participants/${adminId}/invitation`);

    expect(res.status).toBe(409);
  });

  it('email 已經被使用時不能建立', async () => {
    const res = await admin.post('/api/participants', { name: '重複', email: 'ADMIN@river.test' });

    expect(res.status).toBe(409);
  });

  it('email 格式錯誤或 Permission 不在清單中時回 400', async () => {
    expect((await admin.post('/api/participants', { name: '甲', email: 'nope' })).status).toBe(400);
    expect(
      (
        await admin.post('/api/participants', {
          name: '乙',
          email: 'b@river.test',
          permissions: ['process.delete'],
        })
      ).status,
    ).toBe(400);
  });

  it('可以在建立時與之後設定 Manager', async () => {
    const manager = await create({ name: '王怡君', email: 'yijun.wang@river.test' });
    const p = await create({
      name: '張家豪',
      email: 'jiahao.chang@river.test',
      managerId: manager.id,
    });
    expect(p.managerId).toBe(manager.id);

    const res = await admin.patch(`/api/participants/${p.id}`, { managerId: adminId });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Participant).managerId).toBe(adminId);

    const cleared = await admin.patch(`/api/participants/${p.id}`, { managerId: null });
    expect(((await cleared.json()) as Participant).managerId).toBeNull();
  });

  it('Manager 不能是自己，也不能形成循環', async () => {
    const a = await create({ name: '甲主管', email: 'a.manager@river.test' });
    const b = await create({ name: '乙員工', email: 'b.staff@river.test', managerId: a.id });

    expect((await admin.patch(`/api/participants/${a.id}`, { managerId: a.id })).status).toBe(400);
    expect((await admin.patch(`/api/participants/${a.id}`, { managerId: b.id })).status).toBe(400);
  });

  it('不存在的 Manager 回 400', async () => {
    const res = await admin.post('/api/participants', {
      name: '丙',
      email: 'c@river.test',
      managerId: '00000000-0000-0000-0000-000000000000',
    });

    expect(res.status).toBe(400);
  });

  it('授予與撤銷 Permission 後，對方下次取得自己的資料時就會反映', async () => {
    const p = await create({ name: '黃建宏', email: 'jianhong.huang@river.test' });
    await app.anonymous.post('/api/auth/reset-password', {
      token: invitationToken(app.emails.lastTo('jianhong.huang@river.test')),
      newPassword: PASSWORD,
    });
    const session = await app.signIn('jianhong.huang@river.test', PASSWORD);

    const granted = await admin.put(`/api/participants/${p.id}/permissions`, {
      permissions: ['credential.manage', 'process.edit'],
    });
    expect(granted.status).toBe(200);
    expect((await me(session)).permissions).toEqual(['credential.manage', 'process.edit']);

    await admin.put(`/api/participants/${p.id}/permissions`, { permissions: ['process.edit'] });
    expect((await me(session)).permissions).toEqual(['process.edit']);
  });

  it('Administrator 不能撤銷自己的 user.manage', async () => {
    const res = await admin.put(`/api/participants/${adminId}/permissions`, {
      permissions: ['role.manage'],
    });

    expect(res.status).toBe(409);
    expect((await me(admin)).permissions).toContain('user.manage');
  });

  it('不存在的 Participant 回 404', async () => {
    const res = await admin.put(
      '/api/participants/00000000-0000-0000-0000-000000000000/permissions',
      {
        permissions: [],
      },
    );

    expect(res.status).toBe(404);
  });
});
