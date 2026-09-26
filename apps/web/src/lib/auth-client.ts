import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// web 與 api 在同一個網域（Caddy 或 Vite proxy），所以直接用目前的 origin。
// 登入時的 TOTP 挑戰由登入頁自行處理（看 signIn 回傳的 twoFactorRedirect），不用 plugin 的自動轉址。
export const authClient = createAuthClient({ basePath: '/api/auth', plugins: [twoFactorClient()] });
