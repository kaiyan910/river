/** smoke 需要的設定；本機預設對應 deploy/compose.yaml 與 .env.example。 */
export const env = {
  baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8000',
  /** Mailpit 的 HTTP API：邀請信裡有設定密碼的連結。 */
  mailpitURL: process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025',
  adminEmail: required('SEED_ADMIN_EMAIL'),
  adminPassword: required('SEED_ADMIN_PASSWORD'),
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少環境變數 ${name}（repo 根目錄的 .env 或環境變數）`);
  return value;
}
