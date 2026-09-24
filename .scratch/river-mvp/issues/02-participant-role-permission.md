# 02: Participant、Role、Permission 管理

**What to build:** Administrator 可以管理平台上的人和權限：建立 Participant 後，系統寄出邀請信，員工點信裡的連結自行設定密碼；Administrator 可以建立 Role 並管理成員，也可以授予或撤銷 Permission（提供 Designer 和 Administrator 兩個預設組合）。這張 ticket 會建立 `EmailSender` 介面：本機與 CI 經 SMTP 寄到 Mailpit，production 用 Resend。

**Blocked by:** 01（Walking skeleton）

**Status:** ready-for-agent

- [ ] Administrator 可以建立 Participant；對方收到邀請信（可以在 Mailpit 看到），設定密碼後就能登入
- [ ] Administrator 可以建立、改名 Role，並新增或移除成員
- [ ] Permission 固定為 8 個：process.edit、process.publish、credential.manage、user.manage、role.manage、request.cancel、task.reassign、request.view_all；UI 可以一鍵套用 Designer 或 Administrator 預設組合，credential.manage 不包含在任何預設組合裡
- [ ] `@RequirePermission` Guard 生效：沒有對應 Permission 的呼叫會收到 403（有 API 測試）
- [ ] web 依 Permission 顯示或隱藏 Administrator 後台的路由
- [ ] `EmailSender` 可以用 `EMAIL_TRANSPORT` 在 resend 與 smtp 之間切換；測試中使用記錄已寄出信件的 fake

## Comments

**2026-09-24 · Prototype：後台頁面版面**

- 原型：branch `prototype/issue-02-admin-pages`（commit `cfde68b`），掛在 `/admin/participants`、`/admin/roles`、`/invite/$token`，用 `?variant=A|B|C` 切換；資料是記憶體假資料。
- 問題：人員、Permission、Role 管理頁應該長什麼樣子？
- 已決定：人員頁與 Role 頁都採用 A「清單 + 詳情」，沿用首頁「控制台」的兩欄版面。
  - 人員：左欄是清單（搜尋、依狀態篩選：全部／啟用／邀請中／已停用；列上顯示預設組合或「邀請中」）。右欄是詳情：Manager 下拉選單、直屬成員、所屬 Role、Permission 分三組（Designer／Administrator／單獨授予），逐項開關、立即生效；上方有「套用 Designer」「套用 Administrator」「全部撤銷」。邀請中的人會顯示「重寄邀請信」。
  - 新增 Participant：在右欄顯示表單（姓名、Email、Manager、初始 Permission：一般／Designer／Administrator，註明 credential.manage 要建立後再單獨授予）；送出後顯示「邀請信已寄出」與信件內容預覽。
  - Role：左欄是 Role 清單（成員頭像與人數），右欄點標題就能改名，用搜尋加入成員，逐列移除；沒有成員時提示「指派給這個 Role 的 Task 會沒有人能處理」。
- 設定密碼頁 `/invite/$token` 沿用登入頁的 A「清流」分割式版面；有「連結已失效」狀態。
- 不採用：B（權限矩陣批次儲存、Role 表格 + 抽屜）、C（依 Manager 分組的名錄、以 Permission 為主的分頁、Role 看板）。
- 原型裡的「直屬成員」、「被 N 個 Process 使用」是示意；Process 引用數要等 03 之後才有資料。
