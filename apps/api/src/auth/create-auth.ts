import { authAccounts, authSessions, authUsers, authVerifications, type Database } from '@river/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

export interface AuthOptions {
  secret: string;
  /** 瀏覽器看到的網址；cookie 的 Secure 旗標與 origin 檢查都以它為準。 */
  baseURL: string;
  /** 除了 baseURL 之外還要信任的 origin。 */
  trustedOrigins?: string[];
}

export function createAuth(db: Database, { secret, baseURL, trustedOrigins = [] }: AuthOptions) {
  return betterAuth({
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
      },
    }),
    // 帳號只能由 Administrator 建立（或 seed script），不開放自行註冊。
    // 密碼由員工點邀請信（之後也包括重設密碼信）的連結自行設定，走 Better Auth 的 /reset-password。
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
  });
}

export type Auth = ReturnType<typeof createAuth>;
