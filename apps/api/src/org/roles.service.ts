import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Role } from '@river/contracts';
import {
  authAccounts,
  authUsers,
  type Database,
  participants,
  roleMembers,
  roles,
} from '@river/db';
import { and, asc, eq } from 'drizzle-orm';
import { DATABASE } from '../tokens.js';
import { participantStatus } from './participants.service.js';

@Injectable()
export class RolesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(): Promise<Role[]> {
    const [allRoles, members] = await Promise.all([
      this.db.select({ id: roles.id, name: roles.name }).from(roles).orderBy(asc(roles.name)),
      this.db
        .select({
          roleId: roleMembers.roleId,
          id: participants.id,
          name: authUsers.name,
          email: authUsers.email,
          deactivatedAt: participants.deactivatedAt,
          credentialId: authAccounts.id,
        })
        .from(roleMembers)
        .innerJoin(participants, eq(participants.id, roleMembers.participantId))
        .innerJoin(authUsers, eq(authUsers.id, participants.userId))
        .leftJoin(
          authAccounts,
          and(
            eq(authAccounts.userId, participants.userId),
            eq(authAccounts.providerId, 'credential'),
          ),
        )
        .orderBy(asc(roleMembers.addedAt)),
    ]);
    return allRoles.map((role) => ({
      ...role,
      members: members
        .filter((m) => m.roleId === role.id)
        .map((m) => ({ id: m.id, name: m.name, email: m.email, status: participantStatus(m) })),
    }));
  }

  async get(id: string): Promise<Role> {
    const role = (await this.list()).find((r) => r.id === id);
    if (!role) throw new NotFoundException('找不到這個 Role');
    return role;
  }

  async create(name: string): Promise<Role> {
    const [role] = await this.db
      .insert(roles)
      .values({ name })
      .onConflictDoNothing({ target: roles.name })
      .returning({ id: roles.id });
    if (!role) throw new ConflictException('已經有同名的 Role');
    return this.get(role.id);
  }

  async rename(id: string, name: string): Promise<Role> {
    await this.get(id);
    const [same] = await this.db.select({ id: roles.id }).from(roles).where(eq(roles.name, name));
    if (same && same.id !== id) throw new ConflictException('已經有同名的 Role');
    await this.db.update(roles).set({ name }).where(eq(roles.id, id));
    return this.get(id);
  }

  async addMember(roleId: string, participantId: string): Promise<void> {
    await this.assertRoleExists(roleId);
    const [participant] = await this.db
      .select({ deactivatedAt: participants.deactivatedAt })
      .from(participants)
      .where(eq(participants.id, participantId));
    if (!participant) throw new NotFoundException('找不到這位 Participant');
    if (participant.deactivatedAt)
      throw new BadRequestException('已停用的 Participant 不能加入 Role');
    await this.db.insert(roleMembers).values({ roleId, participantId }).onConflictDoNothing();
  }

  async removeMember(roleId: string, participantId: string): Promise<void> {
    await this.assertRoleExists(roleId);
    await this.db
      .delete(roleMembers)
      .where(and(eq(roleMembers.roleId, roleId), eq(roleMembers.participantId, participantId)));
  }

  private async assertRoleExists(id: string) {
    const [role] = await this.db.select({ id: roles.id }).from(roles).where(eq(roles.id, id));
    if (!role) throw new NotFoundException('找不到這個 Role');
  }
}
