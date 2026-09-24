import type { Permission } from '@river/auth';
import { type Database, participants, permissionGrants } from '@river/db';
import type { Auth } from '../auth/create-auth.js';

export interface ProvisionParticipantInput {
  email: string;
  name: string;
  password: string;
  permissions: readonly Permission[];
}

/**
 * 建立一位可以用 email + 密碼登入的 Participant，並授予 Permission。
 * 目前給 seed script 與測試使用；邀請信流程上線後改由 Administrator 建立帳號。
 */
export async function provisionParticipant(
  auth: Auth,
  db: Database,
  input: ProvisionParticipantInput,
): Promise<{ participantId: string }> {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    {
      email: input.email.toLowerCase(),
      name: input.name,
      emailVerified: true,
    },
    { method: 'admin' },
  );
  try {
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await ctx.password.hash(input.password),
    });
    return await insertParticipant(db, user.id, input.permissions);
  } catch (error) {
    // Better Auth 的寫入不在我們的 transaction 裡；失敗時移除 user，避免留下能登入卻不是 Participant 的帳號。
    await ctx.internalAdapter.deleteUser(user.id);
    throw error;
  }
}

function insertParticipant(db: Database, userId: string, permissions: readonly Permission[]) {
  return db.transaction(async (tx) => {
    const [participant] = await tx
      .insert(participants)
      .values({ userId })
      .returning({ id: participants.id });
    if (!participant) throw new Error('建立 Participant 失敗');
    if (permissions.length > 0) {
      await tx
        .insert(permissionGrants)
        .values(permissions.map((permission) => ({ participantId: participant.id, permission })));
    }
    return { participantId: participant.id };
  });
}
