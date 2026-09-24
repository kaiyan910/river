import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { INVITATION_EXPIRES_IN_HOURS, type Invitation } from '@river/contracts';
import { authUsers, authVerifications, type Database } from '@river/db';
import { type EmailSender, renderInvitationEmail } from '@river/email';
import { and, eq, like } from 'drizzle-orm';
import type { Auth } from '../auth/create-auth.js';
import { APP_URL, AUTH, DATABASE, EMAIL_SENDER } from '../tokens.js';

/**
 * 邀請連結的 token 沿用 Better Auth 重設密碼的 verification（identifier 為 `reset-password:<token>`），
 * 設定密碼頁直接呼叫 `POST /api/auth/reset-password`，由 Better Auth 建立密碼並讓 token 失效。
 */
const RESET_PASSWORD_IDENTIFIER_PREFIX = 'reset-password:';

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_URL) private readonly appUrl: string,
  ) {}

  /** 產生新的邀請連結並寄出；先前寄出的連結全部失效。 */
  async send(user: { id: string; name: string; email: string }, inviterName: string) {
    const ctx = await this.auth.$context;
    await this.db
      .delete(authVerifications)
      .where(
        and(
          eq(authVerifications.value, user.id),
          like(authVerifications.identifier, `${RESET_PASSWORD_IDENTIFIER_PREFIX}%`),
        ),
      );

    const token = randomBytes(24).toString('base64url');
    await ctx.internalAdapter.createVerificationValue({
      identifier: `${RESET_PASSWORD_IDENTIFIER_PREFIX}${token}`,
      value: user.id,
      expiresAt: new Date(Date.now() + INVITATION_EXPIRES_IN_HOURS * 3600_000),
    });

    await this.email.send(
      await renderInvitationEmail({
        to: user.email,
        name: user.name,
        inviterName,
        url: new URL(`/invite/${token}`, this.appUrl).toString(),
        expiresInHours: INVITATION_EXPIRES_IN_HOURS,
      }),
    );
  }

  /** 還有效的邀請連結對應到的人；失效或不存在時回傳 undefined。 */
  async find(token: string): Promise<Invitation | undefined> {
    const ctx = await this.auth.$context;
    const verification = await ctx.internalAdapter.findVerificationValue(
      `${RESET_PASSWORD_IDENTIFIER_PREFIX}${token}`,
    );
    if (!verification || verification.expiresAt < new Date()) return undefined;
    const [user] = await this.db
      .select({ name: authUsers.name, email: authUsers.email })
      .from(authUsers)
      .where(eq(authUsers.id, verification.value));
    return user;
  }
}
