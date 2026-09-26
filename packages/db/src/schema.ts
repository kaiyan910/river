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
  /** Better Auth twoFactor plugin：TOTP 經過驗證碼確認後才會是 true。 */
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
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

/** Better Auth twoFactor plugin：TOTP secret 與備用碼（皆以 BETTER_AUTH_SECRET 加密）。 */
export const authTwoFactors = pgTable(
  'auth_two_factors',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    /** 還沒輸入驗證碼確認前為 false，這時登入不會要求 TOTP。 */
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [index('auth_two_factors_user_id_idx').on(t.userId)],
);

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

/**
 * Service Account：外部系統透過外部 API 發起 Request 用的非人類帳號，沒有 Manager。
 * API key 是高熵的隨機字串，只存 SHA-256 hash（明文只在發放、輪替時回傳一次）；輪替時直接換掉 hash，舊的 key 立即失效。
 */
export const serviceAccounts = pgTable('service_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  apiKeyHash: text('api_key_hash').notNull().unique(),
  /** key 的開頭幾個字元，只給人辨識用，不足以呼叫 API。 */
  apiKeyPrefix: text('api_key_prefix').notNull(),
  apiKeyIssuedAt: timestamp('api_key_issued_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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

/**
 * 排程發起：每個 Process 最多一個排程，時間到時以 initiator 為發起人、Process 的目前版本發起 Request。
 * 設定在 Process 上而不在 Process Version 裡，改了立刻生效；對應的 Temporal Schedule 和這一列一起建立、更新、刪除。
 */
export const processSchedules = pgTable('process_schedules', {
  processId: uuid('process_id')
    .primaryKey()
    .references(() => processes.id),
  /** 五個欄位的 cron（分 時 日 月 星期），以 timezone 解讀。 */
  cron: text('cron').notNull(),
  timezone: text('timezone').notNull(),
  initiatorId: uuid('initiator_id')
    .notNull()
    .references(() => participants.id),
  updatedBy: uuid('updated_by')
    .notNull()
    .references(() => participants.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Initiator Role：只有這些 Role 的成員可以發起這個 Process；一個 Process 沒有任何一列時，所有 Participant 都可以發起。
 * 設定在 Process 上而不在 Process Version 裡，改了立刻生效，不需要重新發佈。
 */
export const processInitiatorRoles = pgTable(
  'process_initiator_roles',
  {
    processId: uuid('process_id')
      .notNull()
      .references(() => processes.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.processId, t.roleId] })],
);

/** Observer Role：這些 Role 的成員可以查看這個 Process 的所有 Request。和 Initiator Role 一樣立刻生效。 */
export const processObserverRoles = pgTable(
  'process_observer_roles',
  {
    processId: uuid('process_id')
      .notNull()
      .references(() => processes.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.processId, t.roleId] }), index().on(t.roleId)],
);

/** Service Account 可以發起的 Process；沒有列在這裡的一律不能透過外部 API 發起。改了立刻生效。 */
export const serviceAccountProcesses = pgTable(
  'service_account_processes',
  {
    serviceAccountId: uuid('service_account_id')
      .notNull()
      .references(() => serviceAccounts.id),
    processId: uuid('process_id')
      .notNull()
      .references(() => processes.id),
  },
  (t) => [primaryKey({ columns: [t.serviceAccountId, t.processId] })],
);

/** 已發佈的 Process Version：只新增、不修改（資料庫 trigger 擋下 UPDATE 與 DELETE）。版本號最大的是目前版本。 */
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

/** returned：被 Return，等待發起人重新送出；completed、withdrawn、cancelled 是最終狀態。 */
export const REQUEST_STATUSES = [
  'running',
  'returned',
  'completed',
  'withdrawn',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/**
 * 一筆 Request 對應一個 Temporal workflow，workflow ID 等於 Request ID。發起時鎖定 Process Version。
 * 發起人通常是 Participant（initiatorId）；Service Account 透過外部 API 發起時記下 serviceAccountId，
 * 帶 on_behalf_of 時發起人是那位 Participant，沒有帶時 initiatorId 為 null，發起人就是 Service Account 本身。
 */
export const requests = pgTable(
  'requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 給人看的流水號，畫面顯示成 R-000042。 */
    number: integer('number').generatedAlwaysAsIdentity().notNull().unique(),
    processVersionId: uuid('process_version_id')
      .notNull()
      .references(() => processVersions.id),
    initiatorId: uuid('initiator_id').references(() => participants.id),
    serviceAccountId: uuid('service_account_id').references(() => serviceAccounts.id),
    title: text('title').notNull(),
    status: text('status').$type<RequestStatus>().notNull().default('running'),
    /** 第幾輪：發起時是 1，每次 Return 後重新送出加 1。Task 與 Form 資料都記下自己屬於哪一輪。 */
    round: integer('round').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.initiatorId),
    index().on(t.serviceAccountId),
    check(
      'requests_has_initiator',
      sql`num_nonnulls(${t.initiatorId}, ${t.serviceAccountId}) >= 1`,
    ),
  ],
);

/** superseded：因為 Return、Withdraw、Cancel、Reassign 或 Escalation 而作廢，不再需要處理。 */
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
    /**
     * Reassign 或 Escalation 建立的 Task 記下它取代的那個（已作廢的）Task；一路往回追就是這一步的改派歷程。
     * 流程走到這一步時建立的 Task 為 null。
     */
    replacesTaskId: uuid('replaces_task_id').references((): AnyPgColumn => tasks.id),
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
  'task.reminded',
  'task.escalated',
  'task.reassigned',
  'step.auto_approved',
  'step.branch_chosen',
  'step.email_sent',
  'step.http_sent',
  'step.http_failed',
  'request.resubmitted',
  'request.retried',
  'request.withdrawn',
  'request.cancelled',
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
    /**
     * task.created、task.escalated：Task 因為找不到有效的 Manager 而改派給 Fallback Role 時的原因；其他情況為 null。
     * task.escalated 的 taskId 是 Escalation 後新建立的 Task（原 Task 已經 superseded）。
     */
    fallbackReason: text('fallback_reason').$type<FallbackReason>(),
    /**
     * step.auto_approved：自動核准的審批節點；step.branch_chosen：做出判斷的條件節點；
     * step.email_sent：寄出信件的 Email 節點；step.http_sent、step.http_failed：呼叫成功、重試全部失敗的 HTTP 節點。
     * 都是 Process Version 裡的節點 ID；這幾種事件沒有 Task。
     * step.http_failed 表示 Request 暫停，等 Administrator 重試（request.retried）或 Cancel；
     * comment 是失敗原因（例如 HTTP 狀態碼），不含秘密、body 或回應內容。
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
    /** 填寫的 Participant；Service Account 沒有代表任何人發起時，開始表單的這一列為 null（由該 Service Account 送出）。 */
    submittedBy: uuid('submitted_by').references(() => participants.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.requestId, t.nodeId, t.round)],
);

/**
 * 附件：檔案存在 S3 相容的 object storage（Garage），這裡只記錄中繼資料。
 * 瀏覽器先向 API 取得 presigned 上傳 URL，再直接上傳；送出表單時 API 確認檔案已上傳，才把附件綁到 Request。
 * request_id 為 null 代表還沒隨表單送出，只有上傳的人可以下載；綁定後看得到該 Request 的人才能下載。
 * 檔案內容與下載 URL 都不進入 Temporal。
 */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** bucket 裡的 object key。 */
    storageKey: text('storage_key').notNull().unique(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    /** bytes；上傳 URL 簽入這個大小，送出表單時再和實際上傳的 object 比對。 */
    size: bigint('size', { mode: 'number' }).notNull(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => participants.id),
    requestId: uuid('request_id').references(() => requests.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** 送出表單時確認 object 已上傳（大小相符）的時間。 */
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
  },
  (t) => [index().on(t.requestId), index().on(t.uploadedBy)],
);

// ─── Credential ───────────────────────────────────────────────────────────

/**
 * 秘密送出的方式：bearer 放在 `Authorization: Bearer <秘密>`；header 放在 headerName 指定的 header（例如 X-API-Key）。
 */
export const CREDENTIAL_SCHEMES = ['bearer', 'header'] as const;
export type CredentialScheme = (typeof CREDENTIAL_SCHEMES)[number];

/**
 * 集中管理的外部系統憑證。HTTP 節點只以 name 引用，所以名稱建立後不能改。
 * secret 是 AES-256-GCM 加密後的內容（見 credential-cipher.ts），只有 httpRequest activity 在執行時解密；
 * API 只寫入、永遠不回傳。輪替只換 secret，Process 不需要重新發佈。
 */
export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull().unique(),
    scheme: text('scheme').$type<CredentialScheme>().notNull(),
    /** scheme 是 header 時的 header 名稱；bearer 時為 null。 */
    headerName: text('header_name'),
    secret: text('secret').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => participants.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** 最後一次輪替秘密的人與時間；建立時與 createdBy、createdAt 相同。 */
    rotatedBy: uuid('rotated_by')
      .notNull()
      .references(() => participants.id),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('credentials_header_name', sql`(${t.scheme} = 'header') = (${t.headerName} is not null)`),
  ],
);
