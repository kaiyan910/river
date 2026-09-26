import { ATTACHMENT_EXTENSION_PATTERN } from './attachment.js';
import type { FormSchema } from './schema.js';

export const FORM_ERROR_CODES = [
  'FORM_NO_NAME',
  'FORM_EMPTY',
  'FIELD_NO_LABEL',
  'FIELD_BAD_KEY',
  'FIELD_DUPLICATE_KEY',
  'FIELD_NO_OPTIONS',
  'FIELD_DUPLICATE_OPTION',
  'FIELD_BAD_RANGE',
  'FIELD_BAD_PATTERN',
  'FIELD_BAD_ACCEPT',
] as const;
export type FormErrorCode = (typeof FORM_ERROR_CODES)[number];

export interface FormError {
  formId: string;
  /** Form 層級的錯誤（沒有名稱、沒有欄位）為 null。 */
  fieldId: string | null;
  code: FormErrorCode;
  message: string;
}

/** 欄位代碼：存進 request_data、之後給 JSONata 表達式使用的鍵。 */
export const FIELD_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;

/**
 * Form 的發佈前檢查。純函式：表單設計器即時標示錯誤與 API 拒絕發佈都經由 DSL 檢查器呼叫它。
 * 通過檢查的 Form 才能保證 formToZod 產生的驗證合理（代碼不重複、選項存在、範圍正確）。
 */
export function checkForm(form: FormSchema): FormError[] {
  const errors: FormError[] = [];
  const push = (fieldId: string | null, code: FormErrorCode, message: string) =>
    errors.push({ formId: form.id, fieldId, code, message });

  if (!form.name.trim()) push(null, 'FORM_NO_NAME', '有一份 Form 沒有名稱。');
  if (form.fields.length === 0) push(null, 'FORM_EMPTY', `「${form.name}」還沒有任何欄位。`);

  const keys = new Set<string>();
  for (const f of form.fields) {
    const label = f.label.trim() || f.key || '未命名的欄位';
    if (!f.label.trim()) push(f.id, 'FIELD_NO_LABEL', `「${form.name}」有一個欄位沒有名稱。`);

    if (!FIELD_KEY_PATTERN.test(f.key))
      push(f.id, 'FIELD_BAD_KEY', `「${label}」的欄位代碼要以小寫英文字母開頭，只能有英數與底線。`);
    else if (keys.has(f.key))
      push(f.id, 'FIELD_DUPLICATE_KEY', `「${form.name}」的欄位代碼「${f.key}」重複。`);
    keys.add(f.key);

    if (f.type === 'radio' || f.type === 'multiselect') {
      const options = (f.options ?? []).map((o) => o.trim());
      if (!options.some(Boolean)) push(f.id, 'FIELD_NO_OPTIONS', `「${label}」至少要有一個選項。`);
      else if (new Set(options).size !== options.length || options.some((o) => !o))
        push(f.id, 'FIELD_DUPLICATE_OPTION', `「${label}」的選項有空白或重複。`);
    }

    const r = f.rules;
    if (
      (r.min !== undefined && r.max !== undefined && r.min > r.max) ||
      (r.minLength !== undefined && r.maxLength !== undefined && r.minLength > r.maxLength)
    )
      push(f.id, 'FIELD_BAD_RANGE', `「${label}」的下限大於上限。`);

    if (r.pattern && !isSafePattern(r.pattern))
      push(
        f.id,
        'FIELD_BAD_PATTERN',
        `「${label}」的格式不是有效的正規表示式，或是被重複的群組裡有重複或分支（例如 (a+)+、(a|b)+）。`,
      );

    if (f.type === 'attachment' && r.accept?.some((a) => !ATTACHMENT_EXTENSION_PATTERN.test(a)))
      push(f.id, 'FIELD_BAD_ACCEPT', `「${label}」允許的檔案類型要是副檔名，例如 .pdf。`);
  }
  return errors;
}

/**
 * 能編譯，而且被重複的群組裡沒有重複或分支（例如 (a+)+、(a|aa)+），這兩種寫法都可能造成災難性回溯（ReDoS）。
 * 格式會在 API 上對使用者輸入執行，所以寧可擋掉少數合法但可疑的寫法。
 */
export function isSafePattern(pattern: string): boolean {
  try {
    new RegExp(pattern);
  } catch {
    return false;
  }
  const isQuantifier = (c: string | undefined) => c === '*' || c === '+' || c === '{';
  // 每一層群組記錄「裡面有沒有重複或分支」。
  const stack: boolean[] = [false];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '[') {
      // 跳過字元集合，裡面的 * + 只是字元。
      for (i++; i < pattern.length && pattern[i] !== ']'; i++) if (pattern[i] === '\\') i++;
      continue;
    }
    if (c === '(') stack.push(false);
    else if (c === ')') {
      const inner = stack.pop() ?? false;
      const quantified = isQuantifier(pattern[i + 1]);
      if (inner && quantified) return false;
      stack[stack.length - 1] ||= inner || quantified;
    } else if (isQuantifier(c) || c === '|') stack[stack.length - 1] = true;
  }
  return true;
}
