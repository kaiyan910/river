import { z } from 'zod';

export const apiEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('default'),
  TEMPORAL_TASK_QUEUE: z.string().default('river'),
  BETTER_AUTH_SECRET: z.string().min(32),
  /** 使用者在瀏覽器看到的網址（Caddy 或 Vite dev server），也是 Better Auth 信任的 origin。 */
  BETTER_AUTH_URL: z.url(),
  /** 額外信任的 origin（逗號分隔），例如同時用 Caddy 與 Vite dev server 開啟時。 */
  BETTER_AUTH_TRUSTED_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  PORT: z.coerce.number().int().default(3000),
  /** Credential 秘密的 AES-256-GCM 金鑰：base64 的 32 bytes（`openssl rand -base64 32`），worker 用同一把。 */
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(1),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function authOptionsFromEnv(env: ApiEnv) {
  return {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: env.BETTER_AUTH_TRUSTED_ORIGINS,
  };
}
