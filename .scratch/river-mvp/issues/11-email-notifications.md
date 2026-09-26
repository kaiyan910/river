# 11: Email 通知與 Email 節點

**What to build:** 有新 Task 時，平台會寄信通知處理人；Request 被 Return 或完成時，會寄信通知發起人。Designer 也可以在流程中加入 Email 節點。所有信件只包含 Request 標題、Process 名稱和回到平台的連結，一律不含表單內容。

**Blocked by:** 04（發起並核准最小的 Request）

**Status:** resolved

- [x] 以下事件會寄出 email：新 Task（寄給處理人；指派給 Role 時寄給所有成員）、Return、Request 完成（寄給發起人）
- [x] 信件用 React Email 範本渲染；連結直接開到對應的 Task 或 Request，未登入時先登入，登入後再導回原本的頁面
- [x] 新增 email 節點；收件對象可以是特定人、Role、發起人或發起人的 Manager；範本只能使用非敏感的變數
- [x] Seam ① 測試斷言：寄出的信件內容中不含任何表單欄位的值
- [x] 在本機可以透過 Mailpit 看到所有信件

## Comments

實作摘要（2026-09-26）：

- DSL：
  - 新增 `email` 節點，包含 `recipient`、`subject`、`message`。
  - 收件對象可以是 `participant`、`role`、`initiator` 或 `manager`（發起人的 Manager）。
  - 範本變數只有 `{{requestTitle}}`、`{{processName}}`、`{{link}}`（`packages/dsl/src/email-template.ts`）。
  - 檢查器新增 3 個錯誤代碼：`EMAIL_NO_RECIPIENT`、`EMAIL_NO_SUBJECT`、`EMAIL_UNKNOWN_VARIABLE`。範本引用 Form 欄位時不能發佈。
  - Email 節點算是 `isSystemNode`：流程預覽不列出，畫成虛線框。
- 信件：
  - `@river/email` 新增 `renderRequestNotification`（React Email），有四種：新的待辦、被退回、已完成，以及 Email 節點。
  - 信件只包含 Request 標題、Process 名稱與連結。
  - 連結是 `/tasks?id=<taskId>` 或 `/requests?id=<requestId>`。
- Worker（寄信都在 worker，api 只負責邀請信）：
  - `notify` activity：新 Task 寄給處理人，指派給 Role 時寄給每一位沒有停用的成員；Return 與完成寄給發起人。
  - 寄出前會確認事情仍然成立：Task 還是 open；Request 仍是 returned 或已經 completed。
  - `sendEmail` activity：處理 Email 節點。寄出後寫入 `step.email_sent` 事件，時間軸與進度條都會顯示；重試時依「這一輪第幾次走到」判斷是否已經寄過。
  - Interpreter 在新 Task、Return 與完成時呼叫 `notify`，以 `patched('email-notifications')` 保護執行中的 workflow。Email 節點是新的節點類型，不需要 patch。
  - 寄信用另一個 proxy：最多重試 5 次，失敗就記 log 後略過，不讓 Request 卡住（盡力而為）。
  - `WorkerDeps` 新增 `emailSender`、`appUrl`。`main.ts` 讀取 `EMAIL_*` 與 `BETTER_AUTH_URL`（和 api 共用 `.env`）。
- Designer：
  - 節點面板新增 Email。
  - 屬性面板可以選收件對象，編輯主旨與內文，點一下變數就能插入。
  - 畫布上的節點會顯示收件對象。
- 測試：
  - Seam ①：`apps/api/test/email-notifications.test.ts` 有 9 個測試，涵蓋：
    - Role、特定人的新 Task；
    - Return；
    - 完成；
    - Email 節點的四種收件對象；
    - 沒有 Manager 時不寄；
    - 範本含欄位時不能發佈；
    - 安全斷言：填表、Return 意見、重新送出的值都不會出現在任何信件的主旨、HTML 或純文字中。
  - Seam ②：新增 5 個檢查器測試，以及 3 個範本測試。
  - 本機已經用 Mailpit 手動確認：新待辦、Email 節點、完成三封信都看得到。從信件連結進入時先導到登入頁，登入後會回到該 Task 並選取它。
- 已知限制與待決定：
  - 「登入後導回」依賴 `apps/web/src/routes/login.tsx` 尚未 commit 的修正（登入後 `refetchQueries` me），這次沒有一起 commit。
  - Email 節點沒有收件人時不寫事件。同一輪如果再次走到這個節點（迴圈），重試時可能重複寄出。`notify` 重試時也可能重複寄給已經收到的人（至少寄一次，不會漏寄）。
  - 寄信失敗 5 次後就略過，這是實作時的決定，spec 沒有規定，需要確認是否接受。
  - Request 標題由發起人自由輸入，spec 允許放進信件，但發起人仍可能寫進敏感內容。
  - `@river/email` 的 `.tsx` 以 pragma 指定 automatic JSX runtime，因為 worker 用 tsx 從原始碼執行時不會套用該 package 的 tsconfig。
