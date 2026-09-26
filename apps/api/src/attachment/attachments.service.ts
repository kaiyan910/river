import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AttachmentDownload,
  AttachmentUpload,
  CreateAttachmentInput,
  FormDataInput,
} from '@river/contracts';
import { attachments, type Database, requests } from '@river/db';
import type { AttachmentRef, FormSchema } from '@river/forms';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { visibleTo } from '../auth/data-access.js';
import { rejectFormData } from '../request/form-data.js';
import { ATTACHMENT_STORAGE, DATABASE } from '../tokens.js';
import type { AttachmentStorage } from './attachment-storage.js';

type AttachmentRow = typeof attachments.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refOf = (row: AttachmentRow): AttachmentRef => ({
  id: row.id,
  name: row.fileName,
  size: row.size,
  contentType: row.contentType,
});

/** 送出表單的人與這一步所屬的 Request（發起時還沒有）。 */
export interface SubmissionContext {
  submitterId: string;
  requestId?: string;
}

/**
 * 附件的生命週期：
 * 1. 登記：Participant 登記檔名、類型、大小，拿到 presigned 上傳 URL，瀏覽器直接上傳到 object storage。
 * 2. 送出表單：以資料庫的中繼資料取代瀏覽器送來的內容，確認檔案已上傳，再和這一步的資料一起綁到 Request。
 * 3. 下載：看得到該 Request 的人才拿得到短效的 presigned 下載 URL；還沒送出的附件只有上傳的人拿得到。
 * 檔案內容與 URL 都不進入 Temporal：workflow 只拿到 Request ID，Form 資料裡也只有附件的中繼資料。
 */
@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  async register(input: CreateAttachmentInput, me: ActiveParticipant): Promise<AttachmentUpload> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(attachments)
      .values({
        id,
        storageKey: `attachments/${id}`,
        fileName: input.fileName,
        contentType: input.contentType || 'application/octet-stream',
        size: input.size,
        uploadedBy: me.id,
      })
      .returning();
    if (!row) throw new Error('登記附件失敗');
    const upload = await this.storage.presignUpload(row.storageKey, {
      contentType: row.contentType,
      size: row.size,
    });
    return {
      attachment: refOf(row),
      upload: {
        method: 'PUT',
        url: upload.url,
        headers: upload.headers,
        expiresAt: upload.expiresAt.toISOString(),
      },
    };
  }

  /** 看得到附件所屬 Request 的人（見 visibleTo）；還沒送出的附件只有上傳的人。其他人一律 404。 */
  async download(id: string, me: ActiveParticipant): Promise<AttachmentDownload> {
    const [row] = await this.db
      .select({ attachment: attachments })
      .from(attachments)
      .leftJoin(requests, eq(requests.id, attachments.requestId))
      .where(
        and(
          eq(attachments.id, id),
          or(
            and(isNull(attachments.requestId), eq(attachments.uploadedBy, me.id)),
            and(sql`${requests.id} is not null`, visibleTo(this.db, me)),
          ),
        ),
      );
    if (!row) throw new NotFoundException('找不到這個附件');
    const { attachment } = row;
    const signed = await this.storage.presignDownload(attachment.storageKey, {
      fileName: attachment.fileName,
      contentType: attachment.contentType,
    });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  /**
   * 送出表單前：附件欄位的值換成資料庫裡的中繼資料（瀏覽器送來的檔名、大小不算數），之後才依 Form 驗證。
   * 可以用的附件：自己上傳、還沒送出的；或已經屬於這筆 Request 的（例如重新送出時沿用）。
   * 還沒確認過的附件向 object storage 確認已經上傳、大小相符。不符時回 422，錯誤的鍵是欄位代碼。
   */
  async resolve(
    form: FormSchema | null,
    data: FormDataInput | undefined,
    ctx: SubmissionContext,
  ): Promise<FormDataInput | undefined> {
    const fields = form?.fields.filter((f) => f.type === 'attachment') ?? [];
    if (!data || fields.length === 0) return data;

    const idsOf = (value: unknown): unknown[] | undefined =>
      Array.isArray(value)
        ? value.map((item) =>
            typeof item === 'string' ? item : (item as { id?: unknown } | null)?.id,
          )
        : undefined;
    const wanted = fields.flatMap((f) => idsOf(data[f.key]) ?? []);
    const ids = [
      ...new Set(wanted.filter((id): id is string => typeof id === 'string' && UUID.test(id))),
    ];
    const rows = ids.length
      ? await this.db.select().from(attachments).where(inArray(attachments.id, ids))
      : [];
    const usable = new Map(
      rows
        .filter((r) =>
          r.requestId === null
            ? r.uploadedBy === ctx.submitterId
            : ctx.requestId !== undefined && r.requestId === ctx.requestId,
        )
        .map((r) => [r.id, r]),
    );

    const errors: Record<string, string> = {};
    const resolved: FormDataInput = { ...data };
    for (const f of fields) {
      const list = idsOf(data[f.key]);
      // 不是陣列時交給 Form 驗證回報格式不正確。
      if (!list) continue;
      const refs: AttachmentRef[] = [];
      for (const id of list) {
        const row = typeof id === 'string' ? usable.get(id) : undefined;
        if (!row) {
          errors[f.key] = '找不到附件，請重新上傳';
          break;
        }
        const problem = await this.checkUploaded(row);
        if (problem) {
          errors[f.key] = problem;
          break;
        }
        refs.push(refOf(row));
      }
      resolved[f.key] = refs;
    }
    if (Object.keys(errors).length > 0)
      rejectFormData(`有 ${Object.keys(errors).length} 個附件欄位需要修正`, errors);
    return resolved;
  }

  private async checkUploaded(row: AttachmentRow): Promise<string | undefined> {
    if (row.uploadedAt) return undefined;
    const size = await this.storage.sizeOf(row.storageKey);
    if (size === null) return `「${row.fileName}」還沒上傳完成`;
    if (size !== row.size) return `「${row.fileName}」上傳的檔案和登記的大小不符，請重新上傳`;
    return undefined;
  }
}
