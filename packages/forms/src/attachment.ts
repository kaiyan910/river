import { z } from 'zod';
import type { FormField } from './schema.js';

/**
 * 附件欄位：檔案本身由瀏覽器以 presigned URL 直接上傳到 S3 相容的 object storage，
 * Form 資料裡只存附件的中繼資料（AttachmentRef），絕不存檔案內容或下載 URL。
 */

/** 單一檔案大小的系統上限（MB）；Designer 設定的上限不能超過它，API 發出上傳 URL 時也以它為準。 */
export const ATTACHMENT_MAX_SIZE_MB = 50;
/** 一個附件欄位最多幾個檔案；Designer 沒有設定數量時以它為準。 */
export const ATTACHMENT_MAX_FILES = 20;
/** 允許的檔案類型以副檔名表示，例如 .pdf。 */
export const ATTACHMENT_EXTENSION_PATTERN = /^\.[a-z0-9]{1,10}$/;

/** 附件欄位的規則，併入 fieldRulesSchema；其他類型的欄位會忽略。 */
export const attachmentRulesShape = {
  /** 允許的副檔名（小寫、含開頭的點）；沒有設定時不限制。 */
  accept: z.array(z.string().max(20)).max(30).optional(),
  /** 單一檔案的大小上限（MB）。 */
  maxSizeMb: z.number().positive().max(ATTACHMENT_MAX_SIZE_MB).optional(),
  /** 最多幾個檔案。 */
  maxFiles: z.number().int().positive().max(ATTACHMENT_MAX_FILES).optional(),
};

/** 存進 request_data 的附件：attachments 資料表的一列的中繼資料。 */
export const attachmentRefSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  contentType: z.string().max(255),
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

const MB = 1024 * 1024;

/** Designer 輸入的「pdf, .JPG」正規化成 ['.pdf', '.jpg']。 */
export function normalizeAccept(input: string): string[] {
  return input
    .split(/[,，\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => (s.startsWith('.') ? s : `.${s}`));
}

/** 檔名的副檔名是否在允許的清單裡（不分大小寫）；沒有設定清單時都允許。 */
export function acceptsFile(accept: readonly string[] | undefined, name: string): boolean {
  if (!accept?.length) return true;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  return accept.includes(name.slice(dot).toLowerCase());
}

/** 單一檔案的大小上限（bytes）：Designer 的設定，沒有時用系統上限。 */
export function maxAttachmentBytes(f: Pick<FormField, 'rules'>): number {
  return Math.min(f.rules.maxSizeMb ?? ATTACHMENT_MAX_SIZE_MB, ATTACHMENT_MAX_SIZE_MB) * MB;
}

/** 附件欄位的驗證：數量、必填、每個檔案的類型與大小。輸出只留下中繼資料，重複的附件只算一次。 */
export function attachmentFieldSchema(f: FormField): z.ZodType {
  const r = f.rules;
  const maxFiles = Math.min(r.maxFiles ?? ATTACHMENT_MAX_FILES, ATTACHMENT_MAX_FILES);
  const maxBytes = maxAttachmentBytes(f);
  return z.unknown().transform((v, ctx): AttachmentRef[] => {
    const fail = (message: string) => {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    };
    const list = v === undefined || v === null || v === '' ? [] : v;
    if (!Array.isArray(list)) return fail('格式不正確');
    const refs = new Map<string, AttachmentRef>();
    for (const item of list) {
      const parsed = attachmentRefSchema.safeParse(item);
      if (!parsed.success) return fail('格式不正確');
      refs.set(parsed.data.id, parsed.data);
    }
    const files = [...refs.values()];
    if (f.required && files.length === 0) return fail('至少上傳一個檔案');
    if (files.length > maxFiles) return fail(`最多 ${maxFiles} 個檔案`);
    for (const file of files) {
      if (!acceptsFile(r.accept, file.name))
        return fail(`「${file.name}」的檔案類型不允許，只接受 ${r.accept?.join('、')}`);
      if (file.size > maxBytes) return fail(`「${file.name}」超過 ${maxBytes / MB} MB`);
    }
    return files;
  });
}
