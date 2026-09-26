# 07: 指派給 Role，先送出者勝出

**What to build:** Designer 可以把審批或填表節點指派給一個 Role。Role 的每位成員都能在「我的待辦」看到該 Task，不需要認領就可以直接處理；最先送出的決定生效，後送出的人會收到「已由 X 處理」。

**Blocked by:** 04（發起並核准最小的 Request）

**Status:** resolved

- [x] 人工節點的指派對象新增 Role 選項
- [x] Role 的所有成員的「我的待辦」都會出現該 Task；Task 完成後，就從所有人的待辦中消失
- [x] 兩位成員同時送出時，只有一位成功，另一位收到 409 和「已由 X 處理」；workflow 只收到一次 Signal（Seam ① 並發測試）
- [x] 時間軸記錄實際處理 Task 的人

## Comments

### 實作紀錄（2026-09-26）

- DSL：`assignee` 新增 `{ type: 'role', roleId }`，審批與填表節點都可以指派給 Role。
- 資料：`tasks.assignee_id` 可以是 null，並新增 `role_id`。check constraint `tasks_one_assignee` 保證兩者剛好有一個（migration 0006）。
- API：
  - 「我的待辦」的 open Task 包括指派給我的，以及指派給我所屬 Role 的。Role 成員在查詢當下決定。completed 改成「我實際處理過的」（`completedBy`）。
  - 完成 Task 的樂觀鎖把「可以處理」（`assignedTo`）放進 UPDATE 的 WHERE。先送出者勝出，後送出的人收到 409「已由 X 處理」，workflow 只收到一次 Signal。
  - 自己處理過的 Task，即使之後被移出 Role，再送出一次仍然收到「已由 X 處理」。
  - 修正 04 就有的 bug：補送 Signal 時如果 workflow 已經結束，原本會回 500，現在忽略 `WorkflowNotFoundError`。
  - 指派對象在合約裡是 `{ type: 'participant' | 'role', id, name }`，用在流程預覽、`openTasks`、Task 與時間軸事件。
  - 新增 `GET /api/roles/directory`（`id`、`name`、`memberCount`），需要 `process.edit`、`process.publish` 或 `role.manage`，供 Designer 挑選 Role。
- Worker：`createTask` 的 input 多了選填的 `roleId`，`assigneeId` 改成選填。沒有加 `patched()`：command 順序不變，指派給 Participant 時的 activity 參數也和舊版相同。
- Web：
  - Designer 的屬性面板可以切換「特定人員｜Role」。選 Role 時會顯示人數，沒有成員時提醒；畫布節點會顯示 Role 名稱。
  - 入口網站顯示「『財務審批人』任一成員」，待辦的處理區會說明任一成員都可以處理、最先送出的生效。
- 測試：
  - Seam ①：`apps/api/test/role-assignment.test.ts` 有 6 個測試，涵蓋 Role 目錄與預覽、所有成員看到 Task 並在完成後消失、並發只成功一次且只有一次 Signal、填表節點指派給 Role、移出 Role 後重送，以及非成員不能處理。
  - Seam ②：新增 1 個測試，確認指派給 Role 的節點可以通過發佈前檢查。
- 已知限制、待決定：
  - Request 明細的可見範圍：只要這筆 Request 有任何 Task 指派給某個 Role（不論 Task 的狀態），這個 Role 的成員都看得到明細，包括之後才加入 Role 的人。要不要收窄，在 13（可見範圍）決定。
  - 發佈時不驗證 `roleId` 和 `participantId` 是否存在。指到不存在的對象時，`createTask` 會因為 FK 違規一直重試。這在指派給 Participant 時就已經存在，建議在 15 或另開 issue 處理。
  - 有成員的 Role 如果之後變成沒有成員，Task 會沒有人處理；留給 14（Escalation）。
  - 名稱查詢（`lookupNames`、`assigneeRef`）暫時放在 `processes.service.ts`，之後可以搬到獨立的模組。
  - 本機開發資料庫要執行 `bun run db:migrate`（0006）。
