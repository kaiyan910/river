import { UnprocessableEntityException } from '@nestjs/common';
import type { FormDataInput, FormRejected } from '@river/contracts';
import { type Database, requestData } from '@river/db';
import { type FormSchema, type StoredFormData, todayIn, validateFormData } from '@river/forms';
import { bindAttachments } from '../attachment/bind-attachments.js';

/** 某一步通過驗證、要存進 request_data 的內容。 */
export interface StepSubmission {
  form: FormSchema;
  data: StoredFormData;
}

/**
 * 依 Process Version 快照裡的 Form 驗證某一步送來的資料，回傳正規化後的內容。
 * 這一步沒有 Form 時不接受任何資料（回傳 null）。不合法時回 422，errors 的鍵是欄位代碼。
 */
export function validateStepData(
  form: FormSchema | null,
  data: FormDataInput | undefined,
): StepSubmission | null {
  if (!form) {
    if (data && Object.keys(data).length > 0) rejectFormData('這一步沒有表單，不能帶表單資料', {});
    return null;
  }
  const result = validateFormData(form, data ?? {}, { today: todayIn() });
  if (!result.success)
    rejectFormData(`表單有 ${Object.keys(result.errors).length} 個欄位需要修正`, result.errors);
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
