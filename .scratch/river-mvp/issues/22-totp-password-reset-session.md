# 22: TOTP、重設密碼與 session 撤銷

**What to build:** 持有敏感 Permission（credential.manage、user.manage、process.publish）的人必須啟用 TOTP，其他人可以自行選擇。Participant 可以透過 email 重設密碼。Permission 被撤銷時立即生效。

**Blocked by:** 02（Participant、Role、Permission 管理）

**Status:** ready-for-agent

- [ ] Participant 可以自行啟用 TOTP（使用 Better Auth 內建功能）
- [ ] 持有敏感 Permission 但還沒啟用 TOTP 的人，在啟用之前無法使用那些 Permission 對應的 API，UI 會引導他去設定
- [ ] 忘記密碼時可以收到重設信（Mailpit 可以看到），並重設密碼
- [ ] Permission 被撤銷後，下一次呼叫 API 就會失敗，不需要重新登入
- [ ] Seam ① 涵蓋以上所有情況
