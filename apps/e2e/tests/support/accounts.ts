import { type APIRequestContext, expect, request } from '@playwright/test';
import { env } from './env.js';
import { disableTotp, enableTotp, signInApi } from './totp.js';

export interface Account {
  name: string;
  email: string;
  password: string;
  /** 已啟用 TOTP 時，驗證器的 otpauth:// URI；登入時用它算出驗證碼。 */
  totpURI?: string;
}

const PASSWORD = 'river-e2e-password';

/** 持有這些 Permission 必須啟用 TOTP（packages/auth 的 TOTP_REQUIRED_PERMISSIONS）。 */
const TOTP_REQUIRED = ['user.manage', 'process.publish', 'credential.manage'];

/**
 * 以 seed:admin 建立的 Administrator 透過 API 建立 smoke 用的 Participant，走和正式環境相同的邀請流程：
 * 建立帳號 → 從 Mailpit 取出邀請信裡的連結 → 設定密碼；持有需要 TOTP 的 Permission 的人接著啟用 TOTP。
 * 每次執行都用新的 email 與姓名（帶 run 標記），可以直接對開發環境執行，不會和既有資料衝突。
 *
 * Administrator 需要 TOTP 才能使用 user.manage：
 * - 還沒啟用時，smoke 暫時替他啟用，結束時停用，環境維持原狀。
 * - 已經自行啟用時，必須以 E2E_ADMIN_TOTP_URI 提供他的驗證器 URI。
 */
export async function createAccounts<K extends string>(
  run: string,
  people: Record<K, { name: string; permissions?: string[] }>,
): Promise<Record<K, Account>> {
  const admin = await apiContext();
  // Mailpit 會擋下帶著其他 origin 的請求，另外開一個不帶 origin 的 context。
  const mailpit = await request.newContext({ baseURL: env.mailpitURL });
  let enrolledAdmin = false;
  try {
    const { totpEnabled } = await signInApi(admin, {
      email: env.adminEmail,
      password: env.adminPassword,
      totpURI: env.adminTotpURI,
    });
    if (!totpEnabled) {
      await enableTotp(admin, env.adminPassword);
      enrolledAdmin = true;
    }

    const accounts = {} as Record<K, Account>;
    for (const [key, person] of Object.entries(people) as [K, (typeof people)[K]][]) {
      const permissions = person.permissions ?? [];
      const account: Account = {
        name: `${person.name} ${run}`,
        email: `e2e-${run}-${key}@river.localhost`.toLowerCase(),
        password: PASSWORD,
      };
      await expectOk(
        admin.post('/api/participants', {
          data: { name: account.name, email: account.email, permissions },
        }),
      );
      const token = await invitationToken(mailpit, account.email);
      await expectOk(
        admin.post('/api/auth/reset-password', { data: { newPassword: PASSWORD, token } }),
      );
      if (permissions.some((p) => TOTP_REQUIRED.includes(p))) {
        const self = await apiContext();
        try {
          await signInApi(self, account);
          account.totpURI = await enableTotp(self, PASSWORD);
        } finally {
          await self.dispose();
        }
      }
      accounts[key] = account;
    }
    return accounts;
  } finally {
    if (enrolledAdmin) await disableTotp(admin, env.adminPassword);
    await admin.dispose();
    await mailpit.dispose();
  }
}

/** 呼叫 River API 的 context；Better Auth 只接受信任的 origin 送來的請求。 */
function apiContext(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: env.baseURL,
    extraHTTPHeaders: { origin: new URL(env.baseURL).origin },
  });
}

/** 從 Mailpit 找到寄給 email 的邀請信，取出 /invite/<token> 的 token。 */
async function invitationToken(mailpit: APIRequestContext, email: string): Promise<string> {
  let token: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await mailpit.get('/api/v1/search', {
          params: { query: `to:"${email}"` },
        });
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        const [latest] = messages;
        if (!latest) return undefined;
        const message = await mailpit.get(`/api/v1/message/${latest.ID}`);
        const { Text } = (await message.json()) as { Text: string };
        token = Text.match(/\/invite\/([\w-]+)/)?.[1];
        return token;
      },
      { message: `等不到寄給 ${email} 的邀請信`, timeout: 15_000 },
    )
    .toBeTruthy();
  return token as string;
}

async function expectOk(response: ReturnType<APIRequestContext['post']>) {
  const res = await response;
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
}
