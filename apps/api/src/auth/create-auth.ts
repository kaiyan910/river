import { PASSWORD_RESET_EXPIRES_IN_MINUTES } from '@river/contracts';
import {
  authAccounts,
  authSessions,
  authTwoFactors,
  authUsers,
  authVerifications,
  type Database,
  participants,
} from '@river/db';
import { type EmailSender, renderPasswordResetEmail } from '@river/email';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';

export interface AuthOptions {
  secret: string;
  /** 瀏覽器看到的網址；cookie 的 Secure 旗標與 origin 檢查都以它為準。 */
  baseURL: string;
  /** 除了 baseURL 之外還要信任的 origin。 */
  trustedOrigins?: string[];
  /** 寄重設密碼信；seed script 這類不處理使用者請求的地方可以省略。 */
  emailSender?: EmailSender;
}

export function createAuth(
  db: Database,
  { secret, baseURL, trustedOrigins = [], emailSender }: AuthOptions,
) {
  /** 已停用的 Participant；不能登入，也不會收到重設密碼信。 */
  async function isDeactivated(userId: string): Promise<boolean> {
    const [participant] = await db
      .select({ deactivatedAt: participants.deactivatedAt })
      .from(participants)
      .where(eq(participants.userId, userId));
    return !!participant?.deactivatedAt;
  }

  return betterAuth({
    appName: 'River',
    secret,
    baseURL,
    basePath: '/api/auth',
    trustedOrigins: [baseURL, ...trustedOrigins],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        twoFactor: authTwoFactors,
      },
    }),
    // 帳號只能由 Administrator 建立（或 seed script），不開放自行註冊。
    // 密碼由員工點邀請信或重設密碼信的連結自行設定，走 Better Auth 的 /reset-password。
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      resetPasswordTokenExpiresIn: PASSWORD_RESET_EXPIRES_IN_MINUTES * 60,
      // 重設密碼後登出所有裝置：密碼可能已經外洩，舊的 session 不應該繼續有效。
      revokeSessionsOnPasswordReset: true,
      // 信裡的連結直接指向 web 的重設密碼頁（與邀請信相同的 /reset-password token），
      // 不經過 Better Auth 的 GET /reset-password/:token 轉址。
      sendResetPassword: emailSender
        ? async ({ user, token }) => {
            if (await isDeactivated(user.id)) return;
            await emailSender.send(
              await renderPasswordResetEmail({
                to: user.email,
                name: user.name,
                url: new URL(`/reset-password/${token}`, baseURL).toString(),
                expiresInMinutes: PASSWORD_RESET_EXPIRES_IN_MINUTES,
              }),
            );
          }
        : undefined,
    },
    // TOTP：任何人都可以自行啟用；持有需要 TOTP 的 Permission 的人必須啟用才能使用那些 Permission
    // （由 PermissionGuard 檢查，見 packages/auth 的 TOTP_REQUIRED_PERMISSIONS）。
    plugins: [twoFactor({ issuer: 'River' })],
    // 已停用的 Participant 不能再建立 session（登入）；停用時既有的 session 也會一併刪除。
    databaseHooks: {
      session: {
        create: {
          async before(session) {
            if (await isDeactivated(session.userId))
              throw APIError.from('FORBIDDEN', {
                message: '這個帳號已停用',
                code: 'PARTICIPANT_DEACTIVATED',
              });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
