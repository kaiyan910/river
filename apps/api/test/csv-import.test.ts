import { PERMISSION_PRESETS } from '@river/auth';
import type { ImportParticipantsResult, Participant } from '@river/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiClient, invitationToken, startTestApp, type TestApp } from './harness.js';

const PASSWORD = 'correct horse battery staple';

describe('CSV 匯入 Participant', () => {
  let app: TestApp;
  let admin: ApiClient;

  beforeAll(async () => {
    app = await startTestApp();
    await app.provisionParticipant({
      email: 'admin@river.test',
      name: '林雅婷',
      password: PASSWORD,
      permissions: PERMISSION_PRESETS.administrator,
    });
    admin = await app.signIn('admin@river.test', PASSWORD);
  });
  afterAll(() => app?.close());

  async function importCsv(csv: string): Promise<ImportParticipantsResult> {
    const res = await admin.post('/api/participants/import', { csv });
    expect(res.status).toBe(200);
    return (await res.json()) as ImportParticipantsResult;
  }

  async function people(): Promise<Participant[]> {
    return (await (await admin.get('/api/participants')).json()) as Participant[];
  }

  async function byEmail(email: string): Promise<Participant | undefined> {
    return (await people()).find((p) => p.email === email);
  }

  it('Manager 參照可以指向檔案中後面的行，也可以是現有的 Participant；每個人都收到邀請信', async () => {
    const existing = await admin.post('/api/participants', {
      name: '陳志明',
      email: 'zhiming.chen@river.test',
    });
    const ceo = (await existing.json()) as Participant;

    const result = await importCsv(
      [
        '姓名,email,Manager 的 email',
        '周佳穎,jiaying.chou@river.test,Minghui.Lee@river.test',
        '李明輝,minghui.lee@river.test,zhiming.chen@river.test',
        '吳宗翰,zonghan.wu@river.test,jiaying.chou@river.test',
        '鄭淑芬,shufen.cheng@river.test,',
      ].join('\n'),
    );

    expect(result.failed).toEqual([]);
    expect(result.imported.map((r) => [r.line, r.email])).toEqual([
      [2, 'jiaying.chou@river.test'],
      [3, 'minghui.lee@river.test'],
      [4, 'zonghan.wu@river.test'],
      [5, 'shufen.cheng@river.test'],
    ]);
    expect(result.imported.every((r) => r.invitationSent)).toBe(true);

    const lee = await byEmail('minghui.lee@river.test');
    const chou = await byEmail('jiaying.chou@river.test');
    const wu = await byEmail('zonghan.wu@river.test');
    const cheng = await byEmail('shufen.cheng@river.test');
    expect(lee).toMatchObject({ name: '李明輝', status: 'invited', managerId: ceo.id });
    expect(chou).toMatchObject({ name: '周佳穎', managerId: lee?.id, permissions: [] });
    expect(wu?.managerId).toBe(chou?.id);
    expect(cheng?.managerId).toBeNull();

    for (const email of [
      'jiaying.chou@river.test',
      'minghui.lee@river.test',
      'zonghan.wu@river.test',
      'shufen.cheng@river.test',
    ]) {
      expect(app.emails.lastTo(email)?.subject).toBe('你已受邀加入 River');
    }

    // 邀請信的連結可以用來設定密碼並登入。
    await app.anonymous.post('/api/auth/reset-password', {
      token: invitationToken(app.emails.lastTo('zonghan.wu@river.test')),
      newPassword: PASSWORD,
    });
    await expect(app.signIn('zonghan.wu@river.test', PASSWORD)).resolves.toBeDefined();
  });

  it('列出失敗的行號與原因；有錯誤的行不匯入，其他正確的行照常匯入', async () => {
    const gone = (await (
      await admin.post('/api/participants', { name: '離職者', email: 'gone@river.test' })
    ).json()) as Participant;
    expect((await admin.post(`/api/participants/${gone.id}/deactivate`)).status).toBe(200);

    const sentBefore = app.emails.sent.length;
    const result = await importCsv(
      [
        'name,email,manager_email',
        '王小明,xiaoming.wang@river.test,', // 2 正確
        '重複甲,dup@river.test,', // 3 檔案裡重複的 email
        '重複乙,DUP@river.test,', // 4 檔案裡重複的 email
        '已存在,admin@river.test,', // 5 email 已經有帳號
        '找不到主管,nomanager@river.test,nobody@river.test', // 6 Manager 不存在
        '循環甲,cycle.a@river.test,cycle.b@river.test', // 7 循環
        '循環乙,cycle.b@river.test,cycle.a@river.test', // 8 循環
        '自己,self@river.test,self@river.test', // 9 自己當自己的 Manager
        '接在循環下,under.cycle@river.test,cycle.a@river.test', // 10 Manager 那一行沒有匯入
        '壞 email,not-an-email,', // 11 格式錯誤
        ',noname@river.test,', // 12 格式錯誤：沒有姓名
        '欄位太少,short@river.test', // 13 格式錯誤：欄位數
        '主管壞掉,bad.manager@river.test,oops', // 14 格式錯誤：Manager email
        '主管已停用,under.gone@river.test,gone@river.test', // 15 Manager 已停用
        '"林, 美玲",meiling.lin@river.test,xiaoming.wang@river.test', // 16 正確（含逗號的姓名）
        '接在重複下,under.dup@river.test,dup@river.test', // 17 Manager 那一行沒有匯入
      ].join('\r\n'),
    );

    expect(result.imported.map((r) => r.line)).toEqual([2, 16]);
    expect(result.failed.map((f) => [f.line, f.code])).toEqual([
      [3, 'duplicate_email'],
      [4, 'duplicate_email'],
      [5, 'email_taken'],
      [6, 'manager_not_found'],
      [7, 'manager_cycle'],
      [8, 'manager_cycle'],
      [9, 'manager_cycle'],
      [10, 'manager_failed'],
      [11, 'invalid_format'],
      [12, 'invalid_format'],
      [13, 'invalid_format'],
      [14, 'invalid_format'],
      [15, 'manager_deactivated'],
      [17, 'manager_failed'],
    ]);
    for (const f of result.failed) expect(f.message).not.toBe('');
    expect(result.failed.find((f) => f.line === 3)?.message).toContain('4');
    expect(result.failed.find((f) => f.line === 10)?.message).toContain('7');

    const lin = await byEmail('meiling.lin@river.test');
    const wang = await byEmail('xiaoming.wang@river.test');
    expect(lin).toMatchObject({ name: '林, 美玲', managerId: wang?.id });

    // 失敗的行沒有建立帳號，也沒有收到邀請信。
    const emails = new Set((await people()).map((p) => p.email));
    for (const email of [
      'dup@river.test',
      'nomanager@river.test',
      'cycle.a@river.test',
      'cycle.b@river.test',
      'self@river.test',
      'under.cycle@river.test',
      'noname@river.test',
      'short@river.test',
      'bad.manager@river.test',
      'under.gone@river.test',
      'under.dup@river.test',
    ]) {
      expect(emails.has(email)).toBe(false);
    }
    expect(app.emails.sent.slice(sentBefore).map((m) => m.to)).toEqual([
      'xiaoming.wang@river.test',
      'meiling.lin@river.test',
    ]);
  });

  it('引號沒有結束時，從那一行起視為格式錯誤', async () => {
    const result = await importCsv(
      ['name,email,manager_email', '正確,ok.quote@river.test,', '"沒結束,x@river.test,'].join('\n'),
    );

    expect(result.imported.map((r) => r.line)).toEqual([2]);
    expect(result.failed.map((f) => [f.line, f.code])).toEqual([[3, 'invalid_format']]);
  });

  it('接受 Excel 存出的 BOM、欄位順序不同、空白行與多行的欄位，行號以實際行數計算', async () => {
    const result = await importCsv(
      [
        '﻿Email,Manager Email,Name',
        '',
        'multi.line@river.test,,"跨行',
        '姓名"',
        'after.multi@river.test,multi.line@river.test,後面一行',
      ].join('\n'),
    );

    expect(result.failed).toEqual([]);
    expect(result.imported.map((r) => [r.line, r.name])).toEqual([
      [3, '跨行\n姓名'],
      [5, '後面一行'],
    ]);
  });

  it('標題列缺少必要欄位時回 400，不匯入任何人', async () => {
    const before = (await people()).length;
    const res = await admin.post('/api/participants/import', {
      csv: 'name,mail\n某人,someone@river.test\n',
    });

    expect(res.status).toBe(400);
    expect((await people()).length).toBe(before);
  });

  it('沒有 user.manage 的人不能匯入', async () => {
    await app.provisionParticipant({
      email: 'designer@river.test',
      name: '設計師',
      password: PASSWORD,
      permissions: PERMISSION_PRESETS.designer,
    });
    const designer = await app.signIn('designer@river.test', PASSWORD);

    const res = await designer.post('/api/participants/import', {
      csv: 'name,email,manager_email\n某人,someone@river.test,\n',
    });

    expect(res.status).toBe(403);
  });
});
