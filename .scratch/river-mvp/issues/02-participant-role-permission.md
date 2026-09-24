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
