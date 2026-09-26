# Spec: River MVP：low-code 審批流程平台

Status: ready-for-agent

> 用詞以 `CONTEXT.md` 為準；技術選型與架構約束見 `docs/TECH-STACK.md`。

## Problem Statement

公司內部的審批流程（請假、報銷、採購、調薪等）目前沒有統一的平台。每新增或修改一種流程，都要由工程師寫程式、部署；員工不知道自己的申請卡在誰手上；審批人沒有統一的待辦清單；主管離職或請假時，申請會無聲無息地卡住；薪資這類敏感資料的查看範圍也沒有清楚的控管。

IT 人員（Designer）需要一個不用寫程式、不用重新部署，就能定義流程與表單的工具。全公司員工（Participant）需要一個簡單的入口：發起申請、處理待辦、追蹤進度。

## Solution

River 是一個公司內部的 low-code 審批平台：

- **Designer** 在網頁畫布上拖拉節點、連線，定義 **Process**；用拖拉表單設計器定義 **Form**；設定每個人工步驟指派給誰、逾時怎麼處理、誰可以發起、誰可以查看。發佈後成為不可修改的 **Process Version**，發佈不需要部署任何程式碼。
- **Participant** 在入口網站發起 **Request**、填寫 Form、上傳附件；在「我的待辦」處理 **Task**（核准，或 **Return** 給發起人修改）；在「我的申請」隨時看到每筆 Request 走到哪一步、歷程如何。
- **Administrator** 管理 Participant、**Role**、**Manager** 關係與 **Permission**，並在例外情況下 **Cancel** Request 或 **Reassign** Task。
- 外部系統可以用 **Service Account** 透過 API 發起 Request；Designer 也可以設定排程定期發起。
- 平台自動寄出 email 通知，並依設定發出 **Reminder** 與 **Escalation**，讓 Request 不會無聲無息地卡住。

## User Stories

### Designer：流程設計

1. As a Designer, I want to create a new Process as a draft, so that I can design it without affecting anyone.
2. As a Designer, I want to drag nodes onto a canvas and connect them, so that I can define a Process visually without writing code.
3. As a Designer, I want a Start node and an End node, so that every Process has a clear entry and exit.
4. As a Designer, I want a form-filling node, so that a Participant can be asked to fill in a Form at a specific step.
5. As a Designer, I want an approval node, so that a Participant can approve or Return the Request at a specific step.
6. As a Designer, I want to assign a human node to a specific Participant, so that a known person always handles that step.
7. As a Designer, I want to assign a human node to a Role, so that any member of, for example, 「財務審批人」 can handle it.
8. As a Designer, I want to assign a human node to the initiator's Manager, so that I do not need one Role per department for manager approvals.
9. As a Designer, I must set a Fallback Role on every node assigned to the Manager, so that the Request never gets stuck when the initiator has no Manager or the Manager is deactivated.
10. As a Designer, I want a condition node with JSONata expressions over the Request's data (for example, 「金額 > 10000」), so that different Requests take different paths.
11. As a Designer, I want a default branch on condition nodes, so that a Request always has a path even when no condition matches.
12. As a Designer, I want a parallel split node and a join node, so that several steps (for example, IT and 財務 approvals) can proceed at the same time and the Request continues only when all branches finish.
13. As a Designer, I want an Email node with a recipient and a message template, so that I can notify people at a specific point in the Process.
14. As a Designer, I want an HTTP node that calls another internal system, with the request body built from the Request's data via JSONata, so that an approved Request can trigger downstream actions (for example, creating a purchase order in the ERP).
15. As a Designer, I want the HTTP node to reference a Credential by name, so that API keys never appear in the Process definition.
16. As a Designer, I want to configure a Reminder on a human node (after N hours, optionally repeating), so that slow handlers are nudged automatically.
17. As a Designer, I want to configure an Escalation on a human node (after M hours), so that an unhandled Task moves to someone who can act.
18. As a Designer, when a node is assigned to a Role, I must specify the Escalation target (a person or a Role), so that Escalation is well-defined even when no single handler exists.
19. As a Designer, I want to see validation errors on the canvas as I edit (unreachable nodes, dangling edges, missing Fallback Role, missing Escalation target, invalid JSONata, missing Form), so that I can fix problems before publishing.
20. As a Designer, I want publishing to be blocked with the same errors I saw on the canvas, so that an invalid Process can never be published.
21. As a Designer, I want to publish a draft as a new Process Version, so that new Requests use it immediately without any code deployment.
22. As a Designer, I want Requests already running to continue on the Process Version they started with, so that publishing never breaks in-flight Requests.
23. As a Designer, I want to see the list of Process Versions and which one is current, so that I know what Participants are using.
24. As a Designer, I want to start a new draft from the current Process Version, so that I can iterate on a live Process safely.
25. As a Designer, I want to set Initiator Roles on a Process, so that only, for example, 部門助理 can start 「採購申請」, while 「請假」 stays open to everyone.
26. As a Designer, I want to set Observer Roles on a Process, so that, for example, HR can see all 「調薪申請」 Requests.
27. As a Designer, I want to configure a schedule that starts Requests of a Process periodically (for example, on the 1st of every month), so that recurring reviews start without anyone remembering.

### Designer：表單設計

28. As a Designer, I want to design a Form by dragging fields onto it, so that I can collect data without writing code.
29. As a Designer, I want basic field types (single-line text, multi-line text, number, amount, date, single choice, multiple choice, checkbox), so that I can model common request data.
30. As a Designer, I want a person-picker field, so that the initiator can select, for example, 「專案負責人」.
31. As a Designer, I want an attachment field, so that Participants can upload receipts or quotation PDFs.
32. As a Designer, I want a detail-table field with its own columns (for example, 報銷的多行項目), so that one Request can contain multiple line items.
33. As a Designer, I want to mark fields as required and set simple validation rules, so that incomplete Requests cannot be submitted.
34. As a Designer, I want Forms to belong to the Process and be versioned together with it, so that changing a Form never breaks running Requests.
35. As a Designer, I want to choose which Form each form-filling node and the Start step uses, so that different steps can collect different data.
36. As a Designer, I want Form field values to be available to JSONata expressions by field key, so that conditions and HTTP bodies can use them.

### Credential 管理

37. As a Participant with `credential.manage`, I want to create a named Credential, so that HTTP nodes can authenticate to internal systems.
38. As a Participant with `credential.manage`, I want to rotate a Credential's secret without republishing any Process, so that key rotation is cheap.
39. As a Participant with `credential.manage`, I want the secret to be write-only (never shown again after saving), so that secrets cannot leak through the UI.
40. As a Designer without `credential.manage`, I want to pick an existing Credential by name in an HTTP node, so that I can use integrations without seeing the secrets.

### Participant：發起 Request

41. As a Participant, I want to log in with my email and password, so that I can use the platform.
42. As a Participant, I want to reset my password via email, so that I can recover my account on my own.
43. As a Participant, I want to see only the Processes I am allowed to start, so that the portal is not cluttered with Processes I cannot use.
44. As a Participant, I want to fill in the start Form and submit a Request, so that my application enters the Process.
45. As a Participant, I want form validation errors shown before submission, so that I do not submit incomplete data.
46. As a Participant, I want to upload attachments directly from the Form, so that supporting documents are kept with the Request.
47. As a Participant, I want a 「我的申請」 list with each Request's status and current step, so that I always know where my Request is stuck.
48. As a Participant, I want a timeline of each Request (who did what, when, with what comment), so that I understand how it reached its current state.
49. As a Participant, I want to be emailed when my Request is Returned or completed, so that I do not need to keep checking.
50. As a Participant, when my Request is Returned, I want to see the comment, edit my Form data and resubmit it, so that I can fix issues without starting a new Request.
51. As a Participant, I understand that a resubmitted Request restarts from the beginning of the Process and all earlier approvals become invalid, so that approvers always approve the current data.
52. As a Participant, I want to Withdraw my Request at any time before it completes, so that I can cancel an application I no longer need.

### Participant：處理 Task

53. As a Participant, I want a 「我的待辦」 inbox listing every Task assigned to me personally, to a Role I belong to, or to me as a Manager, so that I have one place to work from.
54. As a Participant, I want to be emailed when a new Task is assigned to me, so that I notice it without opening the platform.
55. As a Participant, I want the email link to take me straight to the Task (after login if needed), so that I can act quickly.
56. As a Participant, I want to see the Request's Form data (read-only) and attachments when handling an approval Task, so that I can make an informed decision.
57. As a Participant, I want to approve a Task with an optional comment, so that the Request moves forward.
58. As a Participant, I want to Return a Task with a required comment, so that the initiator knows what to fix.
59. As a Participant, I want to fill in and submit the Form of a form-filling Task, so that the Request can continue.
60. As a member of a Role, I want to handle a Role Task directly without claiming it first, so that handling is quick.
61. As a member of a Role, if another member already handled the Task, I want to be told 「已由 X 處理」 when I submit, so that decisions never conflict.
62. As a Participant, I want to receive a Reminder when my Task is overdue, so that I do not forget it.
63. As a Manager, I want to receive Escalated Tasks from my direct reports, so that overdue work does not stall.
64. As a Participant, I want to see Requests I have been involved in (as initiator or past assignee), so that I can refer back to them.
65. As a member of an Observer Role, I want to see all Requests of that Process, so that I can monitor them (for example, HR monitoring 調薪申請).
66. As a Participant, I must not be able to see Requests I have no relation to, so that sensitive data stays private.

### Administrator：人員與組織

67. As an Administrator, I want to create a Participant and have an invitation email sent, so that the employee can set their own password.
68. As an Administrator, I want to import Participants from CSV, including each person's Manager, so that I can onboard the whole company quickly.
69. As an Administrator, I want to see which rows of a CSV import failed and why, so that I can fix them.
70. As an Administrator, I want to set or change a Participant's Manager, so that manager-assigned Tasks go to the right person.
71. As an Administrator, I want to create Roles and manage their members, so that Designers can assign Tasks to Roles.
72. As an Administrator, I want to grant and revoke individual Permissions, with 「Designer」 and 「Administrator」 presets, so that access matches responsibility.
73. As an Administrator, I want `credential.manage` to be granted separately from the presets, so that only trusted people touch integration secrets.
74. As an Administrator, before deactivating a Participant, I want to see the impact (open Tasks assigned to them, Participants who report to them), so that I can plan the handover.
75. As an Administrator, I want deactivation to end the Participant's sessions immediately and never delete their data, so that the audit history stays intact.
76. As an Administrator, I want Requests started by a deactivated Participant to keep running, so that their pending applications are not lost.
77. As an Administrator, I want a 「待 Reassign」 list of open Tasks assigned directly to deactivated Participants, and to be notified of new items, so that nothing stays stuck.
78. As an Administrator, I want to Reassign any open Task to another Participant, so that I can handle leave, departures and mistakes.
79. As an Administrator, I want to Cancel any running Request with a reason, so that I can stop Requests created in error.
80. As a Participant with `request.view_all`, I want to see every Request, so that I can support users and investigate issues.

### Service Account 與排程

81. As an Administrator, I want to create a Service Account, restrict which Processes it may start, and issue a rotatable API key, so that external systems can integrate safely.
82. As an external system, I want to start a Request via API with the start Form data, so that, for example, the HR system can open 「入職設備申請」 automatically.
83. As an external system, I want to start a Request on behalf of a Participant (`on_behalf_of`), so that that Participant is the initiator and manager approvals go to their Manager.
84. As an external system, when I start a Request without `on_behalf_of`, I expect the Service Account to be the initiator and Manager nodes to go to the Fallback Role, so that the behavior is predictable.
85. As an external-system developer, I want an OpenAPI document for the external API, so that I can integrate without reading source code.
86. As an external system, I want to query the status of Requests I started, so that I can react when they complete.

### 安全

87. As a Participant with `credential.manage`, `user.manage` or `process.publish`, I must set up TOTP before using those Permissions, so that high-impact accounts are protected.
88. As any other Participant, I want to optionally enable TOTP, so that I can protect my own account.
89. As a Participant whose Permissions were revoked, I expect the change to take effect immediately, so that access control is reliable.
90. As a security reviewer, I want Form data never to be stored in Temporal history or shown in Temporal UI, so that sensitive data such as salaries has only one controlled home.
91. As a security reviewer, I want notification emails to contain only the Request title, Process name and a link, never Form content, so that sensitive data does not pass through the external email provider.
92. As a security reviewer, I want every state change of every Request recorded in an append-only history, so that approvals are auditable.

### 維運與開發

93. As an operator, I want to run the whole platform on one VM with Docker Compose, so that deployment stays simple.
94. As a developer, I want emails captured by Mailpit in local and CI environments, so that I can check them without sending real mail.
95. As a developer, I want replay tests against saved workflow histories to run in CI, so that changes to the interpreter never break in-flight Requests.

## Implementation Decisions

### 模組

- **DSL 模組**（共用 package）：Process DSL 的型別與 Zod schema、畫布狀態和 DSL 之間的轉換、發佈前檢查。檢查器是純函式，輸入一份 DSL，輸出結構化的錯誤清單（包含節點 ID、錯誤代碼和訊息）。前端即時顯示錯誤與 API 拒絕發佈，都呼叫同一個函式。
- **Forms 模組**（共用 package）：Form schema 型別；從 Form schema 產生 Zod 驗證器；渲染元件（TanStack Form，透過 Standard Schema 使用 Zod）；拖拉設計器（dnd-kit）。
- **Contracts 模組**（共用 package）：API 的 request 與 response，以純 Zod 定義。前端直接使用；NestJS 透過 nestjs-zod 產生 DTO 與 OpenAPI。
- **Auth 模組**（共用 package）：固定的 Permission 清單、預設組合（Designer、Administrator）和授權判斷函式。
- **DB 模組**（共用 package）：Drizzle schema、migrations 與 repository。資料層級的存取檢查（Initiator Role、Observer Role、關係人、`request.view_all`）集中在這一層。
- **API**（NestJS v12，Express adapter）：依領域切成 Process、Request、Task、Org（Participant、Role、Manager、Permission、CSV 匯入、停用）、Credential、ServiceAccount、Auth（Better Auth）、Temporal client 等模組。Permission 以 `@RequirePermission` decorator 搭配全域 Guard 檢查；Service Account 的 API key 驗證用另一個 Guard。
- **Worker**（一般 Node.js，不使用 NestJS）：一個通用的 interpreter workflow，以及一組 activities。
- **Web**（Vite React SPA）：Designer 工作區、Participant 入口與 Administrator 後台放在同一個 app，依 Permission 決定可用的路由。

### Process DSL

- **格式**：DSL 是一個有向圖，由節點與邊組成，以 JSON 儲存。節點類型固定為：`start`、`form`（填表）、`approval`（審批）、`condition`、`parallelSplit`、`parallelJoin`、`email`、`http`、`end`。
- **指派**：人工節點（`form`、`approval`）的指派對象是以下三種之一：特定 Participant、Role、發起人的 Manager。指派給 Manager 時必須設定 Fallback Role。
- **逾時設定**：人工節點可以設定 Reminder（N 小時後，可重複）和 Escalation（M 小時後）。指派對象是 Role 時，Escalation 必須明確指定目標（人或 Role）；其他情況下，Escalation 轉給目前處理人的 Manager，找不到 Manager 時轉給 Fallback Role。
- **條件分支**：`condition` 節點的每條出邊帶一個 JSONata 表達式，另有一條預設出邊。依出邊順序評估，第一個結果為 true 的出邊勝出。
- **並行分支**：`parallelJoin` 等待所有進入它的分支都完成後才繼續。
- **HTTP 節點**：包含 method、URL、以 JSONata 組成的 body，以及 Credential 名稱（選填）。
- **Email 節點**：包含收件對象（特定人、Role、發起人、發起人的 Manager）和固定格式的訊息範本。可用的變數限於非敏感欄位（Request 標題、Process 名稱、連結）。
- **Form 與版本**：Process Version 是「DSL + 所有 Form schema」的不可修改快照，以 JSONB 儲存。

### Request 與 Task 的狀態

- **Request 狀態**：`running` → `returned`（等待發起人重新送出）→ `running` …，最終為 `completed`、`withdrawn` 或 `cancelled` 其中之一。
- **Task 狀態**：`open` → `completed`（結果為 `approved`、`returned` 或 `submitted`）或 `superseded`（因為 Return、Withdraw、Cancel 或 Reassign 而作廢）。
- **Return**：Return 發生時，該 Request 的所有 open Task（包括其他並行分支上的）都會變成 superseded，Request 進入 `returned`。發起人重新送出後，從 `start` 開始再跑一次。
- **Reassign**：原 Task 變成 superseded，並為新的處理人建立一個新的 Task，以保留完整歷程。
- **Escalation**：與 Reassign 相同，原 Task 變成 superseded 並建立新的 Task；歷程中記錄原因是 Escalation。

### 執行引擎（Temporal）

- **對應方式**：每筆 Request 對應一個 workflow，workflow ID 等於 Request ID。輸入只有 Request ID 和 Process Version ID。
- **Signals**：`taskCompleted`（帶 taskId 和結果）、`resubmitted`、`withdraw`、`cancel`、`reassign`。Signal 必須冪等：workflow 忽略重複的 taskId，以及已經 superseded 的 Task。
- **Activities**：`loadProcessVersion`、`createTask`、`supersedeTasks`、`evaluateCondition`（從 Postgres 讀取資料後執行 JSONata，只回傳選中的出邊 ID）、`sendEmail`（Email 節點）、`notify`（新 Task、Return、完成的通知）、`httpRequest`（在 activity 內解密 Credential）、`sendReminder`、`escalateTask`、`recordEvent`、`completeRequest`。
- **Timers**：Reminder 和 Escalation 用 workflow 內的 durable timer 實作。
- **Return 迴圈**：Return 後重新開始時，在適當的時機呼叫 `continueAsNew`。
- **排程發起**：使用 Temporal Schedule。
- **不可違反的約束**：Form 資料、附件內容和 Credential 秘密，一律不得出現在 workflow 的 input、Signal payload、activity 回傳值或 history 中。
- **程式碼版本**：修改 interpreter 程式碼時，必須用 Worker Versioning 或 `patched()` 保護執行中的 workflow。

### 並發：先送出者勝出

- **樂觀鎖**：API 用樂觀鎖把 Task 從 `open` 更新為 `completed`（比對 status 與版本號）。只有更新成功的那一個請求會送出 `taskCompleted` Signal，失敗的一方收到「已由 X 處理」。
- **重試**：Signal 失敗時可以安全重試，因為 workflow 端是冪等的。

### 資料表（Postgres，`river` database）

- **人員與權限**：participants（包含 manager_id、停用狀態）、roles、role_members、permission_grants、service_accounts（API key 只存 hash，並記錄可發起的 Process）。
- **流程定義**：processes（包含 Initiator Role、Observer Role 與排程設定）、process_versions（不可修改的快照）。
- **Request 與 Task**：requests（包含發起人、代表發起的 Service Account、鎖定的 Process Version、狀態）、request_data（Form 資料，依步驟分開存放）、tasks（包含指派對象類型、處理人、Role、狀態、結果、樂觀鎖版本號）。
- **稽核**：request_events（只能新增，時間軸直接讀這張表）。
- **其他**：credentials（加密後的秘密）、attachments（S3 object 的中繼資料）。
- **Better Auth**：使用它自己的 user、session 等資料表，與 participants 一對一對應。
- **`temporal` database**：獨立的 database，專供 Temporal 使用。

### API 合約（資源層級）

- **UI API**（session cookie）：processes 與草稿、驗證、發佈、versions；forms 屬於草稿的一部分；requests（發起、列表、明細、時間軸、重新送出、Withdraw、Cancel）；tasks（我的待辦、明細、完成）；participants（CRUD、CSV 匯入、停用影響預覽、停用）；roles；permissions；credentials（只能寫入秘密）；service-accounts；待 Reassign 清單；附件的 presigned upload URL。
- **External API**（Service Account 的 Bearer API key）：發起 Request（可帶 `on_behalf_of`）；查詢自己發起的 Request 的狀態。提供 OpenAPI 文件。

### 通知

- **寄送方式**：`EmailSender` 介面接收用 React Email 渲染好的 HTML。production 用 Resend transport；本機與 CI 用 SMTP 寄到 Mailpit。
- **觸發時機**：新 Task、Request 被 Return、Request 完成、Reminder、Escalation、待 Reassign 清單有新項目、邀請信、重設密碼。
- **內容限制**：信件內容一律不含 Form 資料。

## Testing Decisions

### 什麼是好的測試

- **只測對外行為**：透過公開介面驅動，只斷言外部看得到的結果。例如 API 的回應、「我的待辦」的內容、Request 的時間軸、寄出的 email、送出的 HTTP 請求。
- **不測實作細節**：不斷言 workflow 的內部狀態、呼叫了哪些 activity，或資料表的中間狀態。
- **用詞**：測試名稱使用 `CONTEXT.md` 的用詞，例如「Return 後重新送出會從頭開始」。

### Seam ①：API（主要）

- **驅動方式**：以 Designer、Participant、Administrator、Service Account 的身分呼叫 HTTP API。
- **環境**：真實的 Postgres（Testcontainers）、Temporal `TestWorkflowEnvironment`（time skipping，可以快轉 Reminder 與 Escalation）、真實的 worker。
- **替換成 fake 的部分**：`EmailSender`（記錄寄出的信件）；HTTP 節點的目標伺服器（本機 stub server，記錄收到的請求）。
- **涵蓋範圍**：絕大多數的 user story。包括發佈與版本鎖定、各種指派方式、Fallback Role、條件分支、並行分支、Return 後重新送出、Withdraw、Cancel、Reassign、Reminder 與 Escalation、Role Task 的先送出者勝出、Permission 與資料可見範圍、帳號停用、Service Account 的 `on_behalf_of`、CSV 匯入。
- **安全斷言**：一個安全測試斷言 Form 資料的值不會出現在 Temporal history 的任何 payload 中。

### Seam ②：DSL 檢查

- **驅動方式**：純函式測試。輸入一份 DSL，斷言輸出的錯誤清單。
- **涵蓋範圍**：到不了的節點、懸空的邊、缺少 Fallback Role、Role 節點缺少 Escalation 目標、JSONata 語法錯誤、缺少 Form、條件節點缺少預設出邊、並行分支與匯合不配對、沒有 start 或 end 節點。

### Seam ③：Replay

- **做法**：保存一組具代表性的 workflow history 樣本（包括一般核准、Return 後重新送出、並行分支、Escalation），CI 用新版 interpreter 重跑，確認沒有 nondeterminism 錯誤。

### 前端

- **Smoke test**：不為前端另設 seam。只用少量 Playwright 測試走過完整路徑：Designer 發佈一個簡單的 Process → Participant 發起 → 審批人 Return → 發起人重新送出 → 核准 → 完成。

### Prior art

- 這是全新的專案，repo 中還沒有任何測試可以參考。第一批測試就是之後的範本。

## Out of Scope

- **組織架構**：部門樹、多層主管、部門主管等指派方式。
- **簽核模式**：會簽（全部人都要同意）和依序簽；多人都要同意時，改用並行分支處理。
- **代理人**：代理人設定，以及處理人自行轉派；MVP 只有 Administrator 可以 Reassign。
- **逾時自動處理**：逾時自動核准或自動退回。
- **欄位權限**：欄位層級的查看或修改權限。
- **Form 共用**：Form 跨 Process 共用，以及 Form 獨立版本化。
- **版本遷移**：把執行中的 Request 遷移到新的 Process Version。
- **身分整合**：SSO、LDAP 與 Keycloak。
- **平台角色**：自訂平台角色；Permission 採固定清單 + 預設組合。
- **外部參與者**：外部人士（供應商、客戶）參與流程。
- **其他節點**：Slack 或 Teams 通知、程式碼節點（sandbox JavaScript）。
- **分析與介面**：報表、統計儀表板、手機 App、多語系。
- **平台形態**：多租戶與計費。

## Further Notes

尚待決定的問題（實作時請先採用建議的預設，並在 PR 中註明）：

1. **HTTP 節點重試失敗後**：建議的預設是 Request 暫停，並通知 Administrator；Administrator 可以選擇重試或 Cancel。
2. **HTTP 回應寫回 Request 資料**：MVP 建議不做；HTTP 節點只看成功或失敗。
3. **排程發起的發起人**：建議排程設定時必須指定一位 Participant 作為發起人。
4. ~~**永久拒絕**~~：**已決定（2026-09-24）**：不需要。審批結果只有核准和 Return；發起人被 Return 後可以自行 Withdraw。
5. ~~**NestJS v12 相容性**~~：**已確認（2026-09-24）**：Better Auth 的 NestJS 整合正式支援 v12；`nestjs-zod` 5.5.0 還沒宣告支援，但在 v12 上實測正常，照常使用。詳見 issue 01 的 Comments。
6. **Resend 的資料外流**：使用 Resend 代表 email 會經過外部服務，而且 VM 必須能連到外網。上線前要確認公司政策是否允許。
