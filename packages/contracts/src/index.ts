import { PERMISSIONS } from '@river/auth';
import { DSL_ERROR_CODES, processDslSchema } from '@river/dsl';
import { formSchema } from '@river/forms';
import { z } from 'zod';

/** `GET /api/me`：目前登入的 Participant。 */
export const meResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  permissions: z.array(z.enum(PERMISSIONS)),
});

export type MeResponse = z.infer<typeof meResponseSchema>;

const permissionList = z.array(z.enum(PERMISSIONS));

// ─── Participant ─────────────────────────────────────────────────────────

/** invited：已建立、還沒透過邀請信設定密碼；deactivated：已停用。 */
export const participantStatusSchema = z.enum(['active', 'invited', 'deactivated']);
export type ParticipantStatus = z.infer<typeof participantStatusSchema>;

export const participantSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  status: participantStatusSchema,
  managerId: z.string().nullable(),
  permissions: permissionList,
  /** 所屬 Role 的 id。 */
  roleIds: z.array(z.string()),
});
export type Participant = z.infer<typeof participantSchema>;

/** `GET /api/participants` */
export const participantListSchema = z.array(participantSchema);

/** `POST /api/participants`：建立 Participant 並寄出邀請信。 */
export const createParticipantSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().transform((v) => v.toLowerCase()),
  managerId: z.string().nullable().default(null),
  permissions: permissionList.default([]),
});
export type CreateParticipantInput = z.input<typeof createParticipantSchema>;
export type CreateParticipantCommand = z.output<typeof createParticipantSchema>;

/** `PATCH /api/participants/:id` */
export const updateParticipantSchema = z.object({
  managerId: z.string().nullable(),
});
export type UpdateParticipantInput = z.infer<typeof updateParticipantSchema>;

/** `PUT /api/participants/:id/permissions`：以整份清單取代目前的 Permission。 */
export const setPermissionsSchema = z.object({ permissions: permissionList });
export type SetPermissionsInput = z.infer<typeof setPermissionsSchema>;

// ─── 邀請 ────────────────────────────────────────────────────────────────

/** 邀請連結的有效時間；信件內容與設定密碼頁的說明都以它為準。 */
export const INVITATION_EXPIRES_IN_HOURS = 72;

/** `GET /api/invitations/:token`：設定密碼頁顯示的資訊。連結失效時回 404。 */
export const invitationSchema = z.object({ name: z.string(), email: z.email() });
export type Invitation = z.infer<typeof invitationSchema>;

// ─── Role ────────────────────────────────────────────────────────────────

export const roleMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  status: participantStatusSchema,
});

export const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  members: z.array(roleMemberSchema),
});
export type Role = z.infer<typeof roleSchema>;

/** `GET /api/roles` */
export const roleListSchema = z.array(roleSchema);

/** `POST /api/roles`、`PATCH /api/roles/:id` */
export const roleNameSchema = z.object({ name: z.string().trim().min(1).max(100) });
export type RoleNameInput = z.infer<typeof roleNameSchema>;

/** `GET /api/participants/directory`：挑選人員用的精簡清單（例如 Designer 指派審批人），不含 Permission 與 Role。 */
export const directoryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  status: participantStatusSchema,
});
export type DirectoryEntry = z.infer<typeof directoryEntrySchema>;
export const directorySchema = z.array(directoryEntrySchema);

// ─── Process ─────────────────────────────────────────────────────────────

const actorSchema = z.object({ id: z.string(), name: z.string() });

export const dslErrorSchema = z.object({
  nodeId: z.string().nullable(),
  code: z.enum(DSL_ERROR_CODES),
  message: z.string(),
  /** Form 本身的錯誤才有：哪一份 Form、哪個欄位。 */
  formId: z.string().optional(),
  fieldId: z.string().nullable().optional(),
});

/** 已發佈、不可修改的 Process Version。version 從 1 開始遞增。 */
export const processVersionSchema = z.object({
  version: z.number().int().positive(),
  note: z.string(),
  publishedAt: z.iso.datetime(),
  publishedBy: actorSchema,
  dsl: processDslSchema,
});
export type ProcessVersion = z.infer<typeof processVersionSchema>;

export const processDraftSchema = z.object({
  dsl: processDslSchema,
  savedAt: z.iso.datetime(),
  savedBy: actorSchema,
});
export type ProcessDraft = z.infer<typeof processDraftSchema>;

/** `GET /api/processes/:id`。draft 為 null 代表目前版本之後沒有改動。 */
export const processSchema = z.object({
  id: z.string(),
  name: z.string(),
  draft: processDraftSchema.nullable(),
  /** 目前版本（最新發佈的版本）；還沒發佈過時為 null。 */
  currentVersion: z.number().int().positive().nullable(),
  /** 依版本號由小到大。 */
  versions: z.array(processVersionSchema),
});
export type Process = z.infer<typeof processSchema>;

export const processSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  currentVersion: z.number().int().positive().nullable(),
  draftSavedAt: z.iso.datetime().nullable(),
});
export type ProcessSummary = z.infer<typeof processSummarySchema>;

/** `GET /api/processes` */
export const processListSchema = z.array(processSummarySchema);

/** `POST /api/processes`（建立只有開始與結束的草稿）、`PATCH /api/processes/:id` */
export const processNameSchema = z.object({ name: z.string().trim().min(1).max(100) });
export type ProcessNameInput = z.infer<typeof processNameSchema>;

/** `PUT /api/processes/:id/draft`：以整份 DSL 取代草稿。只驗證格式，發佈前檢查的錯誤不會擋下儲存。 */
export const saveDraftSchema = z.object({ dsl: processDslSchema });
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

/** `POST /api/processes/:id/versions`：把已儲存的草稿發佈成新的 Process Version。 */
export const publishProcessSchema = z.object({ note: z.string().trim().max(200).default('') });
export type PublishProcessInput = z.input<typeof publishProcessSchema>;

/** 草稿沒有通過發佈前檢查時，發佈回 422 與這個內容；errors 與前端即時檢查的結果相同。 */
export const publishRejectedSchema = z.object({
  message: z.string(),
  errors: z.array(dslErrorSchema),
});
export type PublishRejected = z.infer<typeof publishRejectedSchema>;

// ─── 入口網站：發起 Request ──────────────────────────────────────────────

/** 流程預覽的一步：從「開始」沿著連線走到「結束」。審批與填表節點帶處理人，開始與填表節點帶 Form。 */
export const processStepSchema = z.object({
  nodeId: z.string(),
  type: z.enum(['start', 'form', 'approval', 'end']),
  name: z.string(),
  assignee: actorSchema.nullable(),
  formId: z.string().nullable(),
});
export type ProcessStep = z.infer<typeof processStepSchema>;

/** `GET /api/processes/startable`：目前登入的 Participant 可以發起的 Process（已發佈的目前版本）。 */
export const startableProcessSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int().positive(),
  steps: z.array(processStepSchema),
  /** 開始表單；沒有時發起人只填標題。 */
  startForm: formSchema.nullable(),
});
export type StartableProcess = z.infer<typeof startableProcessSchema>;
export const startableProcessListSchema = z.array(startableProcessSchema);

// ─── Request 與 Task ─────────────────────────────────────────────────────

export const requestStatusSchema = z.enum(['running', 'completed']);
export type RequestStatus = z.infer<typeof requestStatusSchema>;

export const taskStatusSchema = z.enum(['open', 'completed']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** Form 資料：鍵是欄位代碼。內容由 API 依 Process Version 裡的 Form schema 驗證。 */
export const formDataSchema = z.record(z.string(), z.unknown());
export type FormDataInput = z.infer<typeof formDataSchema>;

/** `POST /api/requests`：以 Process 的目前版本發起 Request。有開始表單時 data 是開始表單的資料。 */
export const startRequestSchema = z.object({
  processId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  data: formDataSchema.optional(),
});
export type StartRequestInput = z.infer<typeof startRequestSchema>;

/** Form 資料沒有通過驗證時，發起或送出填表 Task 回 422 與這個內容；鍵是欄位代碼。 */
export const formRejectedSchema = z.object({
  message: z.string(),
  errors: z.record(z.string(), z.string()),
});
export type FormRejected = z.infer<typeof formRejectedSchema>;

const requestProcessSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** 發起時鎖定的 Process Version。 */
  version: z.number().int().positive(),
});

/** Request 目前在等的 Task；清單上的「目前步驟」。 */
const pendingTaskSchema = z.object({ id: z.string(), nodeName: z.string(), assignee: actorSchema });

/** `GET /api/requests/mine` 的一列。 */
export const requestSummarySchema = z.object({
  id: z.string(),
  /** 給人看的流水號，畫面顯示成 R-000042。 */
  number: z.number().int().positive(),
  title: z.string(),
  status: requestStatusSchema,
  process: requestProcessSchema,
  initiator: actorSchema,
  /** running 卻沒有 open Task 時，代表 workflow 正在往下一步走（畫面顯示「處理中」）。 */
  openTasks: z.array(pendingTaskSchema),
  createdAt: z.iso.datetime(),
  /** 最後一筆 request_event 的時間。 */
  updatedAt: z.iso.datetime(),
});
export type RequestSummary = z.infer<typeof requestSummarySchema>;
export const requestSummaryListSchema = z.array(requestSummarySchema);

export const taskKindSchema = z.enum(['approval', 'form']);
export type TaskKind = z.infer<typeof taskKindSchema>;

export const requestTaskSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  nodeName: z.string(),
  /** 審批或填表。 */
  kind: taskKindSchema,
  assignee: actorSchema,
  status: taskStatusSchema,
  /** 審批 Task 核准後是 approved，填表 Task 送出後是 submitted。 */
  outcome: z.enum(['approved', 'submitted']).nullable(),
  comment: z.string().nullable(),
  completedBy: actorSchema.nullable(),
  completedAt: z.iso.datetime().nullable(),
  /** 樂觀鎖版本號；完成 Task 時要帶上看到的版本。 */
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export type RequestTask = z.infer<typeof requestTaskSchema>;

export const requestEventTypeSchema = z.enum([
  'request.started',
  'task.created',
  'task.completed',
  'request.completed',
]);
export type RequestEventType = z.infer<typeof requestEventTypeSchema>;

/** 時間軸的一列，直接對應一筆 request_event。 */
export const requestEventSchema = z.object({
  id: z.number().int(),
  type: requestEventTypeSchema,
  at: z.iso.datetime(),
  /** 做這件事的人；系統事件（流轉、完成）為 null。 */
  actor: actorSchema.nullable(),
  task: z
    .object({ id: z.string(), nodeName: z.string(), kind: taskKindSchema, assignee: actorSchema })
    .nullable(),
  comment: z.string().nullable(),
});
export type RequestEvent = z.infer<typeof requestEventSchema>;

/** 某一步填寫的 Form 資料（request_data 的一列）。 */
export const requestDataSectionSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  formId: z.string(),
  data: formDataSchema,
  submittedBy: actorSchema,
  submittedAt: z.iso.datetime(),
});
export type RequestDataSection = z.infer<typeof requestDataSectionSchema>;

/** `GET /api/requests/:id`：發起人與經手的審批人、填表人可以查看。 */
export const requestDetailSchema = requestSummarySchema.extend({
  /** 發起時鎖定的 Process Version 的流程預覽。 */
  steps: z.array(processStepSchema),
  /** Process Version 裡有節點使用的 Form（顯示資料與填表 Task 用）。 */
  forms: z.array(formSchema),
  /** 已經填寫的 Form 資料，依填寫順序。 */
  data: z.array(requestDataSectionSchema),
  /** 依建立時間排序。 */
  tasks: z.array(requestTaskSchema),
  /** 依發生順序排序。 */
  events: z.array(requestEventSchema),
});
export type RequestDetail = z.infer<typeof requestDetailSchema>;

/** `GET /api/tasks/mine?status=open|completed`：「我的待辦」的一列。 */
export const myTaskSchema = requestTaskSchema.extend({
  request: requestSummarySchema.pick({
    id: true,
    number: true,
    title: true,
    status: true,
    process: true,
    initiator: true,
  }),
});
export type MyTask = z.infer<typeof myTaskSchema>;
export const myTaskListSchema = z.array(myTaskSchema);

export const myTasksQuerySchema = z.object({ status: taskStatusSchema.default('open') });

/**
 * `POST /api/tasks/:id/complete`：核准審批 Task（approved），或送出填表 Task 的 Form 資料（submitted）。
 * version 是畫面上看到的 Task 版本（樂觀鎖）。outcome 要和 Task 的類型相符。
 */
export const completeTaskSchema = z.object({
  outcome: z.enum(['approved', 'submitted']),
  version: z.number().int().positive(),
  comment: z.string().trim().max(2000).optional(),
  /** 填表 Task 的 Form 資料。 */
  data: formDataSchema.optional(),
});
export type CompleteTaskInput = z.input<typeof completeTaskSchema>;
export type CompleteTaskCommand = z.output<typeof completeTaskSchema>;
