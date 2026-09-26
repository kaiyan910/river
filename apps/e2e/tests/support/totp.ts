import { createHmac } from 'node:crypto';
import { type APIRequestContext, expect } from '@playwright/test';

/**
 * TOTP 相關的操作都集中在這裡（持有 user.manage、process.publish 等 Permission 的人必須啟用 TOTP）。
 * 帳號的 totpURI 就是驗證器 app 裡存的 otpauth:// URI，驗證碼由它算出。
 */

/** 依 RFC 6238（SHA-1、6 位數、30 秒）算出目前的驗證碼。 */
export function totpCode(totpURI: string, now = Date.now()): string {
  const secret = new URL(totpURI).searchParams.get('secret') ?? '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = (hmac.at(-1) ?? 0) & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * 以 API 登入（cookie 留在 api context 裡）；帳號已啟用 TOTP 時用 totpURI 通過登入挑戰。
 * 回傳帳號是否已啟用 TOTP。
 */
export async function signInApi(
  api: APIRequestContext,
  account: { email: string; password: string; totpURI?: string },
): Promise<{ totpEnabled: boolean }> {
  const res = await api.post('/api/auth/sign-in/email', {
    data: { email: account.email, password: account.password },
  });
  expect(res.ok(), `登入 ${account.email}：${res.status()} ${await res.text()}`).toBe(true);
  const { twoFactorRedirect } = (await res.json()) as { twoFactorRedirect?: boolean };
  if (!twoFactorRedirect) return { totpEnabled: false };
  if (!account.totpURI)
    throw new Error(
      `${account.email} 已啟用 TOTP，但沒有他的驗證器；Administrator 請設定 E2E_ADMIN_TOTP_URI`,
    );
  await expectOk(
    api.post('/api/auth/two-factor/verify-totp', { data: { code: totpCode(account.totpURI) } }),
  );
  return { totpEnabled: true };
}

/** 替 api context 目前登入的人啟用 TOTP（和帳號安全頁同一個流程），回傳驗證器的 URI。 */
export async function enableTotp(api: APIRequestContext, password: string): Promise<string> {
  const enable = await api.post('/api/auth/two-factor/enable', { data: { password } });
  expect(enable.ok(), `啟用 TOTP：${enable.status()} ${await enable.text()}`).toBe(true);
  const { totpURI } = (await enable.json()) as { totpURI: string };
  await expectOk(
    api.post('/api/auth/two-factor/verify-totp', { data: { code: totpCode(totpURI) } }),
  );
  return totpURI;
}

/** 停用 api context 目前登入的人的 TOTP。 */
export async function disableTotp(api: APIRequestContext, password: string): Promise<void> {
  await expectOk(api.post('/api/auth/two-factor/disable', { data: { password } }));
}

async function expectOk(response: ReturnType<APIRequestContext['post']>) {
  const res = await response;
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
}
