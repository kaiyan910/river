import type { Permission } from '@river/auth';
import type {
  DirectoryEntry,
  Process,
  ProcessSummary,
  ProcessVersion,
  PublishRejected,
} from '@river/contracts';
import { checkProcess, type ProcessDsl } from '@river/dsl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiClient, startTestApp, type TestApp } from './harness.js';

const PASSWORD = 'correct horse battery staple';

/** start → 主管審批（指派給 approverId）→ end */
function approvalFlow(approverId: string | null): ProcessDsl {
  return {
    nodes: [
      { id: 'start', type: 'start', name: '開始', position: { x: 0, y: 0 } },
      {
        id: 'manager',
        type: 'approval',
        name: '主管審批',
        assignee: approverId ? { type: 'participant', participantId: approverId } : null,
        position: { x: 0, y: 170 },
      },
      { id: 'end', type: 'end', name: '結束', position: { x: 0, y: 340 } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'manager' },
      { id: 'e2', source: 'manager', target: 'end' },
    ],
    forms: [],
  };
}

describe('Process 草稿與發佈', () => {
  let app: TestApp;
  let designer: ApiClient;
  let editor: ApiClient;
  let publisher: ApiClient;
  let participant: ApiClient;
  let approverId: string;

  async function signInAs(email: string, name: string, permissions: Permission[]) {
    const { participantId } = await app.provisionParticipant({
      email,
      name,
      password: PASSWORD,
      permissions,
    });
    return { participantId, client: await app.signIn(email, PASSWORD) };
  }

  beforeAll(async () => {
    app = await startTestApp();
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    editor = (await signInAs('editor@river.test', '黃俊傑', ['process.edit'])).client;
    publisher = (await signInAs('publisher@river.test', '蔡佩君', ['process.publish'])).client;
    const approver = await signInAs('approver@river.test', '王美玲', []);
    approverId = approver.participantId;
    participant = approver.client;
  });
  afterAll(() => app?.close());

  async function createProcess(name: string, as = designer): Promise<Process> {
    const res = await as.post('/api/processes', { name });
    expect(res.status).toBe(201);
    return (await res.json()) as Process;
  }

  async function getProcess(id: string, as = designer): Promise<Process> {
    const res = await as.get(`/api/processes/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as Process;
  }

  async function saveDraft(id: string, dsl: ProcessDsl, as = designer) {
    const res = await as.put(`/api/processes/${id}/draft`, { dsl });
    expect(res.status).toBe(200);
    return (await res.json()) as Process;
  }

  it('建立 Process 時得到只有開始與結束的草稿，還沒有目前版本', async () => {
    const process = await createProcess('請假');

    expect(process).toMatchObject({ name: '請假', currentVersion: null, versions: [] });
    expect(process.draft?.dsl.nodes.map((n) => n.type)).toEqual(['start', 'end']);
    expect(process.draft?.savedBy.name).toBe('陳志明');

    const list = (await (await designer.get('/api/processes')).json()) as ProcessSummary[];
    expect(list.find((p) => p.id === process.id)).toEqual({
      id: process.id,
      name: '請假',
      currentVersion: null,
      draftSavedAt: process.draft?.savedAt,
    });
  });

  it('草稿可以儲存；還沒通過發佈前檢查的草稿也可以', async () => {
    const process = await createProcess('報銷');

    const saved = await saveDraft(process.id, approvalFlow(null));
    expect(saved.draft?.dsl).toEqual(approvalFlow(null));
    expect((await getProcess(process.id)).draft?.dsl).toEqual(approvalFlow(null));
  });

  it('格式不對的草稿不能儲存', async () => {
    const process = await createProcess('出差');
    const dsl = {
      nodes: [{ id: 'x', type: 'teleport', name: '瞬間移動', position: { x: 0, y: 0 } }],
      edges: [],
    };

    expect((await designer.put(`/api/processes/${process.id}/draft`, { dsl })).status).toBe(400);
  });

  it('Process 名稱不能重複，可以改名', async () => {
    const process = await createProcess('採購');

    expect((await designer.post('/api/processes', { name: '採購' })).status).toBe(409);
    const renamed = await designer.patch(`/api/processes/${process.id}`, { name: '採購申請' });
    expect(renamed.status).toBe(200);
    expect((await getProcess(process.id)).name).toBe('採購申請');
  });

  it('沒有通過檢查的草稿不能發佈，API 回傳與檢查器相同的錯誤', async () => {
    const process = await createProcess('加班');
    const dsl = approvalFlow(null);
    dsl.nodes.push({
      id: 'orphan',
      type: 'approval',
      name: '總經理審批',
      assignee: { type: 'participant', participantId: approverId },
      position: { x: 320, y: 170 },
    });
    await saveDraft(process.id, dsl);

    const res = await designer.post(`/api/processes/${process.id}/versions`, {});
    expect(res.status).toBe(422);
    const body = (await res.json()) as PublishRejected;
    expect(body.errors).toEqual(checkProcess(dsl));
    expect(body.errors.map((e) => [e.code, e.nodeId])).toEqual([
      ['UNREACHABLE_NODE', 'orphan'],
      ['APPROVAL_NO_ASSIGNEE', 'manager'],
    ]);
    expect(await getProcess(process.id)).toMatchObject({ currentVersion: null, versions: [] });
  });

  it('發佈後產生 Process Version 並成為目前版本，草稿清空', async () => {
    const process = await createProcess('用印');
    await saveDraft(process.id, approvalFlow(approverId));

    const res = await designer.post(`/api/processes/${process.id}/versions`, { note: '第一版' });
    expect(res.status).toBe(201);
    const version = (await res.json()) as ProcessVersion;
    expect(version).toMatchObject({
      version: 1,
      note: '第一版',
      publishedBy: { name: '陳志明' },
      dsl: approvalFlow(approverId),
    });

    const published = await getProcess(process.id);
    expect(published).toMatchObject({ currentVersion: 1, draft: null, versions: [version] });
  });

  it('再次發佈會產生新的版本，先前的 Process Version 不會改變', async () => {
    const process = await createProcess('教育訓練');
    await saveDraft(process.id, approvalFlow(approverId));
    const v1 = (await (
      await designer.post(`/api/processes/${process.id}/versions`, {})
    ).json()) as ProcessVersion;

    const changed = approvalFlow(approverId);
    changed.nodes[1] = { ...changed.nodes[1], name: '部門主管審批' } as ProcessDsl['nodes'][number];
    await saveDraft(process.id, changed);
    expect((await designer.post(`/api/processes/${process.id}/versions`, {})).status).toBe(201);

    const after = await getProcess(process.id);
    expect(after.currentVersion).toBe(2);
    expect(after.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(after.versions[0]).toEqual(v1);
    expect(after.versions[1]?.dsl).toEqual(changed);
  });

  it('沒有草稿時不能發佈', async () => {
    const process = await createProcess('換班');
    await saveDraft(process.id, approvalFlow(approverId));
    await designer.post(`/api/processes/${process.id}/versions`, {});

    expect((await designer.post(`/api/processes/${process.id}/versions`, {})).status).toBe(409);
  });

  it('捨棄草稿後回到目前版本；還沒發佈過的 Process 不能捨棄草稿', async () => {
    const process = await createProcess('借用設備');
    expect((await designer.delete(`/api/processes/${process.id}/draft`)).status).toBe(409);

    await saveDraft(process.id, approvalFlow(approverId));
    await designer.post(`/api/processes/${process.id}/versions`, {});
    await saveDraft(process.id, approvalFlow(null));

    expect((await designer.delete(`/api/processes/${process.id}/draft`)).status).toBe(204);
    expect(await getProcess(process.id)).toMatchObject({ draft: null, currentVersion: 1 });
  });

  it('只有 process.edit 的人可以編輯草稿但不能發佈', async () => {
    const process = await createProcess('公假', editor);
    await saveDraft(process.id, approvalFlow(approverId), editor);

    expect((await editor.post(`/api/processes/${process.id}/versions`, {})).status).toBe(403);
  });

  it('只有 process.publish 的人可以查看並發佈，但不能編輯', async () => {
    const process = await createProcess('年假');
    await saveDraft(process.id, approvalFlow(approverId));

    expect(
      (await publisher.put(`/api/processes/${process.id}/draft`, { dsl: approvalFlow(null) }))
        .status,
    ).toBe(403);
    expect((await publisher.post('/api/processes', { name: '病假' })).status).toBe(403);
    expect((await publisher.get(`/api/processes/${process.id}`)).status).toBe(200);
    const res = await publisher.post(`/api/processes/${process.id}/versions`, {});
    expect(res.status).toBe(201);
    expect(((await res.json()) as ProcessVersion).publishedBy.name).toBe('蔡佩君');
  });

  it('沒有設計類 Permission 的 Participant 看不到 Process', async () => {
    expect((await participant.get('/api/processes')).status).toBe(403);
    expect((await participant.post('/api/processes', { name: '婚假' })).status).toBe(403);
  });

  it('不存在的 Process 回 404', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await designer.get(`/api/processes/${missing}`)).status).toBe(404);
    expect(
      (await designer.put(`/api/processes/${missing}/draft`, { dsl: approvalFlow(null) })).status,
    ).toBe(404);
    expect((await designer.post(`/api/processes/${missing}/versions`, {})).status).toBe(404);
  });
});

describe('人員名錄', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(() => app?.close());

  it('Designer 可以讀取人員名錄來指派審批人，一般 Participant 不行', async () => {
    const { participantId } = await app.provisionParticipant({
      email: 'designer@river.test',
      name: '陳志明',
      password: PASSWORD,
      permissions: ['process.edit'],
    });
    await app.provisionParticipant({
      email: 'someone@river.test',
      name: '王美玲',
      password: PASSWORD,
      permissions: [],
    });
    const designer = await app.signIn('designer@river.test', PASSWORD);
    const someone = await app.signIn('someone@river.test', PASSWORD);

    const res = await designer.get('/api/participants/directory');
    expect(res.status).toBe(200);
    const people = (await res.json()) as DirectoryEntry[];
    expect(people).toContainEqual({
      id: participantId,
      name: '陳志明',
      email: 'designer@river.test',
      status: 'active',
    });
    expect(Object.keys(people[0] ?? {}).sort()).toEqual(['email', 'id', 'name', 'status']);

    expect((await someone.get('/api/participants/directory')).status).toBe(403);
  });
});
