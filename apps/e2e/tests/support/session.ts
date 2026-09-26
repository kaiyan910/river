import { type Browser, expect, type Page } from '@playwright/test';
import type { Account } from './accounts.js';
import { totpCode } from './totp.js';

/**
 * 以 account 的身分開一個獨立的瀏覽器 context 並登入，回傳停在首頁的 page。
 * 所有 smoke 都透過這裡登入：登入流程改變時只改這裡；TOTP 的驗證碼由 totp.ts 算出。
 */
export async function signIn(browser: Browser, account: Account): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('密碼').fill(account.password);
  await page.getByRole('button', { name: '登入' }).click();
  // 已啟用 TOTP 的帳號（持有 process.publish 等 Permission 的人）還要輸入驗證器上的驗證碼。
  if (account.totpURI) {
    await page.getByLabel('驗證碼').fill(totpCode(account.totpURI));
    await page.getByRole('button', { name: '驗證並登入' }).click();
  }
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}
