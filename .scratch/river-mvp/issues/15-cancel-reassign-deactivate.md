# 15: Cancel、Reassign 與停用帳號

**What to build:** Administrator 可以處理例外狀況：Cancel 任何執行中的 Request、把任何 open 的 Task Reassign 給其他人，以及停用離職員工的帳號。停用前會先顯示影響範圍；停用後，session 立即失效，直接指派給此人的 Task 會進入「待 Reassign」清單。

**Blocked by:** 08（指派給 Manager 與 Fallback Role）、11（Email 通知與 Email 節點）

**Status:** resolved

- [x] 持有 request.cancel 的人可以 Cancel Request（必須填寫原因）；所有 open 的 Task 都變成 superseded，Request 狀態為 cancelled
- [x] 持有 task.reassign 的人可以 Reassign Task；原 Task 變成 superseded，並為新的處理人建立 Task
- [x] 停用前預覽影響範圍：直接指派給此人的 open Task，以及以此人為 Manager 的 Participant
- [x] 停用後，此人的所有 session 立即失效；資料一律不刪除；此人發起的 Request 照常繼續
- [x] 直接指派給已停用 Participant 的 open Task 會出現在「待 Reassign」清單，並寄信通知 Administrator
- [x] Seam ① 涵蓋以上所有情況

## Comments

實作摘要（2026-09-26）：

- 資料：
  - Request 新增最終狀態 `cancelled`；事件新增 `request.cancelled`（actor、原因）與 `task.reassigned`（actor、選填原因，taskId 是新的 Task）。
  - `tasks` 新增 `replaces_task_id`（migration `0012_reassign`）：Reassign 與 Escalation 建立的 Task 記下它取代的已作廢 Task，一路往回追就是這一步的改派歷程。流程走到這一步時建立的 Task 為 null。issue 14 的 `escalateTask` 也設定這個欄位，兩種轉交用同一個模型，差別只在時間軸事件（`task.reassigned` 或 `task.escalated`）。
  - superseded 的模型：原 Task 改成 `superseded`（version + 1），寫一筆 `task.superseded`（Reassign 時帶 actor）；新 Task 沿用原 Task 的 nodeId、nodeName、kind、round，直接指派給新的處理人。不寫 `task.created`，所以「這一輪第幾次走到這個節點」的計算（`earlierVisit`）不受影響。
- API：
  - `POST /api/requests/:id/cancel`（`request.cancel`，原因必填）：running 或 returned 的 Request 改成 cancelled，open Task 全部作廢，提交後送 `cancel` Signal。已完成、已撤回、已 Cancel 回 409；重試時補送 Signal。
  - `GET /api/requests/active`（`request.cancel` 或 `task.reassign`）：所有 running、returned 的 Request。
  - `POST /api/tasks/:id/reassign`（`task.reassign`）：先鎖 Request 再鎖 Task，原 Task 作廢、建立新 Task，提交後送 `reassign` Signal。Role Task 也可以改派（改派後直接指派給那個人）。不能改派給已停用、不存在或目前的處理人（400）；已處理、已作廢的 Task 回 409（已 Reassign 過的會補送 Signal）。
  - 完成 Reassign 接手的 Task 時，先沿著 `replacesTaskId` 補送 `reassign` Signal，萬一當時的 Signal 沒送到，workflow 也不會卡在等舊的 Task。只補送時間軸記錄為 `task.reassigned` 的那幾段；Escalation 那幾段是 workflow 自己轉交的，跳過。
  - `GET /api/tasks/pending-reassign`（`task.reassign`）：直接指派給已停用 Participant 的 open Task。
  - `GET /api/participants/:id/deactivation-impact`、`POST /api/participants/:id/deactivate`（`user.manage`）：預覽直接指派的 open Task 與直屬成員；停用時設定 `deactivated_at`、刪除所有 session，不能停用自己，重複停用沒有影響。
  - Better Auth 的 `session.create.before` hook 擋下已停用 Participant 的登入（403）。
  - `GET /api/participants/directory` 開放給 `task.reassign`（Reassign 時挑人）。
- 通知：
  - 新的 React Email 範本 `renderPendingReassignNotification`，只列出 Request 標題與 Process 名稱，連結到 `/admin/reassign`。
  - 停用時此人還有直接指派的 open Task：api 寄一封摘要信給每一位持有 `task.reassign` 的 Administrator（盡力而為）。
  - 流程走到直接指派給已停用 Participant 的步驟，或 Escalation 轉給已停用的 Participant：worker 的 `notify`（`taskCreated`、`taskEscalated`）改寄給 Administrator。
- Workflow：
  - 新增 `cancel`、`reassign` Signal。cancel 和 withdraw 一樣直接結束；reassign 記下「作廢的 Task → 接手的 Task」。
  - 整合進 issue 14 的 `waitForTask`：等待中的 Task 被 Reassign 時改等新的 Task（可以連續改派），並通知新的處理人。有 Reminder／Escalation 時，timer 跟著新的 Task 重新計時：Reminder 寄給新的處理人；還沒 Escalation 的話，時限從 Reassign 起重新計算，轉給新處理人的 Manager。
  - 沒有收到這兩種 Signal 時，條件判斷、timer 與呼叫的 activity 和原本完全一樣；收到 reassign 之後才有的新指令只會出現在新的 history 裡，所以沒有加 `patched()`（和既有「新的節點類型不需要 patch」的慣例一致）。
- Web：
  - `/admin/reassign`「例外處理」頁：「待 Reassign」與「進行中」兩個清單；右欄可以 Reassign（挑人、選填原因）與 Cancel（原因必填、二次確認）。持有 `request.view_all` 時可以連到「可查看的 Request」看明細與時間軸。
  - 導覽項目的 `requires` 可以是多個 Permission（持有任一個即可）；例外處理頁持有 `task.reassign` 或 `request.cancel` 都看得到，只有 `request.cancel` 的人只看到「進行中」。
  - 人員詳情新增「停用帳號」：先預覽影響範圍，確認後停用。
  - 入口網站顯示 `已 Cancel` 狀態、`request.cancelled`、`task.reassigned` 事件，以及作廢 Task 的原因（撤回、Cancel、Reassign）。
- 測試：
  - Seam ①：`apps/api/test/cancel-reassign-deactivate.test.ts` 14 個測試，涵蓋 Cancel（權限、原因必填、並行分支、returned、已完成）、Reassign（權限、驗證、完整流程與通知信、Role Task 連續改派、已處理）、停用（影響預覽、session 失效與無法登入、發起的 Request 照常完成、待 Reassign 清單與通知信兩種情境）、Reassign 後 Reminder 與 Escalation 跟著新的 Task，以及 Escalation 轉給已停用的人。
- 已知限制與待決定：
  - Reassign 後 Escalation 的時限重新起算，這是實作時的決定（把 Reassign 視為交給新的處理人一個新的 Task），spec 沒有規定。
  - 沒有 `request.view_all` 的 Administrator 看不到 Request 明細，例外處理頁只顯示清單上的摘要。
  - Cancel 不寄信通知發起人；spec 的觸發時機沒有列出，需要時再加。
  - 停用不會移除此人的 Role 成員資格（資料不刪除）；Role Task 的通知與清單本來就會濾掉已停用的人。

