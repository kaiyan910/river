import type { MeResponse } from '@river/contracts';
import { authUsers, type Database, participants, permissionGrants } from '@river/db';
import { and, eq, isNull } from 'drizzle-orm';

export type ActiveParticipant = MeResponse;

/** 依 Better Auth 的 user id 找出仍在職（未停用）的 Participant 與其 Permission。 */
export async function findActiveParticipant(
  db: Database,
  userId: string,
): Promise<ActiveParticipant | undefined> {
  const [row] = await db
    .select({ id: participants.id, name: authUsers.name, email: authUsers.email })
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
