import type { MeResponse } from '@river/contracts';
import { authUsers, type Database, participants, permissionGrants } from '@river/db';
import { and, eq, isNull } from 'drizzle-orm';

export type ActiveParticipant = MeResponse;

/**
 * 依 Better Auth 的 user id 找出仍在職（未停用）的 Participant 與其 Permission。
 * 每次請求都從資料庫讀取，不放在 session 裡快取，所以 Permission 撤銷、停用 TOTP 都在下一次呼叫就生效。
 */
export async function findActiveParticipant(
  db: Database,
  userId: string,
): Promise<ActiveParticipant | undefined> {
  const [row] = await db
    .select({
      id: participants.id,
      name: authUsers.name,
      email: authUsers.email,
      twoFactorEnabled: authUsers.twoFactorEnabled,
    })
    .from(participants)
    .innerJoin(authUsers, eq(authUsers.id, participants.userId))
    .where(and(eq(participants.userId, userId), isNull(participants.deactivatedAt)));
  if (!row) return undefined;

  const grants = await db
    .select({ permission: permissionGrants.permission })
    .from(permissionGrants)
    .where(eq(permissionGrants.participantId, row.id));
  return { ...row, permissions: grants.map((g) => g.permission).sort() };
}
