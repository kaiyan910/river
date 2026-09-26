# River

公司內部使用的 low-code 業務流程（審批）平台：由技術人員以拖拉方式設計流程與表單，全公司員工在流程中發起申請、填表與審批。

## Language

### 人員與組織

**Participant**:
在平台上有帳號、可以發起申請、填寫表單或進行審批的公司員工。離職時只會被停用（Deactivated），永遠不會刪除。
_Avoid_: End user, 用戶, member

**Service Account**:
給外部系統透過 API 發起 Request 用的非人類帳號，只能發起被授權的 Process；可以代表某位 Participant 發起。沒有 Manager。
_Avoid_: Bot, integration user, API user

**Role**:
一組 Participant 的具名業務集合（例如「財務審批人」），由 Administrator 建立，用於指派 Task、限制發起與查看範圍。不代表任何平台權限。
_Avoid_: Group, team, position, 平台角色

**Permission**:
程式碼中固定的一項平台操作權限（例如發佈 Process、管理 Credential），直接授予 Participant。
_Avoid_: Role, privilege, scope

**Designer**:
持有設計類 Permission（編輯、發佈 Process）的 Participant，通常是少數 IT 人員；也是這組 Permission 預設組合的名稱。
_Avoid_: Admin, builder, developer

**Administrator**:
持有管理類 Permission（管理人員與 Role、Cancel Request、Reassign Task 等）的 Participant；也是這組 Permission 預設組合的名稱。
_Avoid_: Admin user, superuser, root

**Manager**:
Participant 的直屬主管；每位 Participant 最多只有一位。平台不維護部門樹。
_Avoid_: Supervisor, boss, 上級

### 流程定義

**Process**:
由 Designer 在畫布上以節點和連線定義的一種業務流程（例如「報銷」、「請假」）。
_Avoid_: Workflow, flow, template

**Process Version**:
Process 的一個已發佈、不可再修改的快照，包含流程圖以及它用到的所有 Form；每筆 Request 在發起時就鎖定一個 Process Version，並依它跑到結束。
_Avoid_: Revision, draft

**Draft**（草稿）:
Process 上唯一一份還沒發佈、可以繼續修改的流程圖；發佈時通過檢查才會變成新的 Process Version，發佈後草稿清空。
_Avoid_: 用「draft」稱呼已發佈的 Process Version

**Form**:
由 Designer 以拖拉方式設計、在人工步驟中呈現給 Participant 填寫的表單定義；屬於某個 Process，不跨 Process 共用。
_Avoid_: Page, screen

**Initiator Role**:
Designer 在 Process 上指定、其成員才可以發起該 Process 的 Role；沒有指定時，所有 Participant 都可以發起。
_Avoid_: Starter, allowed users

**Observer Role**:
Designer 在 Process 上指定的 Role，其成員可以查看該 Process 所有 Request 的內容與歷程。
_Avoid_: Viewer, watcher

**Credential**:
集中管理、加密儲存的外部系統憑證（API key、token），自動步驟只以名稱引用它，Process Version 不含秘密本身。
_Avoid_: Secret, connection, key

**Fallback Role**:
指派給 Manager 的人工步驟上必須設定的後備 Role；當發起人沒有 Manager，或 Manager 帳號已停用時，Task 改派給它。
_Avoid_: Default assignee, backup

### Request 生命週期

**Request**:
Participant 依某個 Process Version 發起的一筆具體申請，從發起一路走到完成或終止。
_Avoid_: Instance, case, ticket, 工單

**Task**:
Request 流轉到人工步驟時產生、指派給特定人、某個 Role 或發起人的 Manager 處理的一項待辦（填表或審批）。指派給 Role 時不需要認領，任一成員都可以直接處理，最先送出的決定生效。
_Avoid_: Todo, job, work item

**Auto-approval**（自動核准）:
Designer 在審批步驟上設定的條件成立時，由系統直接核准這一步，不產生 Task；Request 的歷程會記錄這一步是自動核准的。條件無法判斷時一律交給人審批。逾時永遠不會觸發 Auto-approval。
_Avoid_: Skip, bypass, 免審

**Return**:
審批人不同意時，把 Request 退回給發起人修改；重新送出後從 Process 的開頭再跑一次，先前的核准全部失效，Request 本身不會結束。
_Avoid_: Reject（與終止混淆）, 打回

**Withdraw**:
Request 尚未完成時，發起人自行撤回，Request 因此結束。
_Avoid_: Cancel, retract

**Cancel**:
Administrator 強制終止一筆尚未完成的 Request。
_Avoid_: Withdraw, abort, terminate

**Reminder**:
Task 逾時時發給目前處理人的提醒，不會改變 Task 由誰負責。
_Avoid_: Nudge, 催辦通知

**Escalation**:
Task 逾時未處理時，依節點設定轉給其他人：指派對象是特定人或 Manager 時，轉給該處理人的 Manager；指派對象是 Role 時，轉給 Designer 另外指定的人或 Role。Escalation 絕不會自動核准。
_Avoid_: Timeout action, 升級（單獨使用時）

**Reassign**:
Administrator 把一個未完成的 Task 改派給另一位 Participant。
_Avoid_: Delegate, transfer, 代理
