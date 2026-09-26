import { type Browser, expect, type Page } from '@playwright/test';
import type { Account } from './accounts.js';

/**
 * 以 account 的身分開一個獨立的瀏覽器 context 並登入，回傳停在首頁的 page。
 * 所有 smoke 都透過這裡登入：登入流程改變時（例如持有敏感 Permission 的人要多一步 TOTP）只改這裡。
 */
export async function signIn(browser: Browser, account: Account): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('密碼').fill(account.password);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}
