import { createHash, randomBytes } from 'node:crypto';

/** 固定的開頭，讓外洩掃描工具與人一眼認出這是 River 的 Service Account key。 */
const KEY_PREFIX = 'river_sk_';
/** 清單上顯示的長度：固定開頭再加 4 個隨機字元，只夠辨識，不足以猜出 key。 */
const DISPLAY_LENGTH = KEY_PREFIX.length + 4;

export interface NewApiKey {
  /** 明文，只回傳給呼叫者一次，絕不寫進資料庫或 log。 */
  plaintext: string;
  hash: string;
  prefix: string;
}

/**
 * 產生一把新的 API key：256 bits 的隨機值，base64url 編碼。
 * key 本身已經是高熵的隨機字串，不需要加鹽或慢速 hash；存 SHA-256 就能以 hash 直接查詢。
 */
export function generateApiKey(): NewApiKey {
  const plaintext = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { plaintext, hash: hashApiKey(plaintext), prefix: plaintext.slice(0, DISPLAY_LENGTH) };
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
