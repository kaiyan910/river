import { attachmentDownloadSchema, attachmentUploadSchema } from '@river/contracts';
import type { AttachmentRef } from '@river/forms';
import { api } from '@/lib/api';

/**
 * 上傳附件：先向 API 登記檔案、取得 presigned 上傳 URL，再由瀏覽器直接上傳到 object storage（不經過 API）。
 * 回傳要放進 Form 資料的附件；是否符合欄位設定，送出表單時由 API 依 Form 再檢查一次。
 */
export async function uploadAttachment(file: File): Promise<AttachmentRef> {
  const { attachment, upload } = await api('/attachments', {
    method: 'POST',
    body: {
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
    },
    schema: attachmentUploadSchema,
  });
  const res = await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: file,
  });
  if (!res.ok) throw new Error(`「${file.name}」上傳失敗（${res.status}），請再試一次。`);
  return attachment;
}

/** 下載附件：取得短效的 presigned 下載 URL 後直接前往（回應帶 Content-Disposition，瀏覽器會存檔）。 */
export async function downloadAttachment(id: string): Promise<void> {
  const { url } = await api(`/attachments/${id}/download`, { schema: attachmentDownloadSchema });
  window.location.assign(url);
}
