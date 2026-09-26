# 23: Replay CI 與 Playwright smoke

**What to build:** 在 CI 加入兩種保護：用保存下來的 workflow history 樣本重跑新版 interpreter（Seam ③），確保修改程式碼不會破壞執行中的 Request；再用 Playwright 在瀏覽器中走一次完整流程。

**Blocked by:** 06（Return、重新送出與 Withdraw）、10（並行分支與匯合）、14（Reminder 與 Escalation）

**Status:** resolved

- [x] 保存具代表性的 history 樣本：一般核准、Return 後重新送出、並行分支、Escalation
- [x] CI 對所有樣本跑 replay；發生 nondeterminism 時 CI 失敗
- [x] 文件說明新增或更新樣本的流程，以及修改 interpreter 時該用 Worker Versioning 還是 `patched()`
- [x] Playwright smoke：Designer 發佈一個簡單的 Process → Participant 發起 → 審批人 Return → 發起人重新送出 → 核准 → 完成
- [ ] Playwright 測試在 CI 中對 Docker Compose 環境執行（job 已加入，待第一次在 GitHub Actions 上執行確認）

## Comments

- Replay：`apps/worker/test/histories/*.json`（approval、return-resubmit ＋ run2、parallel、escalation）由 `bun run --cwd apps/api replay:record` 以 Seam ① 環境產生（不覆寫既有樣本、identity 去識別、檢查 payload 沒有 email／Form 值）；`apps/worker/test/replay.test.ts` 在 `bun run test` 中以 `Worker.runReplayHistories` 重播。已在本機確認拿掉一次 `notify()` 或改掉 patch 名稱時測試以 `DeterminismViolationError` 失敗。
- worker 從原始碼執行時，webpack 改用 `source` 條件解析 workspace package（`workflowOptions`），測試不再依賴已建置、可能過時的 `dist`。
- 文件：`docs/testing.md`；決策：`docs/adr/0001-interpreter-changes-use-patched.md`。
- Playwright：`apps/e2e`，帳號由 Administrator 透過 API＋Mailpit 邀請流程建立，登入集中在 `tests/support/session.ts`（issue 22 的 TOTP 只需改這裡）。本機以獨立的 database／task queue／port 對開發環境的依賴服務跑過（dev 與建置結果兩種模式）皆通過；CI 的 `e2e` job（compose＋Caddy）尚未在 GitHub Actions 上實際執行過。
