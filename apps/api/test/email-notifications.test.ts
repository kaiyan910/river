import type { Permission } from '@river/auth';
import type { MyTask, Process, PublishRejected, RequestDetail } from '@river/contracts';
import type { Assignee, EmailRecipient, ProcessDsl, ProcessNode } from '@river/dsl';
import type { EmailMessage } from '@river/email';
import type { FormSchema } from '@river/forms';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiClient, startTestApp, type TestApp } from './harness.js';

const PASSWORD = 'correct horse battery staple';
/** harness 裡瀏覽器所在的 origin；信件裡的連結以它為準。 */
const ORIGIN = 'http://river.test';

async function eventually<T>(read: () => Promise<T> | T, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`等不到預期的狀態：${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const trip: FormSchema = {
  id: 'trip',
  name: '出差申請單',
  fields: [
    { id: 'f1', key: 'destination', type: 'text', label: '目的地', required: true, rules: {} },
    { id: 'f2', key: 'amount', type: 'money', label: '預估金額', required: true, rules: {} },
  ],
};
const receipt: FormSchema = {
  id: 'receipt',
  name: '核銷資料',
  fields: [
    { id: 'f3', key: 'invoice', type: 'text', label: '發票號碼', required: true, rules: {} },
  ],
};

const at = (y: number) => ({ x: 0, y });

/** start（出差申請單）→ 依序經過每個節點 → end */
function chain(...steps: ProcessNode[]): ProcessDsl {
  const nodes: ProcessNode[] = [
    { id: 'start', type: 'start', name: '開始', formId: 'trip', position: at(0) },
    ...steps,
    { id: 'end', type: 'end', name: '結束', position: at(170 * (steps.length + 1)) },
  ];
  return {
    nodes,
    edges: nodes
      .slice(1)
      .map((n, i) => ({ id: `e${i}`, source: nodes[i]?.id ?? '', target: n.id })),
    forms: [trip, receipt],
  };
}

/** 把所有「結束」節點的完成通知關掉。 */
const quiet = (dsl: ProcessDsl): ProcessDsl => ({
  ...dsl,
  nodes: dsl.nodes.map((n) => (n.type === 'end' ? { ...n, completionNotification: false } : n)),
});

const approval = (id: string, assignee: Assignee): ProcessNode => ({
  id,
  type: 'approval',
  name: `審批 ${id}`,
  assignee,
  position: at(170),
});

const fill = (id: string, assignee: Assignee): ProcessNode => ({
  id,
  type: 'form',
  name: `填寫 ${id}`,
  formId: 'receipt',
  assignee,
  position: at(170),
});

const email = (
  id: string,
  recipient: EmailRecipient,
  template: { subject?: string; message?: string } = {},
): ProcessNode => ({
  id,
  type: 'email',
  name: `通知 ${id}`,
  recipient,
  subject: template.subject ?? '「{{requestTitle}}」已核准',
  message: template.message ?? '{{processName}} 的申請已核准：{{link}}',
  position: at(170),
});

describe('Email 通知與 Email 節點', () => {
  let app: TestApp;
  let designer: ApiClient;
  let employee: ApiClient;
  let clerk: ApiClient;
  let clerkId: string;
  let financeRoleId: string;

  async function signInAs(email: string, name: string, permissions: Permission[] = []) {
    const { participantId } = await app.provisionParticipant({
      email,
      name,
      password: PASSWORD,
      permissions,
    });
    return { participantId, client: await app.signIn(email, PASSWORD) };
  }

  async function publish(name: string, dsl: ProcessDsl): Promise<string> {
    const created = (await (await designer.post('/api/processes', { name })).json()) as Process;
    expect((await designer.put(`/api/processes/${created.id}/draft`, { dsl })).status).toBe(200);
    const res = await designer.post(`/api/processes/${created.id}/versions`, {});
    expect(res.status).toBe(201);
    return created.id;
  }

  async function start(
    as: ApiClient,
    processId: string,
    title: string,
    data: Record<string, unknown> = { destination: '台中', amount: 1200 },
  ): Promise<RequestDetail> {
    const res = await as.post('/api/requests', { processId, title, data });
    expect(res.status).toBe(201);
    return (await res.json()) as RequestDetail;
  }

  async function waitForTask(requestId: string, as: ApiClient): Promise<MyTask> {
    const tasks = await eventually(
      async () => (await (await as.get('/api/tasks/mine?status=open')).json()) as MyTask[],
      (list) => list.some((t) => t.request.id === requestId),
    );
    return tasks.find((t) => t.request.id === requestId) as MyTask;
  }

  async function detail(id: string, as: ApiClient): Promise<RequestDetail> {
    const res = await as.get(`/api/requests/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as RequestDetail;
  }

  function complete(
    as: ApiClient,
    task: { id: string; version: number },
    body: { outcome: string; data?: object; comment?: string },
  ) {
    return as.post(`/api/tasks/${task.id}/complete`, { version: task.version, ...body });
  }

  /** 標題含有 title 的信（每個測試用不同的標題，只看自己那筆 Request 的信）。 */
  const mailsAbout = (title: string): EmailMessage[] =>
    app.emails.sent.filter((m) => m.subject.includes(title) || m.text.includes(title));

  /** 等到標題含有 title 的信件數量達到 count，回傳這些信。 */
  const waitForMails = (title: string, count: number) =>
    eventually(
      () => mailsAbout(title),
      (list) => list.length >= count,
    );

  /**
   * 等這個 Task 的待辦通知寄出。notify activity 寄信前會確認 Task 仍是 open，
   * 測試太快處理掉 Task 的話，通知就被略過了，所以處理前要先等信寄出。
   */
  const waitForTaskMails = (task: { id: string }, count: number) =>
    eventually(
      () => app.emails.sent.filter((m) => m.text.includes(`${ORIGIN}/tasks?id=${task.id}`)),
      (list) => list.length >= count,
    );

  beforeAll(async () => {
    app = await startTestApp();
    const admin = (await signInAs('admin@river.test', '系統管理員', ['user.manage', 'role.manage']))
      .client;
    designer = (
      await signInAs('designer@river.test', '陳志明', ['process.edit', 'process.publish'])
    ).client;
    const { participantId: managerId } = await signInAs('manager@river.test', '黃淑芬');
    const e = await signInAs('employee@river.test', '王小明');
    employee = e.client;
    expect((await admin.patch(`/api/participants/${e.participantId}`, { managerId })).status).toBe(
      200,
    );
    const c = await signInAs('clerk@river.test', '林雅琪');
    clerk = c.client;
    clerkId = c.participantId;

    const res = await admin.post('/api/roles', { name: '財務' });
    financeRoleId = ((await res.json()) as { id: string }).id;
    for (const [address, name] of [
      ['finance.a@river.test', '張家豪'],
      ['finance.b@river.test', '劉怡君'],
    ] as const) {
      const { participantId } = await signInAs(address, name);
      expect((await admin.put(`/api/roles/${financeRoleId}/members/${participantId}`)).status).toBe(
        204,
      );
    }
  });
  afterAll(() => app?.close());

  it('新 Task 指派給 Role 時寄信給每一位成員，連結直接開到這個 Task', async () => {
    const processId = await publish(
      '出差－Role 審批',
      chain(approval('finance', { type: 'role', roleId: financeRoleId })),
    );
    const request = await start(employee, processId, '9 月台中出差');
    const finance = await signInAsExisting('finance.a@river.test');
    const task = await waitForTask(request.id, finance);

    const mails = await waitForMails('9 月台中出差', 2);
    expect(mails.map((m) => m.to).sort()).toEqual(['finance.a@river.test', 'finance.b@river.test']);
    for (const mail of mails) {
      expect(mail.subject).toContain('9 月台中出差');
      expect(mail.text).toContain('出差－Role 審批');
      expect(mail.text).toContain(`${ORIGIN}/tasks?id=${task.id}`);
      expect(mail.html).toContain(`${ORIGIN}/tasks?id=${task.id}`);
    }
  });

  it('新 Task 指派給特定人時只寄給他', async () => {
    const processId = await publish(
      '出差－指定審批人',
      chain(approval('clerk', { type: 'participant', participantId: clerkId })),
    );
    const request = await start(employee, processId, '10 月高雄出差');
    const task = await waitForTask(request.id, clerk);

    const [mail] = await waitForMails('10 月高雄出差', 1);
    expect(mail?.to).toBe('clerk@river.test');
    expect(mail?.text).toContain(`${ORIGIN}/tasks?id=${task.id}`);
    // 等一下，確認沒有多寄。
    await new Promise((r) => setTimeout(r, 300));
    expect(mailsAbout('10 月高雄出差')).toHaveLength(1);
  });

  it('Request 被 Return 時寄信給發起人，連結開到這筆 Request', async () => {
    const processId = await publish(
      '出差－Return',
      chain(approval('clerk', { type: 'participant', participantId: clerkId })),
    );
    const request = await start(employee, processId, '11 月花蓮出差');
    const task = await waitForTask(request.id, clerk);
    expect((await complete(clerk, task, { outcome: 'returned', comment: '缺行程表' })).status).toBe(
      200,
    );

    const mails = await waitForMails('11 月花蓮出差', 2);
    const returned = mails.find((m) => m.to === 'employee@river.test');
    expect(returned?.subject).toContain('退回');
    expect(returned?.text).toContain('出差－Return');
    expect(returned?.text).toContain(`${ORIGIN}/requests?id=${request.id}`);
  });

  it('Request 完成時寄信給發起人', async () => {
    const processId = await publish(
      '出差－完成',
      chain(approval('clerk', { type: 'participant', participantId: clerkId })),
    );
    const request = await start(employee, processId, '12 月澎湖出差');
    const task = await waitForTask(request.id, clerk);
    expect((await complete(clerk, task, { outcome: 'approved' })).status).toBe(200);

    const mails = await waitForMails('12 月澎湖出差', 2);
    const completed = mails.find((m) => m.to === 'employee@river.test');
    expect(completed?.subject).toContain('完成');
    expect(completed?.text).toContain(`${ORIGIN}/requests?id=${request.id}`);
  });

  it('「結束」節點關閉完成通知時不寄給發起人，Email 節點照常寄出，時間軸不記錄', async () => {
    const processId = await publish(
      '出差－不通知完成',
      quiet(
        chain(email('notify', { type: 'initiator' }, { subject: '[發起人] {{requestTitle}}' })),
      ),
    );
    const request = await start(employee, processId, '4 月蘭嶼出差');
    const done = await eventually(
      () => detail(request.id, employee),
      (d) => d.status === 'completed',
    );
    expect(done.events.map((e) => e.type)).toEqual([
      'request.started',
      'step.email_sent',
      'request.completed',
    ]);
    await waitForMails('4 月蘭嶼出差', 1);
    // 等一下，確認沒有完成通知。
    await new Promise((r) => setTimeout(r, 300));
    expect(mailsAbout('4 月蘭嶼出差').map((m) => m.subject)).toEqual(['[發起人] 4 月蘭嶼出差']);
  });

  it('同一個 Process 走到不同「結束」時，各自依節點設定決定是否寄完成通知', async () => {
    const nodes: ProcessNode[] = [
      { id: 'start', type: 'start', name: '開始', formId: 'trip', position: at(0) },
      { id: 'check', type: 'condition', name: '金額判斷', position: at(170) },
      {
        id: 'small',
        type: 'end',
        name: '小額結束',
        completionNotification: false,
        position: at(340),
      },
      { id: 'large', type: 'end', name: '結束', position: at(340) },
    ];
    const processId = await publish('出差－依金額通知', {
      nodes,
      edges: [
        { id: 'e0', source: 'start', target: 'check' },
        {
          id: 'e-small',
          source: 'check',
          target: 'small',
          branch: { type: 'expression', expression: 'amount < 1000' },
        },
        { id: 'e-large', source: 'check', target: 'large', branch: { type: 'default' } },
      ],
      forms: [trip, receipt],
    });

    const small = await start(employee, processId, '5 月小琉球出差', {
      destination: '小琉球',
      amount: 500,
    });
    const large = await start(employee, processId, '6 月東京出差', {
      destination: '東京',
      amount: 50_000,
    });
    for (const r of [small, large])
      await eventually(
        () => detail(r.id, employee),
        (d) => d.status === 'completed',
      );

    const [completed] = await waitForMails('6 月東京出差', 1);
    expect(completed?.to).toBe('employee@river.test');
    expect(completed?.subject).toContain('完成');
    await new Promise((r) => setTimeout(r, 300));
    expect(mailsAbout('5 月小琉球出差')).toEqual([]);
  });

  it('Email 節點寄給發起人的 Manager，代入範本變數後繼續往下走，時間軸記錄寄出', async () => {
    const processId = await publish('出差－通知主管', chain(email('notify', { type: 'manager' })));
    const request = await start(employee, processId, '1 月金門出差');

    const done = await eventually(
      () => detail(request.id, employee),
      (d) => d.status === 'completed',
    );
    expect(done.events.map((e) => [e.type, e.node?.name ?? null])).toEqual([
      ['request.started', null],
      ['step.email_sent', '通知 notify'],
      ['request.completed', null],
    ]);
    const mails = await waitForMails('1 月金門出差', 2);
    const notified = mails.find((m) => m.to === 'manager@river.test');
    expect(notified?.subject).toBe('「1 月金門出差」已核准');
    expect(notified?.text).toContain(
      `出差－通知主管 的申請已核准：${ORIGIN}/requests?id=${request.id}`,
    );
    expect(mails.find((m) => m.to === 'employee@river.test')?.subject).toContain('完成');
  });

  it('Email 節點寄給 Role 的每一位成員、特定人或發起人', async () => {
    const processId = await publish(
      '出差－多種收件對象',
      chain(
        email(
          'toRole',
          { type: 'role', roleId: financeRoleId },
          { subject: '[Role] {{requestTitle}}' },
        ),
        email(
          'toClerk',
          { type: 'participant', participantId: clerkId },
          { subject: '[特定人] {{requestTitle}}' },
        ),
        email('toInitiator', { type: 'initiator' }, { subject: '[發起人] {{requestTitle}}' }),
      ),
    );
    const request = await start(employee, processId, '2 月馬祖出差');
    await eventually(
      () => detail(request.id, employee),
      (d) => d.status === 'completed',
    );

    const mails = await waitForMails('2 月馬祖出差', 5);
    expect(
      mails
        .filter((m) => m.subject.startsWith('['))
        .map((m) => [m.subject, m.to])
        .sort(),
    ).toEqual([
      ['[Role] 2 月馬祖出差', 'finance.a@river.test'],
      ['[Role] 2 月馬祖出差', 'finance.b@river.test'],
      ['[特定人] 2 月馬祖出差', 'clerk@river.test'],
      ['[發起人] 2 月馬祖出差', 'employee@river.test'],
    ]);
  });

  it('Email 節點寄給 Manager 但發起人沒有 Manager 時不寄出，Request 照常往下走', async () => {
    const processId = await publish(
      '出差－沒有主管',
      chain(email('notify', { type: 'manager' }, { subject: '[主管] {{requestTitle}}' })),
    );
    const request = await start(clerk, processId, '3 月綠島出差');
    const done = await eventually(
      () => detail(request.id, clerk),
      (d) => d.status === 'completed',
    );
    expect(done.events.map((e) => e.type)).toEqual(['request.started', 'request.completed']);
    expect(mailsAbout('3 月綠島出差').map((m) => m.to)).toEqual(['clerk@river.test']);
  });

  it('Email 節點的範本用了 Form 欄位時不能發佈', async () => {
    const created = (await (
      await designer.post('/api/processes', { name: '出差－範本含欄位' })
    ).json()) as Process;
    const dsl = chain(email('notify', { type: 'initiator' }, { message: '金額 {{amount}} 元' }));
    expect((await designer.put(`/api/processes/${created.id}/draft`, { dsl })).status).toBe(200);

    const res = await designer.post(`/api/processes/${created.id}/versions`, {});
    expect(res.status).toBe(422);
    expect(((await res.json()) as PublishRejected).errors).toEqual([
      {
        nodeId: 'notify',
        code: 'EMAIL_UNKNOWN_VARIABLE',
        message: expect.stringContaining('amount'),
      },
    ]);
  });

  it('寄出的信件內容中不含任何表單欄位的值', async () => {
    const secrets = {
      destination: 'Zanzibar 秘密據點',
      amount: 987654,
      invoice: 'INV-7c1f93e0',
      resubmitted: 'Reykjavik 第二版',
      comment: '預算超標 3a9e',
    };
    const processId = await publish(
      '出差－安全',
      chain(
        fill('receipt', { type: 'participant', participantId: clerkId }),
        approval('finance', { type: 'role', roleId: financeRoleId }),
        email('notify', { type: 'initiator' }),
      ),
    );
    const title = '4 月海外出差';
    const request = await start(employee, processId, title, {
      destination: secrets.destination,
      amount: secrets.amount,
    });
    const receiptTask = await waitForTask(request.id, clerk);
    await waitForTaskMails(receiptTask, 1);
    expect(
      (
        await complete(clerk, receiptTask, {
          outcome: 'submitted',
          data: { invoice: secrets.invoice },
        })
      ).status,
    ).toBe(200);
    const finance = await signInAsExisting('finance.a@river.test');
    const first = await waitForTask(request.id, finance);
    await waitForTaskMails(first, 2);
    expect(
      (await complete(finance, first, { outcome: 'returned', comment: secrets.comment })).status,
    ).toBe(200);

    const resubmitted = await employee.post(`/api/requests/${request.id}/resubmit`, {
      title,
      data: { destination: secrets.resubmitted, amount: secrets.amount },
    });
    expect(resubmitted.status).toBe(200);
    const again = await waitForTask(request.id, clerk);
    await waitForTaskMails(again, 1);
    expect(
      (await complete(clerk, again, { outcome: 'submitted', data: { invoice: secrets.invoice } }))
        .status,
    ).toBe(200);
    const second = await waitForTask(request.id, finance);
    await waitForTaskMails(second, 2);
    expect((await complete(finance, second, { outcome: 'approved' })).status).toBe(200);
    await eventually(
      () => detail(request.id, employee),
      (d) => d.status === 'completed',
    );

    // 填表 ×2、Role 審批 ×2 位成員 ×2 輪、Return、Email 節點、完成。Return 的意見也不寄出。
    const mails = await waitForMails(title, 9);
    const forbidden = [
      secrets.destination,
      secrets.resubmitted,
      secrets.invoice,
      secrets.comment,
      String(secrets.amount),
      secrets.amount.toLocaleString('en-US'),
      secrets.amount.toLocaleString('zh-TW'),
    ];
    for (const mail of mails)
      for (const value of forbidden)
        for (const part of [mail.subject, mail.text, mail.html]) expect(part).not.toContain(value);
  });

  /** 已經 provision 過的帳號重新登入。 */
  function signInAsExisting(address: string): Promise<ApiClient> {
    return app.signIn(address, PASSWORD);
  }
});
