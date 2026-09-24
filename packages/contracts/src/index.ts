import { PERMISSIONS } from '@river/auth';
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
