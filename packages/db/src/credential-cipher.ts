import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Credential 秘密的加密：AES-256-GCM（node:crypto），金鑰由環境變數 CREDENTIAL_ENCRYPTION_KEY 提供
 * （base64 的 32 bytes，例如 `openssl rand -base64 32`），api 與 worker 使用同一把。
 *
 * - 每次加密都用新的 12 bytes 隨機 IV；GCM 的 auth tag 確保密文沒有被竄改。
 * - AAD 綁定 Credential 的 ID：把一列的密文複製到另一列也解不開。
 * - 儲存格式 `v1.<iv>.<tag>.<密文>`（都是 base64url）；v1 保留日後換金鑰或演算法的空間。
 */
export interface CredentialCipher {
  encrypt(credentialId: string, secret: string): string;
  decrypt(credentialId: string, stored: string): string;
}

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

export function createCredentialCipher(base64Key: string): CredentialCipher {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32)
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY 必須是 base64 編碼的 32 bytes（openssl rand -base64 32）',
    );
  const aad = (credentialId: string) => Buffer.from(`credential:${credentialId}`, 'utf8');

  return {
    encrypt(credentialId, secret) {
      const iv = randomBytes(12);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      cipher.setAAD(aad(credentialId));
      const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
      return [VERSION, iv, cipher.getAuthTag(), encrypted]
        .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
        .join('.');
    },
    decrypt(credentialId, stored) {
      const [version, iv, tag, encrypted] = stored.split('.');
      if (version !== VERSION || iv === undefined || tag === undefined || encrypted === undefined)
        throw new Error('無法辨識的 Credential 密文格式');
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(aad(credentialId));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
