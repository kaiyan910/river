# 14: Reminder 與 Escalation

**What to build:** Designer 可以在人工節點上設定逾時處理：N 小時後發出 Reminder（可以重複），M 小時後 Escalation。指派給特定人或 Manager 的節點，Escalation 轉給處理人的 Manager；指派給 Role 的節點，轉給 Designer 另外指定的對象。Escalation 絕不會自動核准。

**Blocked by:** 08（指派給 Manager 與 Fallback Role）、11（Email 通知與 Email 節點）

**Status:** resolved

- [x] 人工節點可以設定 Reminder（間隔、是否重複）與 Escalation（時限、目標）
- [x] DSL 檢查器新增規則：指派給 Role 的節點設定 Escalation 時，必須指定目標（Seam ②）
- [x] Reminder 用 durable timer 實作，時間到時寄信給目前的處理人
- [x] Escalation 時，原 Task 變成 superseded，並為新的處理人建立 Task；時間軸記錄原因。處理人沒有 Manager 時，轉給 Fallback Role
- [x] Task 在逾時前完成時，timer 會取消，不會發出 Reminder 或 Escalation
- [x] Seam ① 用 time skipping 涵蓋以上所有情況

## Comments

實作摘要（2026-09-26）：

- DSL：
  - 審批與填表節點新增 `reminder`（`afterHours`、`repeat`）與 `escalation`（`afterHours`、`target`、`fallbackRoleId`），舊的 DSL 沒有這些欄位，視同沒有設定。
  - Escalation 的對象依指派方式決定：
    - 指派給 Role：轉給 `target`（特定人或 Role）。
    - 指派給特定人：轉給處理人的 Manager，找不到有效的 Manager 時轉給 `escalation.fallbackRoleId`。
    - 指派給 Manager：轉給處理人（發起人的 Manager）的 Manager，找不到時沿用節點的 Fallback Role。
  - 檢查器新增 3 個錯誤代碼：`ESCALATION_NO_TARGET`（Role 節點沒有指定目標）、`ESCALATION_NO_FALLBACK_ROLE`（特定人節點沒有 Fallback Role）、`TIMEOUT_INVALID_HOURS`（時數不大於 0）。
- Worker：
  - Interpreter 在等待 Task 時用 durable timer 計時（`waitForTask`），以 `patched('reminder-escalation')` 保護執行中的 workflow；沒有逾時設定的節點和原本一樣只等 Task 完成。
  - `sendReminder` activity：寄信給目前的處理人（Role 時寄給每一位成員），寫入 `task.reminded` 事件；重試時依這個 Task 第幾次 Reminder 判斷是否已經寄過。Reminder 走盡力而為的寄信 proxy，寄不出去就略過。
  - `escalateTask` activity：先鎖 Request 再鎖 Task；Task 仍是 open 時把它改成 `superseded`，為新的處理人建立 Task（同一個節點、同一輪），寫入 `task.escalated` 事件（`taskId` 是新的 Task，找不到 Manager 時帶 `fallbackReason`）。Task 剛好被處理、Request 已經不是 running，或新的處理人和目前相同時不轉交，workflow 繼續等原本的 Task。
  - Escalation 只發生一次；轉交後 Reminder 為新的處理人重新計時。新的處理人收到「逾時轉交的待辦」通知（`notify` 新增 `taskEscalated`）。
  - Escalation 絕不會自動核准：只換人處理，Request 維持 running。
- 資料庫：沒有新的 migration。`task.reminded`、`task.escalated` 只是 `request_events.type` 的新值；superseded 沿用既有的 Task 狀態。
  - `task.escalated` 沒有寫 `task.created`，所以條件與自動核准判斷「這一輪第幾次走到」時不會被 Escalation 建立的 Task 打亂。
- 信件：`@river/email` 新增 `reminder`（待辦提醒）與 `escalated`（逾時轉交的待辦）兩種，一樣只有 Request 標題、Process 名稱與連結。
- 畫面：
  - Designer 屬性面板新增「逾時處理」：Reminder（時數、是否重複）與 Escalation（時數，以及依指派方式選擇目標或 Fallback Role）。畫布上的節點顯示逾時設定摘要。
  - 時間軸顯示「逾時未處理，已提醒 X」與「逾時未處理，原 Task 作廢，Escalation 轉給 X」（找不到 Manager 時附上原因）。
- 測試：
  - Seam ①：`apps/api/test/reminder-escalation.test.ts` 有 8 個測試，用 time skipping（harness 新增 `skipTime`）涵蓋：
    - Role 節點沒有 Escalation 目標時不能發佈；
    - 一次的 Reminder；重複的 Reminder 寄給 Role 的每一位成員；
    - 特定人節點轉給處理人的 Manager（原 Task 作廢、原處理人不能再處理、時間軸、通知、不會自動核准）；
    - 處理人沒有 Manager 時轉給 Fallback Role；
    - Manager 節點轉給 Manager 的 Manager；
    - Role 節點轉給指定的人，轉交後 Reminder 寄給新的處理人；
    - Task 在逾時前完成時不會發出 Reminder 或 Escalation。
  - Seam ②：新增 8 個檢查器測試。
- 已知限制與待決定：
  - 指派給 Manager 的節點，Task 建立時已經改派給 Fallback Role 的話，Escalation 沒有地方可以轉（處理人本來就是 Fallback Role），不轉交也不寫事件，只記 log。
  - 指派給特定人的節點需要另外設定 Escalation 的 Fallback Role（`ESCALATION_NO_FALLBACK_ROLE`）；spec 只提到「找不到 Manager 時轉給 Fallback Role」，但這種節點本身沒有 Fallback Role，所以由 Designer 在 Escalation 設定裡指定。
  - 時數以小時計，可以是小數；沒有上限。Reminder 與 Escalation 從 Task 建立時開始計時，不考慮上班時間。
  - Reminder 寄出後、寫入事件前失敗的話會重複寄出（至少寄一次，不會漏寄），和其他通知相同。
  - 和 issue 15（Reassign）都會「原 Task 作廢、為新的處理人建立 Task」；這裡的 Escalation 用自己的 `task.escalated` 事件記錄原因，合併時可以考慮共用轉交的邏輯。
