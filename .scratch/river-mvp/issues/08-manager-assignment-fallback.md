# 08: 指派給 Manager 與 Fallback Role

**What to build:** Administrator 可以設定每位 Participant 的 Manager。Designer 可以把人工節點指派給「發起人的 Manager」，而且必須同時設定 Fallback Role；當發起人沒有 Manager，或 Manager 已停用時，Task 改派給 Fallback Role。

**Blocked by:** 07（指派給 Role，先送出者勝出）

**Status:** resolved

- [x] Administrator 可以設定或清除 Participant 的 Manager；不能設定自己為 Manager，也不能形成循環
- [x] 人工節點的指派對象新增「發起人的 Manager」選項
- [x] DSL 檢查器新增一條規則：指派給 Manager 的節點必須設定 Fallback Role（Seam ②）
- [x] 發起人有有效的 Manager 時，Task 指派給 Manager
- [x] 發起人沒有 Manager，或 Manager 已停用時，Task 指派給 Fallback Role，時間軸記錄原因（Seam ①）

## Comments

### 實作紀錄（2026-09-26）

- 設定 Manager：02 已經完成（`PATCH /api/participants/:id`，擋下自己、循環、不存在與已停用的 Manager，Administrator 後台可以設定或清除），這次沒有改動。
- DSL：`assignee` 新增 `{ type: 'manager', fallbackRoleId }`。草稿中 `fallbackRoleId` 可以是 null。新增 `TaskAssignee`（participant | role），代表 Task 實際的指派對象。
- 檢查器（Seam ②）：新增 `MANAGER_NO_FALLBACK_ROLE`，審批與填表節點都適用。
- Worker：`createTask` 新增選填的 `initiatorManager: { fallbackRoleId }`，在同一個 transaction 內決定處理人。發起人有 Manager 而且沒有停用時，指派給 Manager；否則改派給 Fallback Role，並在 `task.created` 事件記下原因（`no_manager` 或 `manager_deactivated`）。Task 建立後才換 Manager，不影響已經建立的 Task。指派給 Participant 或 Role 時，activity 參數和舊版相同；Manager 節點不會出現在舊的 history 裡，所以沒有加 `patched()`。
- 資料：`request_events.fallback_reason`（migration 0007）。
- 合約：
  - 時間軸事件新增 `fallbackReason`。
  - 流程預覽的指派對象新增 `{ type: 'manager', fallbackRole }`（`StepAssignee`）。Task 的 `assignee` 仍然只有 participant 或 role。
- Web：
  - Designer 屬性面板新增「Manager」模式，並用下拉選單選擇 Fallback Role；畫布節點顯示「發起人的 Manager」與後備 Role，還沒設定時用紅字提醒。
  - 入口網站的預覽顯示「發起人的 Manager」；時間軸在改派時附上原因。
- 測試：
  - Seam ①：`apps/api/test/manager-assignment.test.ts` 有 5 個測試，涵蓋：沒有 Fallback Role 時不能發佈；有有效 Manager 時指派給 Manager；沒有 Manager 時改派並記錄原因；Manager 已停用時改派並記錄原因（填表節點）；Task 建立後換 Manager 不影響既有 Task。
  - Seam ②：新增 2 個測試。
- 已知限制、待決定：
  - 還沒有停用 Participant 的 API（15），測試直接在資料庫設定 `deactivated_at`。
  - 邀請中（還沒設定密碼）的 Manager 視為有效：只有停用才改派。這種 Manager 無法登入，Task 可能卡住，需要另外決定是否也改派。
  - 發佈時不驗證 `fallbackRoleId` 是否存在，和 07 的 `roleId` 是同一個問題。
  - Service Account 發起時一律走 Fallback Role（84），留給 20。
  - 本機開發資料庫要執行 `bun run db:migrate`（0007）。
