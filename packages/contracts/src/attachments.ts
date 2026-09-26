import { ATTACHMENT_MAX_SIZE_MB, attachmentRefSchema } from '@river/forms';
import { z } from 'zod';

// ─── 附件 ─────────────────────────────────────────────────────────────────

/**
 * `POST /api/attachments`：上傳之前先登記檔案，取得 presigned 上傳 URL。
 * 大小與類型會簽進 URL，實際上傳的檔案必須相符；是否符合附件欄位的設定，送出表單時才依 Form 檢查。
 */
export const createAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().max(255).default('application/octet-stream'),
  size: z
    .number()
    .int()
    .positive()
    .max(ATTACHMENT_MAX_SIZE_MB * 1024 * 1024),
});
export type CreateAttachmentInput = z.infer<typeof createAttachmentSchema>;

/** `POST /api/attachments` 的回應：瀏覽器用 method、url、headers 直接把檔案上傳到 object storage。 */
export const attachmentUploadSchema = z.object({
  attachment: attachmentRefSchema,
  upload: z.object({
    method: z.literal('PUT'),
    url: z.url(),
    /** 上傳時必須帶的 header（簽進 URL 的 Content-Type）。 */
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  }),
});
export type AttachmentUpload = z.infer<typeof attachmentUploadSchema>;

/** `GET /api/attachments/:id/download`：短效的 presigned 下載 URL；只有看得到該 Request 的人拿得到。 */
export const attachmentDownloadSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type AttachmentDownload = z.infer<typeof attachmentDownloadSchema>;
