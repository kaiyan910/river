/** smoke 需要的設定；本機預設對應 deploy/compose.yaml 與 .env.example。 */
export const env = {
  baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8000',
  /** Mailpit 的 HTTP API：邀請信裡有設定密碼的連結。 */
  mailpitURL: process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025',
  adminEmail: required('SEED_ADMIN_EMAIL'),
  adminPassword: required('SEED_ADMIN_PASSWORD'),
  /**
   * Administrator 已經自行啟用 TOTP 時，他驗證器的 otpauth:// URI（啟用時 QR code 的內容）。
   * 沒有啟用時不需要：smoke 會暫時替他啟用、結束後停用（見 accounts.ts）。
   */
  adminTotpURI: process.env.E2E_ADMIN_TOTP_URI || undefined,
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少環境變數 ${name}（repo 根目錄的 .env 或環境變數）`);
  return value;
}
