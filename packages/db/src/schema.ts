import type { Permission } from '@river/auth';
import type { ProcessDsl } from '@river/dsl';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// ─── Better Auth 的資料表（欄位依 Better Auth 核心 schema）────────────────

export const authUsers = pgTable('auth_users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authSessions = pgTable('auth_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authAccounts = pgTable('auth_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authVerifications = pgTable('auth_verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── 人員與權限 ────────────────────────────────────────────────────────────

/** Participant 與 Better Auth 的 user 一對一；name 與 email 以 auth_users 為準。只停用、不刪除。 */
export const participants = pgTable('participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => authUsers.id),
  managerId: uuid('manager_id').references((): AnyPgColumn => participants.id),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const permissionGrants = pgTable(
  'permission_grants',
  {
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id),
    permission: text('permission').$type<Permission>().notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.participantId, t.permission] })],
);

/** 業務上的人員集合（例如「財務審批人」），用來指派 Task、限制發起與查看範圍；不代表平台權限。 */
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const roleMembers = pgTable(
  'role_members',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.participantId] })],
);

// ─── 流程定義 ──────────────────────────────────────────────────────────────

/** Process 與它唯一的一份草稿；draft 為 null 代表目前版本之後沒有改動。 */
export const processes = pgTable('processes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  draft: jsonb('draft').$type<ProcessDsl>(),
  draftSavedAt: timestamp('draft_saved_at', { withTimezone: true }),
  draftSavedBy: uuid('draft_saved_by').references(() => participants.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 已發佈的 Process Version：只新增、不修改。版本號最大的是目前版本。 */
export const processVersions = pgTable(
  'process_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    processId: uuid('process_id')
      .notNull()
      .references(() => processes.id),
    version: integer('version').notNull(),
    dsl: jsonb('dsl').$type<ProcessDsl>().notNull(),
    note: text('note').notNull().default(''),
    publishedBy: uuid('published_by')
      .notNull()
      .references(() => participants.id),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.processId, t.version)],
);

// ─── Request 與 Task ──────────────────────────────────────────────────────

/** returned：被 Return，等待發起人重新送出；completed、withdrawn 是最終狀態。 */
export const REQUEST_STATUSES = ['running', 'returned', 'completed', 'withdrawn'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** 一筆 Request 對應一個 Temporal workflow，workflow ID 等於 Request ID。發起時鎖定 Process Version。 */
export const requests = pgTable(
  'requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 給人看的流水號，畫面顯示成 R-000042。 */
    number: integer('number').generatedAlwaysAsIdentity().notNull().unique(),
    processVersionId: uuid('process_version_id')
      .notNull()
      .references(() => processVersions.id),
    initiatorId: uuid('initiator_id')
      .notNull()
      .references(() => participants.id),
    title: text('title').notNull(),
    status: text('status').$type<RequestStatus>().notNull().default('running'),
    /** 第幾輪：發起時是 1，每次 Return 後重新送出加 1。Task 與 Form 資料都記下自己屬於哪一輪。 */
    round: integer('round').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.initiatorId)],
);

/** superseded：因為 Return 或 Withdraw 而作廢，不再需要處理。 */
export const TASK_STATUSES = ['open', 'completed', 'superseded'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** 審批 Task 的結果是 approved 或 returned；填表 Task 送出後是 submitted。 */
export type TaskOutcome = 'approved' | 'returned' | 'submitted';
/** 對應產生 Task 的節點類型。 */
export const TASK_KINDS = ['approval', 'form'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/**
 * Request 流轉到人工步驟時由 workflow 建立。ID 由 workflow 產生，activity 重試時不會重複建立。
 * API 以樂觀鎖（status + version）把 open 改成 completed，只有成功的一方送出 taskCompleted Signal。
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id),
    nodeId: text('node_id').notNull(),
    nodeName: text('node_name').notNull(),
    kind: text('kind').$type<TaskKind>().notNull().default('approval'),
    /** 建立時 Request 的第幾輪。 */
    round: integer('round').notNull().default(1),
    /** 指派給特定 Participant 時才有；指派給 Role 時為 null，由最先送出的成員處理（completedBy）。 */
    assigneeId: uuid('assignee_id').references(() => participants.id),
    /** 指派給 Role 時才有；成員在查詢當下決定，之後加入 Role 的人也看得到。 */
    roleId: uuid('role_id').references(() => roles.id),
    status: text('status').$type<TaskStatus>().notNull().default('open'),
    outcome: text('outcome').$type<TaskOutcome>(),
    comment: text('comment'),
    completedBy: uuid('completed_by').references(() => participants.id),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.requestId),
    index().on(t.assigneeId, t.status),
    index().on(t.roleId, t.status),
    check('tasks_one_assignee', sql`num_nonnulls(${t.assigneeId}, ${t.roleId}) = 1`),
  ],
);

export const REQUEST_EVENT_TYPES = [
  'request.started',
  'task.created',
  'task.completed',
  'task.returned',
  'task.superseded',
  'step.auto_approved',
  'step.branch_chosen',
  'request.resubmitted',
  'request.withdrawn',
  'request.completed',
] as const;
export type RequestEventType = (typeof REQUEST_EVENT_TYPES)[number];

/** 指派給發起人 Manager 的 Task 改派給 Fallback Role 的原因：發起人沒有 Manager，或 Manager 已停用。 */
export const FALLBACK_REASONS = ['no_manager', 'manager_deactivated'] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

/** 稽核歷程：只能新增（資料庫 trigger 擋下 UPDATE 與 DELETE）。時間軸與「我的申請」直接讀這張表。 */
export const requestEvents = pgTable(
  'request_events',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id),
    type: text('type').$type<RequestEventType>().notNull(),
    /** 做這件事的人；系統事件（流轉、完成）為 null。 */
    actorId: uuid('actor_id').references(() => participants.id),
    taskId: uuid('task_id').references(() => tasks.id),
    comment: text('comment'),
    /** task.created：Task 因為找不到有效的 Manager 而改派給 Fallback Role 時的原因；其他情況為 null。 */
    fallbackReason: text('fallback_reason').$type<FallbackReason>(),
    /**
     * step.auto_approved：自動核准的審批節點；step.branch_chosen：做出判斷的條件節點。
     * 都是 Process Version 裡的節點 ID；這兩種事件沒有 Task。
     */
    nodeId: text('node_id'),
    /** step.branch_chosen：條件節點選中的出邊（Process Version 裡的連線 ID）。 */
    edgeId: text('edge_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.requestId, t.id)],
);

/**
 * Form 資料：依步驟（開始節點、填表節點）各存一列，只存在 Postgres，絕不進入 Temporal。
 * data 是依 Process Version 裡的 Form schema 驗證、正規化後的內容，鍵是欄位代碼。
 */
export const requestData = pgTable(
  'request_data',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id),
    nodeId: text('node_id').notNull(),
    /** 填寫時用的 Form（Process Version 快照裡的 id）。 */
    formId: text('form_id').notNull(),
    /** 填寫時 Request 的第幾輪；重新送出後先前每一輪的資料都保留。 */
    round: integer('round').notNull().default(1),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    submittedBy: uuid('submitted_by')
      .notNull()
      .references(() => participants.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.requestId, t.nodeId, t.round)],
);
