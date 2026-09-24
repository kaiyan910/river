import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PERMISSIONS } from '@river/auth';
import type {
  CreateParticipantCommand,
  DirectoryEntry,
  Participant,
  ParticipantStatus,
  SetPermissionsInput,
  UpdateParticipantInput,
} from '@river/contracts';
import {
  authAccounts,
  authUsers,
  type Database,
  participants,
  permissionGrants,
  roleMembers,
} from '@river/db';
import { and, asc, eq, inArray, notInArray, type SQL } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import type { ActiveParticipant } from '../auth/active-participant.js';
import type { Auth } from '../auth/create-auth.js';
import { AUTH, DATABASE } from '../tokens.js';
import { InvitationsService } from './invitations.service.js';
import { createParticipantAccount } from './provision-participant.js';

/** 已停用優先；否則有密碼（credential account）就是啟用，還沒設定密碼的是邀請中。 */
export function participantStatus(row: {
  deactivatedAt: Date | null;
  credentialId: string | null;
}): ParticipantStatus {
  if (row.deactivatedAt) return 'deactivated';
  return row.credentialId ? 'active' : 'invited';
}

@Injectable()
export class ParticipantsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AUTH) private readonly auth: Auth,
    private readonly invitations: InvitationsService,
    private readonly logger: Logger,
  ) {}

  list(): Promise<Participant[]> {
    return this.query();
  }

  /** 挑選人員用的精簡清單，不含 Permission 與 Role。 */
  async directory(): Promise<DirectoryEntry[]> {
    const people = await this.query();
    return people.map(({ id, name, email, status }) => ({ id, name, email, status }));
  }

  async get(id: string): Promise<Participant> {
    const [participant] = await this.query(eq(participants.id, id));
    if (!participant) throw new NotFoundException('找不到這位 Participant');
    return participant;
  }

  /** 建立 Participant 並寄出邀請信；對方點信中的連結設定密碼後才能登入。 */
  async create(input: CreateParticipantCommand, inviter: ActiveParticipant): Promise<Participant> {
    const [existing] = await this.db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.email, input.email));
    if (existing) throw new ConflictException('這個 email 已經有帳號');
    if (input.managerId) await this.assertAssignableManager(input.managerId);

    const { participantId, userId } = await createParticipantAccount(this.auth, this.db, input);
    try {
      await this.invitations.send(
        { id: userId, name: input.name, email: input.email },
        inviter.name,
      );
    } catch (error) {
      this.logger.error({ err: error, participantId }, '邀請信寄送失敗');
      throw new ServiceUnavailableException('帳號已建立，但邀請信寄送失敗，請稍後重寄邀請信');
    }
    return this.get(participantId);
  }

  async update(id: string, input: UpdateParticipantInput): Promise<Participant> {
    await this.get(id);
    if (input.managerId) {
      await this.assertAssignableManager(input.managerId);
      await this.assertNoManagerCycle(id, input.managerId);
    }
    await this.db
      .update(participants)
      .set({ managerId: input.managerId })
      .where(eq(participants.id, id));
    return this.get(id);
  }

  /** 以整份清單取代目前的 Permission；沒有變動的授予保留原本的授予時間。 */
  async setPermissions(
    id: string,
    { permissions }: SetPermissionsInput,
    actor: ActiveParticipant,
  ): Promise<Participant> {
    await this.get(id);
    if (id === actor.id && !permissions.includes('user.manage')) {
      throw new ConflictException('不能撤銷自己的 user.manage');
    }
    const wanted = PERMISSIONS.filter((p) => permissions.includes(p));
    await this.db.transaction(async (tx) => {
      await tx
        .delete(permissionGrants)
        .where(
          and(
            eq(permissionGrants.participantId, id),
            wanted.length ? notInArray(permissionGrants.permission, wanted) : undefined,
          ),
        );
      if (wanted.length) {
        await tx
          .insert(permissionGrants)
          .values(wanted.map((permission) => ({ participantId: id, permission })))
          .onConflictDoNothing();
      }
    });
    return this.get(id);
  }

  /** 重寄邀請信；只適用於還沒設定密碼的 Participant。 */
  async resendInvitation(id: string, inviter: ActiveParticipant): Promise<void> {
    const participant = await this.get(id);
    if (participant.status !== 'invited') {
      throw new ConflictException('這位 Participant 已經設定過密碼或已停用');
    }
    const [row] = await this.db
      .select({ userId: participants.userId })
      .from(participants)
      .where(eq(participants.id, id));
    if (!row) throw new NotFoundException('找不到這位 Participant');
    await this.invitations.send(
      { id: row.userId, name: participant.name, email: participant.email },
      inviter.name,
    );
  }

  private async assertAssignableManager(managerId: string) {
    const [manager] = await this.db
      .select({ deactivatedAt: participants.deactivatedAt })
      .from(participants)
      .where(eq(participants.id, managerId));
    if (!manager) throw new BadRequestException('找不到指定的 Manager');
    if (manager.deactivatedAt) throw new BadRequestException('Manager 已停用');
  }

  /** 從新的 Manager 往上走，走回自己就代表會形成循環。 */
  private async assertNoManagerCycle(id: string, managerId: string) {
    const rows = await this.db
      .select({ id: participants.id, managerId: participants.managerId })
      .from(participants);
    const managerOf = new Map(rows.map((r) => [r.id, r.managerId]));
    const seen = new Set<string>();
    for (let cur: string | null | undefined = managerId; cur; cur = managerOf.get(cur)) {
      if (cur === id) throw new BadRequestException('Manager 不能是自己，也不能形成循環');
      if (seen.has(cur)) break;
      seen.add(cur);
    }
  }

  private async query(where?: SQL): Promise<Participant[]> {
    const rows = await this.db
      .select({
        id: participants.id,
        name: authUsers.name,
        email: authUsers.email,
        managerId: participants.managerId,
        deactivatedAt: participants.deactivatedAt,
        credentialId: authAccounts.id,
      })
      .from(participants)
      .innerJoin(authUsers, eq(authUsers.id, participants.userId))
      .leftJoin(
        authAccounts,
        and(
          eq(authAccounts.userId, participants.userId),
          eq(authAccounts.providerId, 'credential'),
        ),
      )
      .where(where)
      .orderBy(asc(authUsers.name));
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [grants, memberships] = await Promise.all([
      this.db
        .select({
          participantId: permissionGrants.participantId,
          permission: permissionGrants.permission,
        })
        .from(permissionGrants)
        .where(inArray(permissionGrants.participantId, ids)),
      this.db
        .select({ participantId: roleMembers.participantId, roleId: roleMembers.roleId })
        .from(roleMembers)
        .where(inArray(roleMembers.participantId, ids)),
    ]);

    return rows.map((r) => {
      const held = new Set(grants.filter((g) => g.participantId === r.id).map((g) => g.permission));
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        status: participantStatus(r),
        managerId: r.managerId,
        permissions: [...held].sort(),
        roleIds: memberships.filter((m) => m.participantId === r.id).map((m) => m.roleId),
      };
    });
  }
}
