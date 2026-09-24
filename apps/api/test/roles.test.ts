import { PERMISSION_PRESETS } from '@river/auth';
import type { Participant, Role } from '@river/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiClient, startTestApp, type TestApp } from './harness.js';

const PASSWORD = 'correct horse battery staple';

describe('Role 管理', () => {
  let app: TestApp;
  let admin: ApiClient;
  let memberId: string;
  let otherId: string;

  beforeAll(async () => {
    app = await startTestApp();
    await app.provisionParticipant({
      email: 'admin@river.test',
      name: '林雅婷',
      password: PASSWORD,
      permissions: PERMISSION_PRESETS.administrator,
    });
    ({ participantId: memberId } = await app.provisionParticipant({
      email: 'yijun.wang@river.test',
      name: '王怡君',
      password: PASSWORD,
      permissions: [],
    }));
    ({ participantId: otherId } = await app.provisionParticipant({
      email: 'shufen.wu@river.test',
      name: '吳淑芬',
      password: PASSWORD,
      permissions: [],
    }));
    admin = await app.signIn('admin@river.test', PASSWORD);
  });
  afterAll(() => app?.close());

  async function createRole(name: string): Promise<Role> {
    const res = await admin.post('/api/roles', { name });
    expect(res.status).toBe(201);
    return (await res.json()) as Role;
  }

  async function findRole(id: string): Promise<Role | undefined> {
    const roles = (await (await admin.get('/api/roles')).json()) as Role[];
    return roles.find((r) => r.id === id);
  }

  it('Administrator 可以建立 Role 並改名', async () => {
    const role = await createRole('財務審批');
    expect(role).toEqual({ id: expect.any(String), name: '財務審批', members: [] });

    const renamed = await admin.patch(`/api/roles/${role.id}`, { name: '財務審批人' });
    expect(renamed.status).toBe(200);
    expect(await findRole(role.id)).toMatchObject({ name: '財務審批人' });
  });

  it('Role 名稱不能重複', async () => {
    await createRole('HR');

    expect((await admin.post('/api/roles', { name: 'HR' })).status).toBe(409);
    const other = await createRole('人資');
    expect((await admin.patch(`/api/roles/${other.id}`, { name: 'HR' })).status).toBe(409);
  });

  it('Role 名稱不能空白', async () => {
    expect((await admin.post('/api/roles', { name: '   ' })).status).toBe(400);
  });

  it('可以新增與移除成員', async () => {
    const role = await createRole('部門助理');

    expect((await admin.put(`/api/roles/${role.id}/members/${memberId}`)).status).toBe(204);
    expect((await admin.put(`/api/roles/${role.id}/members/${otherId}`)).status).toBe(204);
    // 依加入的先後排列。
    expect((await findRole(role.id))?.members).toEqual([
      { id: memberId, name: '王怡君', email: 'yijun.wang@river.test', status: 'active' },
      { id: otherId, name: '吳淑芬', email: 'shufen.wu@river.test', status: 'active' },
    ]);

    expect((await admin.delete(`/api/roles/${role.id}/members/${memberId}`)).status).toBe(204);
    expect((await findRole(role.id))?.members.map((m) => m.id)).toEqual([otherId]);
  });

  it('重複加入同一位成員不會出錯', async () => {
    const role = await createRole('IT 支援');
    await admin.put(`/api/roles/${role.id}/members/${memberId}`);

    expect((await admin.put(`/api/roles/${role.id}/members/${memberId}`)).status).toBe(204);
    expect((await findRole(role.id))?.members).toHaveLength(1);
  });

  it('人員清單會列出每個人所屬的 Role', async () => {
    const role = await createRole('採購');
    await admin.put(`/api/roles/${role.id}/members/${otherId}`);

    const people = (await (await admin.get('/api/participants')).json()) as Participant[];
    expect(people.find((p) => p.id === otherId)?.roleIds).toContain(role.id);
  });

  it('不存在的 Role 或 Participant 回 404', async () => {
    const role = await createRole('法務');
    const missing = '00000000-0000-0000-0000-000000000000';

    expect((await admin.put(`/api/roles/${missing}/members/${memberId}`)).status).toBe(404);
    expect((await admin.put(`/api/roles/${role.id}/members/${missing}`)).status).toBe(404);
    expect((await admin.patch(`/api/roles/${missing}`, { name: '不存在' })).status).toBe(404);
  });
});
