import { PERMISSION_PRESETS, type Permission } from '@river/auth';
import type { MyTask, Process, RequestDetail, RequestSummary } from '@river/contracts';
import { SCHEDULED_START_WORKFLOW, scheduleIdOf } from '@river/contracts/workflow';
import { requests } from '@river/db';
import type { ProcessDsl } from '@river/dsl';
import type { FormSchema } from '@river/forms';
import { ScheduleNotFoundError } from '@temporalio/client';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiClient, startTestApp, type TestApp } from './harness.js';

const PASSWORD = 'correct horse battery staple';

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`等不到預期的狀態：${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const at = (y: number) => ({ x: 0, y });

/** 開始表單「月報」：欄位都不是必填，排程發起時以空白的表單送出。 */
const report: FormSchema = {
  id: 'report',
  name: '月報',
  fields: [{ id: 'f1', key: 'note', type: 'text', label: '備註', required: false, rules: {} }],
};

/** start（開始表單 form）→「主管審批」（指派給特定人）→ end */
function oneApproval(approverId: string, name: string, form: FormSchema = report): ProcessDsl {
  return {
    nodes: [
      { id: 'start', type: 'start', name: '開始', formId: form.id, position: at(0) },
      {
        id: 'approve',
        type: 'approval',
        name,
        assignee: { type: 'participant', participantId: approverId },
        position: at(170),
      },
      { id: 'end', type: 'end', name: '結束', position: at(340) },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'approve' },
      { id: 'e2', source: 'approve', target: 'end' },
    ],
    forms: [form],
  };
}

describe('排程發起', () => {
  let app: TestApp;
  let admin: ApiClient;
  let designer: ApiClient;
  /** 王小明：排程的發起人。 */
  let initiator: ApiClient;
  let initiatorId: string;
  /** 黃淑芬：審批人。 */
  let approver: ApiClient;
  let approverId: string;
  let employee: ApiClient;

  async function signInAs(email: string, name: string, permissions: Permission[] = []) {
    const { participantId } = await app.provisionParticipant({
      email,
      name,
      password: PASSWORD,
      permissions,
    });
    return { participantId, client: await app.signIn(email, PASSWORD) };
  }

  async function create(name: string): Promise<string> {
    const res = await designer.post('/api/processes', { name });
    expect(res.status).toBe(201);
    return ((await res.json()) as Process).id;
  }

  async function publish(id: string, dsl: ProcessDsl): Promise<void> {
    const draft = await designer.post(`/api/processes/${id}/draft`);
    expect([201, 409]).toContain(draft.status);
    expect((await designer.put(`/api/processes/${id}/draft`, { dsl })).status).toBe(200);
    expect((await designer.post(`/api/processes/${id}/versions`, {})).status).toBe(201);
  }

  async function published(name: string, dsl: ProcessDsl): Promise<string> {
    const id = await create(name);
    await publish(id, dsl);
    return id;
  }

  function setSchedule(id: string, body: unknown, as: ApiClient = designer) {
    return as.put(`/api/processes/${id}/schedule`, body);
  }

  function describeSchedule(processId: string) {
    return app.temporal.schedule.getHandle(scheduleIdOf(processId)).describe();
  }

  /** 不等 cron，直接讓 Temporal Schedule 執行一次它的動作（和時間到了一樣）。 */
  function fire(processId: string) {
    return app.temporal.schedule.getHandle(scheduleIdOf(processId)).trigger();
  }

  async function mine(as: ApiClient): Promise<RequestSummary[]> {
    const res = await as.get('/api/requests/mine');
    expect(res.status).toBe(200);
    return (await res.json()) as RequestSummary[];
  }

  async function openTasks(as: ApiClient): Promise<MyTask[]> {
    const res = await as.get('/api/tasks/mine?status=open');
    expect(res.status).toBe(200);
    return (await res.json()) as MyTask[];
  }

  async function requestsOf(processName: string) {
    return (await mine(initiator)).filter((r) => r.process.name === processName);
  }

  beforeAll(async () => {
    app = await startTestApp({ temporal: 'local' });
    admin = (
      await signInAs('admin@river.test', '系統管理員', [...PERMISSION_PRESETS.administrator])
    ).client;
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    const i = await signInAs('initiator@river.test', '王小明');
    initiator = i.client;
    initiatorId = i.participantId;
    const a = await signInAs('approver@river.test', '黃淑芬');
    approver = a.client;
    approverId = a.participantId;
    employee = (await signInAs('employee@river.test', '林怡君')).client;
  });
  afterAll(() => app?.close());

  it('設定排程需要 process.publish；cron、發起人不合法時回 422，還沒發佈的 Process 回 409', async () => {
    const id = await published('驗證排程', oneApproval(approverId, '審批'));
    const body = { cron: '0 9 1 * *', initiatorId };

    expect((await setSchedule(id, body, employee)).status).toBe(403);
    expect((await employee.delete(`/api/processes/${id}/schedule`)).status).toBe(403);
    expect((await setSchedule(id, body, app.anonymous)).status).toBe(401);

    expect((await setSchedule(id, { ...body, cron: '每月一號' })).status).toBe(400);
    expect((await setSchedule(id, { ...body, cron: '0 25 1 * *' })).status).toBe(422);
    expect(
      (await setSchedule(id, { ...body, initiatorId: '00000000-0000-4000-8000-000000000000' }))
        .status,
    ).toBe(422);
    expect((await setSchedule(id, { cron: body.cron })).status).toBe(400);

    const unpublished = await create('還沒發佈');
    expect((await setSchedule(unpublished, body)).status).toBe(409);
    expect((await setSchedule('00000000-0000-4000-8000-000000000000', body)).status).toBe(404);

    // 失敗的設定都沒有留下 Temporal Schedule。
    await expect(describeSchedule(id)).rejects.toBeInstanceOf(ScheduleNotFoundError);
  });

  it('發起人必須可以發起這個 Process（Initiator Role）', async () => {
    const id = await published('限定發起', oneApproval(approverId, '審批'));
    const role = (await (await admin.post('/api/roles', { name: '會計' })).json()) as {
      id: string;
    };
    expect(
      (
        await designer.put(`/api/processes/${id}/access`, {
          initiatorRoleIds: [role.id],
          observerRoleIds: [],
        })
      ).status,
    ).toBe(200);
    expect((await setSchedule(id, { cron: '0 9 1 * *', initiatorId })).status).toBe(422);

    expect((await admin.put(`/api/roles/${role.id}/members/${initiatorId}`)).status).toBe(204);
    expect((await setSchedule(id, { cron: '0 9 1 * *', initiatorId })).status).toBe(200);
  });

  it('設定、修改、刪除排程時同步建立、更新、刪除 Temporal Schedule', async () => {
    const id = await published('每月盤點', oneApproval(approverId, '審批'));

    const set = await setSchedule(id, { cron: '0 9 1 * *', initiatorId });
    expect(set.status).toBe(200);
    expect(((await set.json()) as Process).schedule).toEqual({
      cron: '0 9 1 * *',
      timezone: 'Asia/Taipei',
      initiator: { id: initiatorId, name: '王小明', deactivated: false },
    });
    expect(
      ((await (await designer.get(`/api/processes/${id}`)).json()) as Process).schedule,
    ).toEqual(expect.objectContaining({ cron: '0 9 1 * *' }));

    let schedule = await describeSchedule(id);
    expect(schedule.spec.timezone).toBe('Asia/Taipei');
    expect(schedule.spec.calendars?.[0]).toMatchObject({
      hour: [{ start: 9 }],
      dayOfMonth: [{ start: 1 }],
    });
    expect(schedule.action).toMatchObject({
      type: 'startWorkflow',
      workflowType: SCHEDULED_START_WORKFLOW,
      args: [{ processId: id }],
    });

    // 修改：同一個 Temporal Schedule 改成新的時間。
    const changed = await setSchedule(id, { cron: '30 8 * * 1', initiatorId: approverId });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as Process).schedule).toMatchObject({
      cron: '30 8 * * 1',
      initiator: { id: approverId, name: '黃淑芬' },
    });
    schedule = await describeSchedule(id);
    expect(schedule.spec.calendars?.[0]).toMatchObject({
      minute: [{ start: 30 }],
      hour: [{ start: 8 }],
      dayOfWeek: [{ start: 'MONDAY' }],
    });

    // 刪除：Temporal Schedule 也一起刪除；再刪一次沒有影響。
    const removed = await designer.delete(`/api/processes/${id}/schedule`);
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as Process).schedule).toBeNull();
    await expect(describeSchedule(id)).rejects.toBeInstanceOf(ScheduleNotFoundError);
    expect((await designer.delete(`/api/processes/${id}/schedule`)).status).toBe(200);
  });

  it('時間到了，以指定的 Participant 為發起人、目前的 Process Version 發起 Request', async () => {
    const id = await published('每月報表', oneApproval(approverId, '舊版審批'));
    expect((await setSchedule(id, { cron: '0 9 1 * *', initiatorId })).status).toBe(200);
    // 設定排程之後才發佈的版本，時間到了也用它。
    await publish(id, oneApproval(approverId, '新版審批'));

    await fire(id);
    const [started] = await eventually(
      () => requestsOf('每月報表'),
      (list) => list.length === 1,
    );
    expect(started).toMatchObject({
      status: 'running',
      process: { id, name: '每月報表', version: 2 },
      initiator: { id: initiatorId, name: '王小明' },
    });
    expect(started?.title).toMatch(/^每月報表（排程 \d{4}-\d{2}-\d{2}）$/);

    const detail = (await (
      await initiator.get(`/api/requests/${started?.id}`)
    ).json()) as RequestDetail;
    expect(detail.events[0]).toMatchObject({
      type: 'request.started',
      actor: { id: initiatorId },
      comment: '排程發起',
    });

    // 流程照常進行：審批人收到新版的 Task，核准後 Request 完成。
    const tasks = await eventually(
      () => openTasks(approver),
      (list) => list.some((t) => t.request.id === started?.id),
    );
    const task = tasks.find((t) => t.request.id === started?.id) as MyTask;
    expect(task.nodeName).toBe('新版審批');
    expect(
      (
        await approver.post(`/api/tasks/${task.id}/complete`, {
          outcome: 'approved',
          version: task.version,
        })
      ).status,
    ).toBe(200);
    await eventually(
      () => requestsOf('每月報表'),
      (list) => list[0]?.status === 'completed',
    );

    // 每次時間到都發起一筆新的 Request。
    await fire(id);
    await eventually(
      () => requestsOf('每月報表'),
      (list) => list.length === 2,
    );
  });

  it('指定的發起人已停用時跳過這次發起，並通知 Administrator', async () => {
    const leaving = await signInAs('leaving@river.test', '張家豪');
    const id = await published('每週巡檢', oneApproval(approverId, '審批'));
    expect(
      (await setSchedule(id, { cron: '0 9 * * 1', initiatorId: leaving.participantId })).status,
    ).toBe(200);
    expect((await admin.post(`/api/participants/${leaving.participantId}/deactivate`)).status).toBe(
      200,
    );
    const before = app.emails.sent.length;

    // Designer 看得到發起人已停用。
    expect(
      ((await (await designer.get(`/api/processes/${id}`)).json()) as Process).schedule,
    ).toMatchObject({
      initiator: { id: leaving.participantId, deactivated: true },
    });

    await fire(id);
    const mail = await eventually(
      async () => app.emails.sent.slice(before).find((m) => m.to === 'admin@river.test'),
      (m) => m !== undefined,
    );
    expect(mail?.subject).toContain('每週巡檢');
    expect(mail?.text).toContain('張家豪');
    expect(mail?.text).toContain('已停用');

    const created = await app.db
      .select({ id: requests.id })
      .from(requests)
      .where(eq(requests.initiatorId, leaving.participantId));
    expect(created).toEqual([]);
  });

  it('開始表單有必填欄位時無法以空白表單發起：跳過並通知 Administrator', async () => {
    const required: FormSchema = {
      id: 'required',
      name: '必填',
      fields: [{ id: 'f1', key: 'amount', type: 'text', label: '金額', required: true, rules: {} }],
    };
    const id = await published('需要填表', oneApproval(approverId, '審批', required));
    expect((await setSchedule(id, { cron: '0 9 1 * *', initiatorId })).status).toBe(200);
    const before = app.emails.sent.length;

    await fire(id);
    const mail = await eventually(
      async () => app.emails.sent.slice(before).find((m) => m.to === 'admin@river.test'),
      (m) => m !== undefined,
    );
    expect(mail?.subject).toContain('需要填表');
    expect(mail?.text).toContain('必填');
    expect(await requestsOf('需要填表')).toEqual([]);
  });
});
