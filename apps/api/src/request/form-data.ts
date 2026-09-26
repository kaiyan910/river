import { UnprocessableEntityException } from '@nestjs/common';
import type { FormDataInput, FormRejected } from '@river/contracts';
import { type Database, participants, requestData } from '@river/db';
import {
  type FormSchema,
  personRefs,
  type StoredFormData,
  todayIn,
  validateFormData,
} from '@river/forms';
import { and, inArray, isNull } from 'drizzle-orm';
import { bindAttachments } from '../attachment/bind-attachments.js';

/** 某一步通過驗證、要存進 request_data 的內容。 */
export interface StepSubmission {
  form: FormSchema;
  data: StoredFormData;
}

/**
 * 依 Process Version 快照裡的 Form 驗證某一步送來的資料，回傳正規化後的內容。
 * 這一步沒有 Form 時不接受任何資料（回傳 null）。不合法時回 422，errors 的鍵是欄位代碼
 * （明細表裡的欄是「代碼[第幾行].欄的代碼」）。
 * 人員選擇器選到的人必須存在且沒有停用；這一項要查資料庫，所以不在共用的 formToZod 裡。
 */
export async function validateStepData(
  db: Pick<Database, 'select'>,
  form: FormSchema | null,
  data: FormDataInput | undefined,
): Promise<StepSubmission | null> {
  if (!form) {
    if (data && Object.keys(data).length > 0) rejectFormData('這一步沒有表單，不能帶表單資料', {});
    return null;
  }
  const result = validateFormData(form, data ?? {}, { today: todayIn() });
  const errors = result.success ? {} : result.errors;
  if (result.success) {
    const refs = personRefs(form, result.data);
    const ids = [...new Set(refs.map((r) => r.id))];
    const found = ids.length
      ? await db
          .select({ id: participants.id })
          .from(participants)
          .where(and(inArray(participants.id, ids), isNull(participants.deactivatedAt)))
      : [];
    const selectable = new Set(found.map((p) => p.id));
    for (const ref of refs)
      if (!selectable.has(ref.id)) errors[ref.path] ??= '找不到這個人，或帳號已停用';
  }
  if (!result.success || Object.keys(errors).length > 0)
    rejectFormData(`表單有 ${Object.keys(errors).length} 個欄位需要修正`, errors);
  return { form, data: result.data };
}

/**
 * 存下某一步的資料，並把資料裡的附件綁到 Request；和它代表的狀態變化（發起、完成 Task）在同一個 transaction 呼叫。
 */
export async function saveStepData(
  tx: Pick<Database, 'insert' | 'update'>,
  submission: StepSubmission | null,
  step: { requestId: string; nodeId: string; submittedBy: string; round: number },
): Promise<void> {
  if (!submission) return;
  await tx
    .insert(requestData)
    .values({ ...step, formId: submission.form.id, data: submission.data });
  await bindAttachments(tx, submission.form, submission.data, step);
}

/** Form 資料沒有通過驗證：回 422，errors 的鍵是欄位代碼。 */
export function rejectFormData(message: string, errors: Record<string, string>): never {
  const body: FormRejected = { message, errors };
  throw new UnprocessableEntityException(body);
}
