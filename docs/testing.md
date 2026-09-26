# 測試

| 層級 | 位置 | 執行 |
|---|---|---|
| Seam ①：API + 真實的 Postgres、Garage、Temporal TestWorkflowEnvironment | `apps/api/test/` | `bun run test`（CI 的 `check` job） |
| Seam ③：Replay 保存的 workflow history | `apps/worker/test/replay.test.ts` | `bun run test`（CI 的 `check` job） |
| Playwright smoke：瀏覽器走完整路徑 | `apps/e2e/` | `bun run --cwd apps/e2e e2e`（CI 的 `e2e` job） |

## Replay（Seam ③）

`apps/worker/test/histories/*.json` 是真實情境跑出來的 workflow history 樣本，代表「舊版程式碼留下、可能仍在執行中的 Request」。replay 測試用目前的 interpreter 重播每一個樣本，出現 nondeterminism 就失敗，CI 跟著失敗。

目前的樣本：

| 檔案 | 情境 |
|---|---|
| `approval.json` | 開始表單 → 填表 → 審批 → 完成 |
| `return-resubmit.json`、`return-resubmit.run2.json` | Return → 重新送出（continueAsNew，所以有兩個 run）→ 核准 → 完成 |
| `parallel.json` | 並行分支的兩條分支各自審批，匯合後再審批 → 完成 |
| `escalation.json` | Reminder → 逾時 Escalation 給處理人的 Manager → 核准 → 完成 |
| `scheduled-start.json` | 排程發起（`scheduledStart` workflow）：建立 Request → 以 child workflow 啟動 interpreter。time skipping 的 server 不支援 Schedule，產生器直接啟動這個 workflow |
| `scheduled-start-skipped.json` | 排程發起：開始表單有必填欄位 → 跳過並通知 Administrator（history 裡只有原因代碼） |

### 新增或更新樣本

樣本由 `apps/api/test/record-replay-histories.test.ts` 用 Seam ① 的測試環境（Testcontainers，需要 Docker）產生：

```sh
bun run --cwd apps/api replay:record
```

- **已經存在的樣本不會被覆寫。** 用新版程式碼重新產生舊樣本，等於假設沒有舊的 Request 還在執行，replay 就失去保護作用。
- **新增樣本**：interpreter 多了新的指令路徑（新的節點類型、Signal、timer）時，在產生器裡加一個 `record('<名稱>', …)` 情境後執行上面的指令，把新的 JSON 檔一起 commit；需要時把名稱加進 `replay.test.ts` 的 `REQUIRED`。
- **更換樣本**：只有確定舊版留下的 Request 都已經結束（例如移除一個 `patched()` 之後），才刪掉對應的 JSON 再重新產生。
- 產生器會把 worker identity（主機名稱）換成固定值，並檢查 payload 裡沒有 email、密碼或 Form 的值；interpreter 的 Signal 與 activity 只傳 ID 與 Process Version 的 DSL，出現這些就代表有東西洩漏進 history，要先修正程式碼。

## 修改 interpreter：`patched()` 還是 Worker Versioning

決策與理由見 [ADR-0001](adr/0001-interpreter-changes-use-patched.md)。簡單來說，**預設用 `patched()`，不使用 Worker Versioning**。

| 修改 | 做法 |
|---|---|
| 只改 activity 的實作（查詢、寄信內容、HTTP 呼叫） | 不需要保護：重播時用 history 裡記錄的結果，不會再執行 activity。activity 回傳值的形狀改變時，workflow 仍要能處理舊的值（例如 `createTask` 舊版回傳 `undefined`）。 |
| 新的節點類型、節點設定或 Signal，舊 history 不可能走到 | 不需要保護，在程式碼旁註明「舊的 history 裡不會出現，所以不需要 `patched()`」。 |
| 舊 history 也會經過的路徑上多了、少了或調換了 activity、timer、`condition`、`continueAsNew` | 用 `patched('<名稱>')` 包住新行為，舊的 workflow 照舊走（例如 `email-notifications`、`reminder-escalation`）。 |
| 整個 interpreter 重寫，用 `patched()` 表達不了 | 新的 workflow type（例如 `interpretProcessV2`），兩個版本同時註冊；舊版在沒有執行中的 Request 之後移除。 |
| 需要多個 worker replica 滾動更新 | 這時才重新評估 Worker Versioning（見 ADR 的 Consequences）。 |

`patched()` 的生命週期：

1. 加上 `patched('x')`，跑 `bun run test` 確認現有樣本都通過；必要時為新路徑新增樣本。
2. 所有在 patch 之前開始的 Request 都結束後（在 Temporal UI 以開始時間查詢執行中的 workflow），改成 `deprecatePatch('x')` 並只保留新行為。
3. 再等到 `deprecatePatch` 之前開始的 Request 都結束後移除它，同時刪掉只代表舊行為的樣本並重新產生。

replay 測試在本機也可以單獨執行：`bun run --cwd apps/worker test`。想確認它真的會抓到問題，可以暫時拿掉 interpreter 裡的一次 `notify(...)` 或改掉某個 patch 名稱，測試應該以 `DeterminismViolationError` 失敗。

## Playwright smoke

`apps/e2e/tests/smoke.spec.ts` 在瀏覽器裡走一次：Designer 在畫布上建立並發佈 Process（開始 → 審批 → 結束）→ Participant 發起 → 審批人 Return → 發起人重新送出 → 審批人核准 → Request 完成。

- 測試不自行啟動任何服務，對已經執行中的完整環境（`E2E_BASE_URL`，預設 Caddy 的 `http://localhost:8000`）執行。
- 帳號由 `seed:admin` 建立的 Administrator（`.env` 的 `SEED_ADMIN_EMAIL`、`SEED_ADMIN_PASSWORD`）透過 API 建立，邀請信從 Mailpit（`E2E_MAILPIT_URL`，預設 `http://localhost:8025`）取出後設定密碼。每次執行都用新的 email、Process 與 Request 名稱，可以直接對開發環境重複執行。
- 登入集中在 `tests/support/session.ts`，TOTP 集中在 `tests/support/totp.ts`：持有 `user.manage`、`process.publish`、`credential.manage` 的人必須啟用 TOTP，smoke 建立的 Designer 會以 Better Auth 的 API 啟用 TOTP，登入時由 otpauth URI 算出驗證碼。
- Administrator 同樣需要 TOTP 才能建立 Participant：還沒啟用時 smoke 暫時替他啟用、結束時停用；已經自行啟用時（例如在開發環境的帳號安全頁設定過），要以 `E2E_ADMIN_TOTP_URI` 提供他驗證器的 `otpauth://` URI，否則 smoke 會直接說明原因並失敗。

本機執行（開發環境已經依 `deploy/README.md` 啟動）：

```sh
(cd apps/e2e && bunx playwright install chromium)   # 第一次
bun run --cwd apps/e2e e2e
```

CI 的 `e2e` job 用 `deploy/compose.yaml` 啟動依賴服務與 Caddy，`bun run build` 後以建置結果執行 api、worker 與 `vite preview`（port 5173），再跑 Playwright；失敗時上傳 report、trace 與各服務的 log。

和開發環境並行執行另一組 api、worker、web 時（例如在 worktree 裡），可以用不同的 `PORT`、`TEMPORAL_TASK_QUEUE` 與 database，web 以 `API_PROXY_TARGET=http://localhost:<api port> vite --port <port>` 把 `/api` 轉給那一組 api，再設定 `E2E_BASE_URL` 指向它。
