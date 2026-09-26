import { expect, type Page, test } from '@playwright/test';
import { type Account, createAccounts } from './support/accounts.js';
import { signIn } from './support/session.js';

/**
 * 完整路徑：Designer 發佈一個簡單的 Process → Participant 發起 → 審批人 Return
 * → 發起人重新送出 → 審批人核准 → Request 完成。
 */
test('Designer 發佈 → 發起 → Return → 重新送出 → 核准 → 完成', async ({ browser }) => {
  // 每次執行用新的帳號、Process 與 Request 名稱，可以重複對同一個環境執行。
  const run = Date.now().toString(36);
  const people = await createAccounts(run, {
    designer: { name: '設計師', permissions: ['process.edit', 'process.publish'] },
    initiator: { name: '發起人', permissions: [] },
    approver: { name: '審批人', permissions: [] },
  });
  const processName = `smoke 請假 ${run}`;
  const title = `smoke 特休 ${run}`;
  const resubmittedTitle = `${title}（已補代理人）`;

  const designer = await signIn(browser, people.designer);
  await test.step('Designer 建立並發佈 Process：開始 → 審批 → 結束', () =>
    publishSingleApproval(designer, processName, people.approver));

  const initiator = await signIn(browser, people.initiator);
  await test.step('Participant 發起 Request', async () => {
    await initiator.goto('/start');
    await initiator
      .getByRole('list', { name: '可以發起的流程' })
      .getByRole('button', { name: processName })
      .click();
    await initiator.locator('#request-title').fill(title);
    await initiator.getByRole('button', { name: '送出申請' }).click();
    await expect(initiator).toHaveURL(/\/requests\?id=/);
  });
  const requestUrl = initiator.url();

  const approver = await signIn(browser, people.approver);
  await test.step('審批人 Return', async () => {
    await openTask(approver, title);
    await approver.getByLabel('意見').fill('請補上代理人');
    await approver.getByRole('button', { name: 'Return' }).click();
    // 處理完的 Task 不再顯示核准區。
    await expect(approver.getByRole('button', { name: 'Return' })).toBeHidden();
  });

  await test.step('發起人修改後重新送出', async () => {
    await expect(async () => {
      await initiator.goto(requestUrl);
      await expect(initiator.getByText('已退回，請修改後重新送出')).toBeVisible({
        timeout: 2_000,
      });
    }).toPass();
    await expect(initiator.getByText('請補上代理人', { exact: true }).first()).toBeVisible();
    await initiator.locator('#request-title').fill(resubmittedTitle);
    await initiator.getByRole('button', { name: '重新送出' }).click();
    await expect(initiator.getByText('修改後重新送出，從頭開始審批').first()).toBeVisible();
  });

  await test.step('審批人核准', async () => {
    await openTask(approver, resubmittedTitle);
    await approver.getByRole('button', { name: '核准' }).click();
    await expect(approver.getByRole('button', { name: '核准' })).toBeHidden();
  });

  await test.step('Request 完成', async () => {
    await expect(async () => {
      await initiator.goto(requestUrl);
      await expect(initiator.getByText('申請完成').first()).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await expect(initiator.getByRole('heading', { name: resubmittedTitle })).toBeVisible();
  });
});

/** 在畫布上新增一個審批節點、指派給 approver、連線後發佈 v1。 */
async function publishSingleApproval(page: Page, name: string, approver: Account) {
  await page.goto('/designer/processes');
  await page.getByRole('button', { name: '新增 Process' }).click();
  await page.getByPlaceholder('Process 名稱，例如「出差申請」').fill(name);
  await page.getByRole('button', { name: '建立草稿' }).click();

  // 點一下調色盤的「審批」，節點新增在畫布中央並自動選取，右側出現節點設定。
  await page.getByRole('button', { name: '審批', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: '節點設定' });
  await inspector.getByPlaceholder('搜尋姓名或 email').fill(approver.email);
  await inspector.getByRole('button', { name: approver.name }).click();
  await expect(inspector.getByText(approver.email)).toBeVisible();
  await inspector.getByRole('button', { name: '關閉' }).click();

  const node = (selector: string) => page.locator(`.react-flow__node${selector}`);
  const approval = node('.react-flow__node-approval');
  await connect(page, node('[data-id="start"]'), approval);
  await connect(page, approval, node('[data-id="end"]'));
  await expect(page.getByText('沒有問題，可以發佈')).toBeVisible();

  await page.getByRole('button', { name: '發佈', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '發佈 v1', exact: true }).click();
  await expect(dialog.getByText('已發佈 v1')).toBeVisible();
}

/** 從 from 節點底部的 source handle 拖一條線到 to 節點頂部的 target handle。 */
async function connect(
  page: Page,
  from: ReturnType<Page['locator']>,
  to: ReturnType<Page['locator']>,
) {
  await from.locator('.react-flow__handle.source').dragTo(to.locator('.react-flow__handle.target'));
  await expect(page.locator('.react-flow__edge')).not.toHaveCount(0);
}

/** 到「我的待辦」打開標題為 title 的 Task；Task 由 worker 建立，出現之前重新整理。 */
async function openTask(page: Page, title: string) {
  const item = page.getByRole('list', { name: '我的待辦' }).getByRole('button', { name: title });
  await expect(async () => {
    await page.goto('/tasks');
    await expect(item).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await item.click();
}
