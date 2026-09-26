# 22: TOTP、重設密碼與 session 撤銷

**What to build:** 持有敏感 Permission（credential.manage、user.manage、process.publish）的人必須啟用 TOTP，其他人可以自行選擇。Participant 可以透過 email 重設密碼。Permission 被撤銷時立即生效。

**Blocked by:** 02（Participant、Role、Permission 管理）

**Status:** resolved

- [x] Participant 可以自行啟用 TOTP（使用 Better Auth 內建功能）
- [x] 持有敏感 Permission 但還沒啟用 TOTP 的人，在啟用之前無法使用那些 Permission 對應的 API，UI 會引導他去設定
- [x] 忘記密碼時可以收到重設信（Mailpit 可以看到），並重設密碼
- [x] Permission 被撤銷後，下一次呼叫 API 就會失敗，不需要重新登入
- [x] Seam ① 涵蓋以上所有情況

## Comments

- **TOTP**：使用 Better Auth 內建的 twoFactor plugin（新增 `auth_two_factors` 資料表與 `auth_users.two_factor_enabled`，migration 0016）。啟用要先輸入密碼，再用驗證碼確認後才算數；附 10 組備用碼。登入時密碼正確後回 `twoFactorRedirect`，要再通過 `/two-factor/verify-totp`（或備用碼）才會建立 session。
- **需要 TOTP 的 Permission**：`packages/auth` 的 `TOTP_REQUIRED_PERMISSIONS`（credential.manage、user.manage、process.publish）與 `usablePermissions()`。Permission 仍然授予，但 `PermissionGuard` 只把「可用的」Permission 算數，handler 與資料層級的檢查也只看得到可用的 Permission。只因為沒啟用 TOTP 而被擋下時回 403、`code: 'TOTP_REQUIRED'`（`TOTP_REQUIRED_ERROR_CODE`），與沒有 Permission 的 403 區分；`GET /api/me` 多了 `twoFactorEnabled`。同一個 API 列出多個 Permission 時，持有任一個可用的就能呼叫（例如只持有 process.edit + process.publish 的 Designer 沒啟用 TOTP 時仍可編輯草稿、列出 Process，但不能發佈）。停用 TOTP 後下一次呼叫就會被擋下。
- **Service Account 不需要 TOTP**：API key 不是互動式登入，無法做 TOTP；它也不持有 Permission，只能發起被授權的 Process，走另一個 Guard（`ServiceAccountGuard`），不受影響。
- **重設密碼**：`POST /api/auth/request-password-reset` 寄出重設密碼信，連結直接指向 web 的 `/reset-password/:token`（與邀請信共用 Better Auth 的 `reset-password:` verification），有效 60 分鐘（`PASSWORD_RESET_EXPIRES_IN_MINUTES`）。不存在或已停用的帳號不會收到信，回應也一樣。重設成功後撤銷這個人所有的 session（`revokeSessionsOnPasswordReset`）。
- **Permission 撤銷**：原本就是每次請求從資料庫讀取 Permission（session 沒有 cookie cache），不需要修改；補上 Seam ① 測試鎖住這個行為。
- **測試 harness**：`provisionParticipant` 對持有需要 TOTP 的 Permission 的帳號預設走真實流程啟用 TOTP（`totp: false` 可跳過），`signIn` 會用 harness 內建的驗證器（RFC 6238）自動通過挑戰；新增 `enableTotp`、`totpCode`、`resetPasswordToken`、`ApiClient.withSetCookie`（Better Auth 在啟用、停用 TOTP 時會換發 session）。
- **Web**：登入頁的驗證碼 / 備用碼步驟、忘記密碼頁、重設密碼頁、「帳號安全」頁（QR code、手動金鑰、備用碼、確認；可停用）。持有需要 TOTP 的 Permission 但還沒啟用時，每頁上方顯示提醒，進入對應頁面時顯示「請先啟用兩步驟驗證」並連到設定頁。新增依賴 `qrcode.react`。
- 已知：`bun run lint` 在 `apps/web/src/routes/designer/processes.tsx` 有一個 main 上既有的 a11y 錯誤（useSemanticElements），與這張 issue 無關。
