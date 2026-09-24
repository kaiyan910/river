import { PERMISSIONS } from '@river/auth';
import { DSL_ERROR_CODES, processDslSchema } from '@river/dsl';
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
