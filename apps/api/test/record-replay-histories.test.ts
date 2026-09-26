/**
 * 產生 Seam ③（Replay）用的 workflow history 樣本：用 Seam ① 的測試環境跑真實的情境，
 * 把每一個 run 的 history 存成 apps/worker/test/histories/*.json，由 worker 的 replay 測試重跑。
 *
 * 平常的 `bun run test` 會略過這個檔案；只有要新增或更新樣本時才執行：
 *
 *   bun run --cwd apps/api replay:record
 *
 * 已經存在的樣本不會被覆寫：它代表舊版程式碼留下、可能仍在執行中的 Request，
 * 用新版程式碼重新產生就失去意義。確定要換掉某個樣本時，先刪掉它的檔案再執行。
 * 流程與注意事項見 docs/testing.md。
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Permission } from '@river/auth';
import type { MyTask, Process, RequestDetail } from '@river/contracts';
import {
  SCHEDULE_TIME_ZONE,
  SCHEDULED_START_WORKFLOW,
  type ScheduledStartInput,
} from '@river/contracts/workflow';
import { processSchedules } from '@river/db';
import type { Assignee, ProcessDsl, ProcessNode } from '@river/dsl';
import type { FormSchema } from '@river/forms';
import { historyToJSON } from '@temporalio/common/lib/proto-utils.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiClient, startTestApp, TASK_QUEUE, type TestApp } from './harness.js';

const RECORD = process.env.RECORD_REPLAY_HISTORIES === '1';
const OUT_DIR = new URL('../../worker/test/histories/', import.meta.url);
const PASSWORD = 'correct horse battery staple';
const HOUR = 60 * 60 * 1000;
/** 樣本裡的 worker identity 原本是「pid@主機名稱」，一律換成固定值，免得把開發者的機器名稱寫進 repo。 */
const IDENTITY = 'river-replay-sample';

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`等不到預期的狀態：${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const at = (y: number) => ({ x: 0, y });

const expense: FormSchema = {
  id: 'expense',
  name: '報銷單',
  fields: [
    { id: 'f1', key: 'amount', type: 'money', label: '金額', required: true, rules: {} },
    { id: 'f2', key: 'reason', type: 'text', label: '事由', required: true, rules: {} },
  ],
};

const receipt: FormSchema = {
  id: 'receipt',
  name: '收據確認',
  fields: [
    { id: 'r1', key: 'checked', type: 'checkbox', label: '收據齊全', required: false, rules: {} },
  ],
};

const approval = (
  id: string,
  name: string,
  assignee: Assignee,
  extra: Partial<Extract<ProcessNode, { type: 'approval' }>> = {},
): ProcessNode => ({ id, type: 'approval', name, assignee, position: at(170), ...extra });

/** 依序串起節點：start → nodes… → end。 */
function chain(nodes: ProcessNode[], forms: FormSchema[] = []): ProcessDsl {
  const all: ProcessNode[] = [
    {
      id: 'start',
      type: 'start',
      name: '開始',
      position: at(0),
      ...(forms[0] && { formId: forms[0].id }),
    },
    ...nodes,
    { id: 'end', type: 'end', name: '結束', position: at(510) },
  ];
  return {
    nodes: all,
    edges: all.slice(1).map((n, i) => ({ id: `e${i}`, source: all[i]?.id ?? '', target: n.id })),
    forms,
  };
}

/** start → 同時審批（IT 審批 → 資安審批 ∥ 財務審批）→ 匯合 → 主管審批 → end */
function parallelFlow(people: Record<'it' | 'security' | 'finance' | 'manager', string>) {
  const p = (participantId: string): Assignee => ({ type: 'participant', participantId });
  return {
    nodes: [
      { id: 'start', type: 'start', name: '開始', position: at(0) },
      { id: 'split', type: 'parallelSplit', name: '同時審批', position: at(170) },
      approval('it', 'IT 審批', p(people.it)),
      approval('security', '資安審批', p(people.security)),
      approval('finance', '財務審批', p(people.finance)),
      { id: 'join', type: 'parallelJoin', name: '匯合', position: at(510) },
      approval('manager', '主管審批', p(people.manager)),
      { id: 'end', type: 'end', name: '結束', position: at(850) },
    ],
    edges: [
      { id: 'e-start', source: 'start', target: 'split' },
      { id: 'e-it', source: 'split', target: 'it' },
      { id: 'e-finance', source: 'split', target: 'finance' },
      { id: 'e-security', source: 'it', target: 'security' },
      { id: 'e-security-join', source: 'security', target: 'join' },
      { id: 'e-finance-join', source: 'finance', target: 'join' },
      { id: 'e-join', source: 'join', target: 'manager' },
      { id: 'e-end', source: 'manager', target: 'end' },
    ],
    forms: [],
  } satisfies ProcessDsl;
}

describe.runIf(RECORD)('產生 replay 用的 history 樣本', () => {
  let app: TestApp;
  let designer: ApiClient;
  let admin: ApiClient;
  const people: Record<string, { id: string; client: ApiClient }> = {};

  async function signInAs(key: string, name: string, permissions: Permission[] = []) {
    const email = `${key}@river.test`;
    const { participantId } = await app.provisionParticipant({
      email,
      name,
      password: PASSWORD,
      permissions,
    });
    const client = await app.signIn(email, PASSWORD);
    people[key] = { id: participantId, client };
    return client;
  }

  const who = (key: string) => {
    const person = people[key];
    if (!person) throw new Error(`沒有 ${key}`);
    return person;
  };

  async function publish(name: string, dsl: ProcessDsl): Promise<string> {
    const created = (await (await designer.post('/api/processes', { name })).json()) as Process;
    expect((await designer.put(`/api/processes/${created.id}/draft`, { dsl })).status).toBe(200);
    expect((await designer.post(`/api/processes/${created.id}/versions`, {})).status).toBe(201);
    return created.id;
  }

  async function start(processId: string, title: string, data?: object): Promise<string> {
    const res = await who('employee').client.post('/api/requests', { processId, title, data });
    expect(res.status).toBe(201);
    return ((await res.json()) as RequestDetail).id;
  }

  async function taskFor(requestId: string, key: string): Promise<MyTask> {
    const open = () =>
      who(key)
        .client.get('/api/tasks/mine?status=open')
        .then((r) => r.json() as Promise<MyTask[]>);
    const tasks = await eventually(open, (list) => list.some((t) => t.request.id === requestId));
    return tasks.find((t) => t.request.id === requestId) as MyTask;
  }

  async function complete(
    requestId: string,
    key: string,
    body: { outcome: 'approved' | 'returned' | 'submitted'; comment?: string; data?: object },
  ) {
    const task = await taskFor(requestId, key);
    const res = await who(key).client.post(`/api/tasks/${task.id}/complete`, {
      version: task.version,
      ...body,
    });
    expect(res.status).toBe(200);
  }

  async function waitForStatus(requestId: string, status: RequestDetail['status']) {
    await eventually(
      () =>
        who('employee')
          .client.get(`/api/requests/${requestId}`)
          .then((r) => r.json() as Promise<RequestDetail>),
      (d) => d.status === status,
    );
  }

  /**
   * 取出 Request 每一個 run 的 history（Return 後重新送出會 continueAsNew，一筆 Request 有多個 run），
   * 依序存成 `<name>.json`、`<name>.run2.json`…。
   */
  async function save(name: string, requestId: string) {
    const runs: { runId: string | undefined; json: string }[] = [];
    let runId: string | undefined;
    do {
      const history = await app.temporal.workflow.getHandle(requestId, runId).fetchHistory();
      const [first] = history.events ?? [];
      runs.unshift({ runId, json: historyToJSON(history) });
      runId = first?.workflowExecutionStartedEventAttributes?.continuedExecutionRunId || undefined;
    } while (runId);

    await mkdir(OUT_DIR, { recursive: true });
    for (const [i, run] of runs.entries()) {
      const file = i === 0 ? `${name}.json` : `${name}.run${i + 1}.json`;
      await writeFile(new URL(file, OUT_DIR), `${sanitize(run.json)}\n`);
    }
  }

  /** 樣本檔案已經存在時略過這個情境（見檔案開頭的說明）。 */
  const record = (name: string, title: string, scenario: () => Promise<string>) =>
    it.skipIf(existsSync(new URL(`${name}.json`, OUT_DIR)))(`${name}：${title}`, async () => {
      await save(name, await scenario());
    });

  beforeAll(async () => {
    app = await startTestApp();
    admin = await signInAs('admin', '系統管理員', ['user.manage', 'role.manage']);
    designer = await signInAs('designer', '陳志明', ['process.edit', 'process.publish']);
    await signInAs('employee', '王小明');
    await signInAs('accountant', '黃淑芬');
    await signInAs('manager', '林美玲');
    await signInAs('it', '張家豪');
    await signInAs('security', '周建國');
    await signInAs('finance', '劉怡君');
    await signInAs('approver', '蔡依林');
    await signInAs('boss', '林協理');
    await signInAs('hr', '吳雅婷');
    const setManager = async (key: string, managerKey: string) =>
      expect(
        (await admin.patch(`/api/participants/${who(key).id}`, { managerId: who(managerKey).id }))
          .status,
      ).toBe(200);
    await setManager('approver', 'boss');
  });
  afterAll(() => app?.close());

  record('approval', '開始表單 → 填表 → 審批 → 完成', async () => {
    const processId = await publish(
      '報銷',
      chain(
        [
          {
            id: 'accounting',
            type: 'form',
            name: '會計確認收據',
            formId: 'receipt',
            assignee: { type: 'participant', participantId: who('accountant').id },
            position: at(170),
          },
          approval('manager', '主管審批', {
            type: 'participant',
            participantId: who('manager').id,
          }),
        ],
        [expense, receipt],
      ),
    );
    const id = await start(processId, '計程車費', { amount: 350, reason: '拜訪客戶' });
    await complete(id, 'accountant', { outcome: 'submitted', data: { checked: true } });
    await complete(id, 'manager', { outcome: 'approved' });
    await waitForStatus(id, 'completed');
    return id;
  });

  record('return-resubmit', 'Return → 重新送出（continueAsNew）→ 核准 → 完成', async () => {
    const processId = await publish(
      '請假',
      chain([
        approval('manager', '主管審批', { type: 'participant', participantId: who('manager').id }),
      ]),
    );
    const id = await start(processId, '10/3 特休');
    await complete(id, 'manager', { outcome: 'returned', comment: '請補上代理人' });
    await waitForStatus(id, 'returned');
    const res = await who('employee').client.post(`/api/requests/${id}/resubmit`, {
      title: '10/3 特休（代理人：林美玲）',
    });
    expect(res.status).toBe(200);
    await complete(id, 'manager', { outcome: 'approved' });
    await waitForStatus(id, 'completed');
    return id;
  });

  record('quiet-end', '審批 → 完成，「結束」節點關閉完成通知', async () => {
    const dsl = chain([
      approval('manager', '主管審批', { type: 'participant', participantId: who('manager').id }),
    ]);
    const processId = await publish('借用會議室', {
      ...dsl,
      nodes: dsl.nodes.map((n) => (n.type === 'end' ? { ...n, completionNotification: false } : n)),
    });
    const id = await start(processId, '10/8 大會議室');
    await complete(id, 'manager', { outcome: 'approved' });
    await waitForStatus(id, 'completed');
    return id;
  });

  record('parallel', '兩條分支各自審批，匯合後主管審批 → 完成', async () => {
    const processId = await publish(
      '採購',
      parallelFlow({
        it: who('it').id,
        security: who('security').id,
        finance: who('finance').id,
        manager: who('manager').id,
      }),
    );
    const id = await start(processId, '筆電採購');
    await complete(id, 'finance', { outcome: 'approved' });
    await complete(id, 'it', { outcome: 'approved' });
    await complete(id, 'security', { outcome: 'approved' });
    await complete(id, 'manager', { outcome: 'approved' });
    await waitForStatus(id, 'completed');
    return id;
  });

  record('escalation', 'Reminder 後逾時轉給處理人的 Manager → 核准 → 完成', async () => {
    const hrRoleId = (
      (await (await admin.post('/api/roles', { name: '人資' })).json()) as { id: string }
    ).id;
    expect((await admin.put(`/api/roles/${hrRoleId}/members/${who('hr').id}`)).status).toBe(204);
    const processId = await publish(
      '出差',
      chain([
        approval(
          'approve',
          '審批',
          { type: 'participant', participantId: who('approver').id },
          {
            reminder: { afterHours: 4, repeat: false },
            escalation: { afterHours: 8, fallbackRoleId: hrRoleId },
          },
        ),
      ]),
    );
    const id = await start(processId, '九月出差');
    await taskFor(id, 'approver');
    await app.skipTime(5 * HOUR);
    await eventually(
      async () => app.emails.sent.filter((m) => m.subject.includes('提醒')).length,
      (n) => n >= 1,
    );
    await app.skipTime(4 * HOUR);
    await complete(id, 'boss', { outcome: 'approved' });
    await waitForStatus(id, 'completed');
    return id;
  });

  /**
   * 排程發起：time skipping 的測試 server 不支援 Temporal Schedule，所以直接寫入排程設定、
   * 直接啟動 Schedule 會啟動的 scheduledStart workflow（輸入相同），history 與時間到時的一樣。
   */
  async function runScheduledStart(processId: string): Promise<string> {
    await app.db.insert(processSchedules).values({
      processId,
      cron: '0 9 1 * *',
      timezone: SCHEDULE_TIME_ZONE,
      initiatorId: who('employee').id,
      updatedBy: who('designer').id,
    });
    const args: [ScheduledStartInput] = [{ processId }];
    const handle = await app.temporal.workflow.start(SCHEDULED_START_WORKFLOW, {
      taskQueue: TASK_QUEUE,
      workflowId: `scheduled-start-${processId}`,
      args,
    });
    await handle.result();
    return handle.workflowId;
  }

  record(
    'scheduled-start',
    '排程時間到 → 建立 Request → 以 child workflow 啟動 interpreter',
    async () => {
      const processId = await publish(
        '每月盤點',
        chain([
          approval('manager', '主管審批', {
            type: 'participant',
            participantId: who('manager').id,
          }),
        ]),
      );
      return runScheduledStart(processId);
    },
  );

  record(
    'scheduled-start-skipped',
    '排程時間到，開始表單有必填欄位 → 跳過並通知 Administrator',
    async () => {
      const processId = await publish(
        '每月報銷',
        chain(
          [
            approval('manager', '主管審批', {
              type: 'participant',
              participantId: who('manager').id,
            }),
          ],
          [expense],
        ),
      );
      const before = app.emails.sent.length;
      const workflowId = await runScheduledStart(processId);
      expect(app.emails.sent.length).toBeGreaterThan(before);
      return workflowId;
    },
  );
});

/**
 * 換掉 worker identity，並確認 payload 裡沒有 email、密碼或 Form 的值：
 * interpreter 的 Signal 與 activity 只傳 ID 與 Process Version 的 DSL，出現這些就代表有東西洩漏進 history。
 */
function sanitize(json: string): string {
  const history = JSON.parse(json) as unknown;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (key === 'identity' && typeof child === 'string') record[key] = IDENTITY;
      else if (key === 'data' && typeof child === 'string') {
        const decoded = Buffer.from(child, 'base64').toString('utf8');
        for (const secret of ['@river.test', PASSWORD, '拜訪客戶', '請補上代理人', '代理人：'])
          if (decoded.includes(secret)) throw new Error(`history 的 payload 含有「${secret}」`);
      } else walk(child);
    }
  };
  walk(history);
  return JSON.stringify(history, null, 2);
}
