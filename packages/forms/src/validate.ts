import { z } from 'zod';
import { attachmentFieldSchema } from './attachment.js';
import { isSafePattern } from './check.js';
import { type FormField, type FormSchema, TABLE_MAX_ROWS } from './schema.js';

export interface FormValidationOptions {
  /** 今天的日期（YYYY-MM-DD），用於「不能早於今天」；呼叫端用 todayIn() 取得。 */
  today: string;
}

/** 空白字串、null、undefined 都視為沒有填。 */
const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim());

type Ctx = z.RefinementCtx;
const fail = (ctx: Ctx, message: string) => {
  ctx.addIssue({ code: 'custom', message });
  return z.NEVER;
};

/** 單值欄位共用：空值時檢查必填並存成 null，有值時交給 parse。 */
function single<T>(f: FormField, parse: (v: unknown, ctx: Ctx) => T) {
  return z.unknown().transform((v, ctx): T | null => {
    if (blank(v)) {
      if (f.required) ctx.addIssue({ code: 'custom', message: '必填' });
      return null;
    }
    return parse(v, ctx);
  });
}

/** 沒有設定最多字數時的上限，避免無限長的資料。 */
export const TEXT_MAX_LENGTH = { text: 200, textarea: 5000 } as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function isDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

/** Participant ID（UUID）。人員是否存在、是否停用由 API 另外檢查（見 personRefs）。 */
export const PARTICIPANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 只執行通過 checkForm 的格式；萬一沒擋到（例如還沒發佈的草稿預覽），寧可略過也不要卡住。 */
function safeRegex(pattern: string): RegExp | null {
  return isSafePattern(pattern) ? new RegExp(pattern) : null;
}

function fieldSchema(f: FormField, options: FormValidationOptions): z.ZodType {
  const r = f.rules;
  const choices = f.options ?? [];
  switch (f.type) {
    case 'text':
    case 'textarea': {
      const cap = TEXT_MAX_LENGTH[f.type];
      return single(f, (v, ctx) => {
        if (typeof v !== 'string') return fail(ctx, '請輸入文字');
        const s = v.trim();
        const max = Math.min(r.maxLength ?? cap, cap);
        if (s.length > max) return fail(ctx, `最多 ${max} 個字`);
        if (r.minLength && s.length < r.minLength) return fail(ctx, `至少 ${r.minLength} 個字`);
        const pattern = f.type === 'text' && r.pattern ? safeRegex(r.pattern) : null;
        if (pattern && !pattern.test(s)) return fail(ctx, r.patternMessage || '格式不正確');
        return s;
      });
    }
    case 'number':
    case 'money':
      return single(f, (v, ctx) => {
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : Number.NaN;
        if (!Number.isFinite(n)) return fail(ctx, '請輸入數字');
        if (f.type === 'number' && !Number.isInteger(n)) return fail(ctx, '請輸入整數');
        if (f.type === 'money' && Math.abs(Math.round(n * 100) - n * 100) > 1e-6)
          return fail(ctx, '最多到小數點後兩位');
        if (r.min !== undefined && n < r.min)
          return fail(ctx, `不能小於 ${r.min.toLocaleString('en-US')}`);
        if (r.max !== undefined && n > r.max)
          return fail(ctx, `不能大於 ${r.max.toLocaleString('en-US')}`);
        return n;
      });
    case 'date':
      return single(f, (v, ctx) => {
        if (typeof v !== 'string' || !isDate(v)) return fail(ctx, '日期格式不正確');
        if (r.notPast && v < options.today) return fail(ctx, '不能早於今天');
        return v;
      });
    case 'radio':
      return single(f, (v, ctx) =>
        typeof v === 'string' && choices.includes(v) ? v : fail(ctx, '不是有效的選項'),
      );
    case 'multiselect':
      return z.unknown().transform((v, ctx): string[] => {
        const list = v ?? [];
        if (!Array.isArray(list)) return fail(ctx, '格式不正確');
        if (list.some((x) => typeof x !== 'string' || !choices.includes(x)))
          return fail(ctx, '不是有效的選項');
        if (f.required && list.length === 0) return fail(ctx, '至少選擇一項');
        if (r.maxSelected && list.length > r.maxSelected)
          return fail(ctx, `最多選 ${r.maxSelected} 項`);
        return [...new Set(list as string[])];
      });
    case 'checkbox':
      return z.unknown().transform((v, ctx): boolean => {
        const checked = v ?? false;
        if (typeof checked !== 'boolean') return fail(ctx, '格式不正確');
        if (f.required && !checked) return fail(ctx, '必須勾選');
        return checked;
      });
    case 'attachment':
      return attachmentFieldSchema(f);
    case 'person':
      return single(f, (v, ctx) =>
        typeof v === 'string' && PARTICIPANT_ID_PATTERN.test(v.trim())
          ? v.trim().toLowerCase()
          : fail(ctx, '不是有效的人員'),
      );
    case 'table':
      // 每一行是一個物件，依明細表的欄分別驗證；錯誤的路徑帶著第幾行（例如 items[1].amount）。
      return z
        .preprocess(
          (v) => v ?? [],
          z
            .array(fieldsObject(f.columns ?? [], options), { error: '格式不正確' })
            .max(TABLE_MAX_ROWS, `最多 ${TABLE_MAX_ROWS} 行`),
        )
        .superRefine((rows, ctx) => {
          if (f.required && rows.length === 0)
            ctx.addIssue({ code: 'custom', message: '至少要有一行' });
        });
  }
}

/** 一組欄位的物件：沒送的欄位補成 null，交給各欄位判斷必填；不是物件的輸入被拒絕。 */
function fieldsObject(fields: readonly FormField[], options: FormValidationOptions) {
  const shape = z.object(Object.fromEntries(fields.map((f) => [f.key, fieldSchema(f, options)])), {
    error: '格式不正確',
  });
  return z.preprocess(
    (v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? { ...Object.fromEntries(fields.map((f) => [f.key, null])), ...v }
        : v,
    shape,
  );
}

/**
 * 從 Form schema 產生 Zod。瀏覽器（TanStack Form）與 API 用同一份，所以兩邊的驗證結果一致。
 * 輸入可以是畫面上的值（數字欄位是字串）；輸出是存進 request_data 的正規化資料。
 */
export function formToZod(form: FormSchema, options: FormValidationOptions) {
  return fieldsObject(form.fields, options);
}

export type StoredFormData = Record<string, unknown>;

export type FormValidationResult =
  | { success: true; data: StoredFormData }
  | { success: false; errors: Record<string, string> };

/**
 * 驗證錯誤的鍵：一般欄位是欄位代碼；明細表裡的欄是「代碼[第幾行].欄的代碼」，例如 items[1].amount
 * （和 TanStack Form 的欄位名稱寫法相同，行數從 0 開始）。
 */
export function fieldPath(path: readonly PropertyKey[]): string {
  return path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : `${i > 0 ? '.' : ''}${String(p)}`))
    .join('');
}

/** 驗證整份資料；失敗時回傳每個欄位（明細表則是每一格）的第一個錯誤。 */
export function validateFormData(
  form: FormSchema,
  data: unknown,
  options: FormValidationOptions,
): FormValidationResult {
  const result = formToZod(form, options).safeParse(data);
  if (result.success) return { success: true, data: result.data as StoredFormData };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) errors[fieldPath(issue.path)] ??= issue.message;
  return { success: false, errors };
}
