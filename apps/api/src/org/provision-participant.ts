import type { Permission } from '@river/auth';
import { type Database, participants, permissionGrants } from '@river/db';
import type { Auth } from '../auth/create-auth.js';

export interface CreateAccountInput {
  email: string;
  name: string;
  managerId?: string | null;
  permissions: readonly Permission[];
  /** 省略時帳號沒有密碼，要等對方透過邀請信設定後才能登入。 */
  password?: string;
}

/** 建立 Better Auth 的 user 與對應的 Participant，並授予 Permission。 */
export async function createParticipantAccount(
  auth: Auth,
  db: Database,
  input: CreateAccountInput,
): Promise<{ participantId: string; userId: string }> {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { email: input.email.toLowerCase(), name: input.name, emailVerified: true },
    { method: 'admin' },
  );
  try {
    if (input.password) {
      await ctx.internalAdapter.linkAccount({
        userId: user.id,
        providerId: 'credential',
        accountId: user.id,
        password: await ctx.password.hash(input.password),
      });
    }
    const { participantId } = await insertParticipant(db, user.id, input);
    return { participantId, userId: user.id };
  } catch (error) {
    // Better Auth 的寫入不在我們的 transaction 裡；失敗時移除 user，避免留下不是 Participant 的帳號。
    await ctx.internalAdapter.deleteUser(user.id);
    throw error;
  }
}

export type ProvisionParticipantInput = CreateAccountInput & { password: string };

/** 建立一位可以直接用 email + 密碼登入的 Participant。給 seed script 與測試使用。 */
export function provisionParticipant(auth: Auth, db: Database, input: ProvisionParticipantInput) {
  return createParticipantAccount(auth, db, input);
}

function insertParticipant(db: Database, userId: string, input: CreateAccountInput) {
  return db.transaction(async (tx) => {
    const [participant] = await tx
      .insert(participants)
      .values({ userId, managerId: input.managerId ?? null })
      .returning({ id: participants.id });
    if (!participant) throw new Error('建立 Participant 失敗');
    if (input.permissions.length > 0) {
      await tx
        .insert(permissionGrants)
        .values(
          input.permissions.map((permission) => ({ participantId: participant.id, permission })),
        );
    }
    return { participantId: participant.id };
  });
}
