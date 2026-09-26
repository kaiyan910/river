import { PERMISSIONS } from '@river/auth';
import { branchSchema, DSL_ERROR_CODES, processDslSchema } from '@river/dsl';
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

/** `POST /api/participants/import`：以 CSV 一次匯入多位 Participant 與他們的 Manager。 */
export const importParticipantsSchema = z.object({
  /** CSV 檔的完整內容。第一行是標題列，需要姓名、email、Manager 的 email 三個欄位。 */
  csv: z.string().min(1).max(1_000_000),
});
export type ImportParticipantsInput = z.infer<typeof importParticipantsSchema>;

/**
 * CSV 匯入某一行失敗的原因。
 * invalid_format：格式錯誤（欄位數、姓名、email、引號）；duplicate_email：檔案裡有其他行用了同一個 email；
 * email_taken：這個 email 已經有帳號；manager_not_found：Manager 不在檔案裡，也不是現有的 Participant；
 * manager_deactivated：Manager 已停用；manager_cycle：Manager 關係形成循環；
 * manager_failed：Manager 在檔案裡，但那一行沒有匯入；create_failed：建立帳號時發生錯誤。
 */
export const IMPORT_FAILURE_CODES = [
  'invalid_format',
  'duplicate_email',
  'email_taken',
  'manager_not_found',
  'manager_deactivated',
  'manager_cycle',
  'manager_failed',
  'create_failed',
] as const;
export type ImportFailureCode = (typeof IMPORT_FAILURE_CODES)[number];

export const importParticipantsResultSchema = z.object({
  imported: z.array(
    z.object({
      /** CSV 的行號（從 1 起算，標題列是第 1 行）。 */
      line: z.number().int(),
      participantId: z.string(),
      name: z.string(),
      email: z.email(),
      managerId: z.string().nullable(),
      /** 邀請信寄送失敗時為 false，帳號仍然建立，之後可以重寄。 */
      invitationSent: z.boolean(),
    }),
  ),
  failed: z.array(
    z.object({
      line: z.number().int(),
      /** 格式錯誤、讀不出 email 時為 null。 */
      email: z.string().nullable(),
      code: z.enum(IMPORT_FAILURE_CODES),
      /** 給 Administrator 看的原因說明。 */
      message: z.string(),
    }),
  ),
});
export type ImportParticipantsResult = z.infer<typeof importParticipantsResultSchema>;

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

/** `GET /api/roles/directory`：Designer 指派人工步驟時挑選 Role 用的精簡清單。 */
export const roleDirectoryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  memberCount: z.number().int().nonnegative(),
});
export type RoleDirectoryEntry = z.infer<typeof roleDirectoryEntrySchema>;
export const roleDirectorySchema = z.array(roleDirectoryEntrySchema);

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

/** `GET /api/participants/search?q=`：Form 的人員選擇器用；依姓名或 email 搜尋。 */
export const personSearchQuerySchema = z.object({ q: z.string().trim().max(100).default('') });
export type PersonSearchQuery = z.infer<typeof personSearchQuerySchema>;

/** 人員選擇器的一個候選人：沒有停用的 Participant，不含 Permission、Role 與 Manager。 */
export const personOptionSchema = z.object({ id: z.string(), name: z.string(), email: z.email() });
export type PersonOption = z.infer<typeof personOptionSchema>;
export const personOptionListSchema = z.array(personOptionSchema);

// ─── Process ─────────────────────────────────────────────────────────────

const actorSchema = z.object({ id: z.string(), name: z.string() });

/** 人工步驟或 Task 的指派對象：特定 Participant，或一個 Role（id、name 是 Role 的）。 */
export const assigneeRefSchema = actorSchema.extend({ type: z.enum(['participant', 'role']) });
export type AssigneeRef = z.infer<typeof assigneeRefSchema>;

/**
 * 流程預覽裡人工步驟的指派對象：特定 Participant、Role，或發起人的 Manager。
 * Manager 在建立 Task 時才決定是誰，所以預覽只帶 Fallback Role。
 */
export const stepAssigneeSchema = z.union([
  assigneeRefSchema,
  z.object({ type: z.literal('manager'), fallbackRole: actorSchema.nullable() }),
]);
export type StepAssignee = z.infer<typeof stepAssigneeSchema>;

export const dslErrorSchema = z.object({
  nodeId: z.string().nullable(),
  code: z.enum(DSL_ERROR_CODES),
  message: z.string(),
  /** 條件節點出邊的錯誤才有：哪一條出邊。 */
  edgeId: z.string().optional(),
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

/** `GET /api/processes/:id`；`POST /api/processes/:id/draft`（從目前版本建立新草稿）也回傳它。draft 為 null 代表目前版本之後沒有改動。 */
export const processSchema = z.object({
  id: z.string(),
  name: z.string(),
  draft: processDraftSchema.nullable(),
  /** 目前版本（最新發佈的版本）；還沒發佈過時為 null。 */
  currentVersion: z.number().int().positive().nullable(),
  /** 依版本號由小到大。 */
  versions: z.array(processVersionSchema),
  /** 只有這些 Role 的成員可以發起；空陣列代表所有 Participant 都可以發起。 */
  initiatorRoles: z.array(actorSchema),
  /** 這些 Role 的成員可以查看這個 Process 的所有 Request。 */
  observerRoles: z.array(actorSchema),
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

/**
 * `PUT /api/processes/:id/access`：設定 Initiator Role 與 Observer Role（以整份取代）。
 * 設定在 Process 上，不需要發佈，立刻生效。
 */
export const processAccessSchema = z.object({
  initiatorRoleIds: z.array(z.uuid()).max(100),
  observerRoleIds: z.array(z.uuid()).max(100),
});
export type ProcessAccessInput = z.infer<typeof processAccessSchema>;

/** 草稿沒有通過發佈前檢查時，發佈回 422 與這個內容；errors 與前端即時檢查的結果相同。 */
export const publishRejectedSchema = z.object({
  message: z.string(),
  errors: z.array(dslErrorSchema),
});
export type PublishRejected = z.infer<typeof publishRejectedSchema>;

// ─── 入口網站：發起 Request ──────────────────────────────────────────────

/** 流程預覽的一步：依流程順序排列，條件分支上的步驟都列出（條件節點本身不列）。審批與填表節點帶處理人，開始與填表節點帶 Form。 */
export const processStepSchema = z.object({
  nodeId: z.string(),
  type: z.enum(['start', 'form', 'approval', 'end']),
  name: z.string(),
  assignee: stepAssigneeSchema.nullable(),
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

/**
 * 唯讀的流程圖：節點只帶畫圖需要的欄位（處理人等細節在 steps），連線帶條件節點出邊的條件。
 * position 沿用 Designer 畫布上的位置。
 */
export const processFlowSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.enum([
        'start',
        'form',
        'approval',
        'condition',
        'parallelSplit',
        'parallelJoin',
        'email',
        'end',
      ]),
      name: z.string(),
      position: z.object({ x: z.number(), y: z.number() }),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      branch: branchSchema.nullable(),
    }),
  ),
});
export type ProcessFlow = z.infer<typeof processFlowSchema>;

// ─── Request 與 Task ─────────────────────────────────────────────────────

/** returned：被 Return，等待發起人修改後重新送出；completed、withdrawn、cancelled 是最終狀態。 */
export const requestStatusSchema = z.enum([
  'running',
  'returned',
  'completed',
  'withdrawn',
  'cancelled',
]);
export type RequestStatus = z.infer<typeof requestStatusSchema>;

/** superseded：因為 Return、Withdraw、Cancel、Reassign 或 Escalation 而作廢，不再需要處理。 */
export const taskStatusSchema = z.enum(['open', 'completed', 'superseded']);
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
const pendingTaskSchema = z.object({
  id: z.string(),
  nodeName: z.string(),
  assignee: assigneeRefSchema,
});

/** `GET /api/requests/mine`、`GET /api/requests` 的一列。 */
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
  /** status 是 returned 時：誰在哪一步 Return、意見是什麼；其他狀態為 null。 */
  returned: z
    .object({
      by: actorSchema,
      nodeName: z.string(),
      comment: z.string(),
      at: z.iso.datetime(),
    })
    .nullable(),
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
  /** 指派給 Role 時任一成員都可以處理，實際處理的人看 completedBy。 */
  assignee: assigneeRefSchema,
  status: taskStatusSchema,
  /** 審批 Task 核准後是 approved、Return 後是 returned；填表 Task 送出後是 submitted。 */
  outcome: z.enum(['approved', 'returned', 'submitted']).nullable(),
  comment: z.string().nullable(),
  completedBy: actorSchema.nullable(),
  completedAt: z.iso.datetime().nullable(),
  /** 樂觀鎖版本號；完成 Task 時要帶上看到的版本。 */
  version: z.number().int().positive(),
  /** 建立時 Request 的第幾輪。 */
  round: z.number().int().positive(),
  /** Reassign 建立的 Task：它取代的那個（已作廢的）Task；其他為 null。 */
  replacesTaskId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type RequestTask = z.infer<typeof requestTaskSchema>;

export const requestEventTypeSchema = z.enum([
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
  'request.resubmitted',
  'request.withdrawn',
  'request.cancelled',
  'request.completed',
]);
export type RequestEventType = z.infer<typeof requestEventTypeSchema>;

/** 指派給發起人 Manager 的 Task 改派給 Fallback Role 的原因。 */
export const fallbackReasonSchema = z.enum(['no_manager', 'manager_deactivated']);
export type FallbackReason = z.infer<typeof fallbackReasonSchema>;

/** 時間軸的一列，直接對應一筆 request_event。 */
export const requestEventSchema = z.object({
  id: z.number().int(),
  type: requestEventTypeSchema,
  at: z.iso.datetime(),
  /** 做這件事的人；系統事件（流轉、完成）為 null。 */
  actor: actorSchema.nullable(),
  task: z
    .object({
      id: z.string(),
      nodeName: z.string(),
      kind: taskKindSchema,
      assignee: assigneeRefSchema,
    })
    .nullable(),
  comment: z.string().nullable(),
  /**
   * task.created：發起人沒有 Manager 或 Manager 已停用，Task 改派給 Fallback Role 時的原因；
   * task.escalated：處理人沒有 Manager 或 Manager 已停用，Escalation 改轉給 Fallback Role 時的原因；其他為 null。
   * task.reminded 的 task 是被提醒的 Task；task.escalated 的 task 是 Escalation 後新建立的 Task（原 Task 已作廢）。
   */
  fallbackReason: fallbackReasonSchema.nullable(),
  /**
   * step.auto_approved：自動核准的審批步驟；step.branch_chosen：做出判斷的條件節點；step.email_sent：寄出信件的 Email 節點。
   * 這幾種事件沒有 Task；其他為 null。不含自動核准的條件，也不含收件人與信件內容。
   */
  node: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** step.branch_chosen：條件節點選中的出邊、它的條件，以及走向的節點；其他為 null。 */
  edge: z
    .object({
      id: z.string(),
      branch: branchSchema.nullable(),
      target: z.object({ id: z.string(), name: z.string() }),
    })
    .nullable(),
});
export type RequestEvent = z.infer<typeof requestEventSchema>;

/** 某一步填寫的 Form 資料（request_data 的一列）。 */
export const requestDataSectionSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  formId: z.string(),
  data: formDataSchema,
  /** 這一步的人員選擇器（包括明細表裡的）選到的人，唯讀顯示姓名用。 */
  people: z.array(actorSchema),
  submittedBy: actorSchema,
  submittedAt: z.iso.datetime(),
});
export type RequestDataSection = z.infer<typeof requestDataSectionSchema>;

/** `GET /api/requests/:id`：發起人與經手的審批人、填表人可以查看。 */
export const requestDetailSchema = requestSummarySchema.extend({
  /** 第幾輪：發起時是 1，每次 Return 後重新送出加 1。 */
  round: z.number().int().positive(),
  /** 發起時鎖定的 Process Version 的流程預覽。 */
  steps: z.array(processStepSchema),
  /** 同一個 Process Version 的流程圖（含條件節點與連線），用來畫出實際走過的路徑與完整流程圖。 */
  flow: processFlowSchema,
  /** Process Version 裡有節點使用的 Form（顯示資料與填表 Task 用）。 */
  forms: z.array(formSchema),
  /** 這一輪已經填寫的 Form 資料，依填寫順序；先前每一輪的資料保留在資料庫，不在這裡顯示。 */
  data: z.array(requestDataSectionSchema),
  /** 每一輪的 Task，依建立時間排序。 */
  tasks: z.array(requestTaskSchema),
  /** 依發生順序排序。 */
  events: z.array(requestEventSchema),
});
export type RequestDetail = z.infer<typeof requestDetailSchema>;

/**
 * `GET /api/tasks/mine?status=open|completed`：「我的待辦」的一列。
 * open：指派給我，或指派給我所屬 Role 的 Task；completed：我處理過的 Task。
 */
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

/** 作廢（superseded）的 Task 不會出現在「我的待辦」。 */
export const myTasksQuerySchema = z.object({
  status: z.enum(['open', 'completed']).default('open'),
});
export type MyTasksStatus = z.infer<typeof myTasksQuerySchema>['status'];

/**
 * `POST /api/tasks/:id/complete`：核准或 Return 審批 Task（approved / returned），
 * 或送出填表 Task 的 Form 資料（submitted）。Return 一定要填意見，讓發起人知道要修改什麼。
 * version 是畫面上看到的 Task 版本（樂觀鎖）。outcome 要和 Task 的類型相符。
 */
export const completeTaskSchema = z
  .object({
    outcome: z.enum(['approved', 'returned', 'submitted']),
    version: z.number().int().positive(),
    comment: z.string().trim().max(2000).optional(),
    /** 填表 Task 的 Form 資料。 */
    data: formDataSchema.optional(),
  })
  .refine((v) => v.outcome !== 'returned' || !!v.comment, {
    path: ['comment'],
    message: 'Return 時必須填寫意見',
  });
export type CompleteTaskInput = z.input<typeof completeTaskSchema>;
export type CompleteTaskCommand = z.output<typeof completeTaskSchema>;

/**
 * `POST /api/requests/:id/resubmit`：發起人修改被 Return 的 Request 後重新送出。
 * 內容與發起時相同（標題與開始表單的資料），送出後從 Process 的開頭重新開始。
 */
export const resubmitRequestSchema = startRequestSchema.omit({ processId: true });
export type ResubmitRequestInput = z.infer<typeof resubmitRequestSchema>;

/** `POST /api/requests/:id/withdraw`：發起人在 Request 完成之前撤回；原因選填，會顯示在時間軸。 */
export const withdrawRequestSchema = z.object({
  comment: z.string().trim().max(2000).optional(),
});
export type WithdrawRequestInput = z.infer<typeof withdrawRequestSchema>;

// ─── 例外處理：Cancel、Reassign、停用帳號 ────────────────────────────────

/** `POST /api/requests/:id/cancel`：Administrator 強制終止尚未完成的 Request；原因必填，會顯示在時間軸。 */
export const cancelRequestSchema = z.object({
  comment: z.string().trim().min(1, 'Cancel 時必須填寫原因').max(2000),
});
export type CancelRequestInput = z.infer<typeof cancelRequestSchema>;

/**
 * `POST /api/tasks/:id/reassign`：把 open 的 Task 改派給另一位 Participant。
 * 原 Task 作廢，為新的處理人建立新的 Task，回傳新的 Task。原因選填，會顯示在時間軸。
 */
export const reassignTaskSchema = z.object({
  assigneeId: z.uuid(),
  comment: z.string().trim().max(2000).optional(),
});
export type ReassignTaskInput = z.infer<typeof reassignTaskSchema>;

/**
 * `GET /api/tasks/pending-reassign`：「待 Reassign」清單，直接指派給已停用 Participant 的 open Task。
 * 每一列和「我的待辦」相同。
 */
export const pendingReassignListSchema = myTaskListSchema;

/** `GET /api/participants/:id/deactivation-impact`：停用前預覽影響範圍。 */
export const deactivationImpactSchema = z.object({
  /** 直接指派給此人的 open Task；停用後會進入「待 Reassign」清單。指派給 Role 的不算，其他成員仍可處理。 */
  openTasks: myTaskListSchema,
  /** 以此人為 Manager 的 Participant；停用後指派給他們 Manager 的步驟改派給 Fallback Role。 */
  directReports: directorySchema,
});
export type DeactivationImpact = z.infer<typeof deactivationImpactSchema>;
export * from './attachments.js';
