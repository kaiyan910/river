import { Inject, Injectable } from '@nestjs/common';
import type { MeResponse } from '@river/contracts';
import { authUsers, type Database, participants, permissionGrants } from '@river/db';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../tokens.js';

@Injectable()
export class ParticipantsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** 依 Better Auth 的 user id 找出仍在職（未停用）的 Participant。 */
  async findActiveByUserId(userId: string): Promise<MeResponse | undefined> {
    const [row] = await this.db
      .select({ id: participants.id, name: authUsers.name, email: authUsers.email })
      .from(participants)
      .innerJoin(authUsers, eq(authUsers.id, participants.userId))
      .where(and(eq(participants.userId, userId), isNull(participants.deactivatedAt)));
    if (!row) return undefined;

    const grants = await this.db
      .select({ permission: permissionGrants.permission })
      .from(permissionGrants)
      .where(eq(permissionGrants.participantId, row.id));
    return { ...row, permissions: grants.map((g) => g.permission).sort() };
  }
}
