import { ConflictException } from '@nestjs/common';
import { attachments, type Database } from '@river/db';
import type { AttachmentRef, FormSchema, StoredFormData } from '@river/forms';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

/**
 * 把這一步資料裡的附件綁到 Request，和存下資料在同一個 transaction。
 * 同一個附件同時被兩筆送出使用時，只有先綁定的成功，另一方回 409。
 */
export async function bindAttachments(
  tx: Pick<Database, 'update'>,
  form: FormSchema,
  data: StoredFormData,
  step: { requestId: string; submittedBy: string },
): Promise<void> {
  const ids = [
    ...new Set(
      form.fields
        .filter((f) => f.type === 'attachment')
        .flatMap((f) => (data[f.key] as AttachmentRef[] | undefined) ?? [])
        .map((a) => a.id),
    ),
  ];
  if (ids.length === 0) return;
  const bound = await tx
    .update(attachments)
    .set({ requestId: step.requestId, uploadedAt: sql`coalesce(${attachments.uploadedAt}, now())` })
    .where(
      and(
        inArray(attachments.id, ids),
        or(
          and(isNull(attachments.requestId), eq(attachments.uploadedBy, step.submittedBy)),
          eq(attachments.requestId, step.requestId),
        ),
      ),
    )
    .returning({ id: attachments.id });
  if (bound.length !== ids.length)
    throw new ConflictException('有附件已經用在其他 Request，請重新上傳');
}
