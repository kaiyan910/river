import { type APIRequestContext, expect, request } from '@playwright/test';
import { env } from './env.js';

export interface Account {
  name: string;
  email: string;
  password: string;
}

const PASSWORD = 'river-e2e-password';

/**
 * 以 seed:admin 建立的 Administrator 透過 API 建立 smoke 用的 Participant，走和正式環境相同的邀請流程：
 * 建立帳號 → 從 Mailpit 取出邀請信裡的連結 → 設定密碼。
 * 每次執行都用新的 email 與姓名（帶 run 標記），可以直接對開發環境執行，不會和既有資料衝突。
 */
export async function createAccounts<K extends string>(
  run: string,
  people: Record<K, { name: string; permissions?: string[] }>,
): Promise<Record<K, Account>> {
  const api = await request.newContext({
    baseURL: env.baseURL,
    // Better Auth 只接受信任的 origin 送來的請求。
    extraHTTPHeaders: { origin: new URL(env.baseURL).origin },
  });
  // Mailpit 會擋下帶著其他 origin 的請求，另外開一個不帶 origin 的 context。
  const mailpit = await request.newContext({ baseURL: env.mailpitURL });
  try {
    await expectOk(
      api.post('/api/auth/sign-in/email', {
        data: { email: env.adminEmail, password: env.adminPassword },
      }),
    );
    const accounts = {} as Record<K, Account>;
    for (const [key, person] of Object.entries(people) as [K, (typeof people)[K]][]) {
      const account = {
        name: `${person.name} ${run}`,
        email: `e2e-${run}-${key}@river.localhost`.toLowerCase(),
        password: PASSWORD,
      };
      await expectOk(
        api.post('/api/participants', {
          data: { name: account.name, email: account.email, permissions: person.permissions ?? [] },
        }),
      );
      const token = await invitationToken(mailpit, account.email);
      await expectOk(
        api.post('/api/auth/reset-password', { data: { newPassword: PASSWORD, token } }),
      );
      accounts[key] = account;
    }
    return accounts;
  } finally {
    await api.dispose();
    await mailpit.dispose();
  }
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
