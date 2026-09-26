import { z } from 'zod';
import { attachmentRulesShape } from './attachment.js';

/**
 * Form schema：Designer 在表單設計器定義的欄位清單，屬於 Process，跟著 Process Version 一起存成快照。
 * 這裡只描述「有哪些欄位、怎麼驗證」，不含任何填寫的資料。
 */

export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'money',
  'date',
  'radio',
  'multiselect',
  'checkbox',
  'attachment',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: '單行文字',
  textarea: '多行文字',
  number: '數字',
  money: '金額',
  date: '日期',
  radio: '單選',
  multiselect: '多選',
  checkbox: 'Checkbox',
  attachment: '附件',
};

/** 正規表示式的長度上限；太長的格式難以確認不會造成 ReDoS。 */
export const MAX_PATTERN_LENGTH = 100;

/** 每種欄位適用的規則不同；不適用的規則會被忽略。 */
export const fieldRulesSchema = z.object({
  /** 單行、多行文字 */
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  /** 單行文字的格式（JavaScript 正規表示式）與不符時的訊息 */
  pattern: z.string().max(MAX_PATTERN_LENGTH).optional(),
  patternMessage: z.string().max(100).optional(),
  /** 數字、金額 */
  min: z.number().optional(),
  max: z.number().optional(),
  /** 日期不能早於今天（以 FORM_TIME_ZONE 的日期為準） */
  notPast: z.boolean().optional(),
  /** 多選最多選幾項 */
  maxSelected: z.number().int().positive().optional(),
  /** 附件：允許的檔案類型、大小上限與數量（見 attachment.ts） */
  ...attachmentRulesShape,
});
export type FieldRules = z.infer<typeof fieldRulesSchema>;

/** 草稿中欄位可以暫時不完整（名稱空白、代碼重複…），由 checkForm 在發佈前擋下。 */
export const formFieldSchema = z.object({
  id: z.string().min(1),
  /** 存進 request_data 的鍵。 */
  key: z.string().max(50),
  type: z.enum(FIELD_TYPES),
  label: z.string().max(100),
  required: z.boolean(),
  help: z.string().max(200).optional(),
  rules: fieldRulesSchema.default({}),
  /** 單選、多選的選項。 */
  options: z.array(z.string().max(100)).max(50).optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const formSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(100),
  fields: z.array(formFieldSchema).max(100),
});
export type FormSchema = z.infer<typeof formSchema>;

/** 「不能早於今天」以這個時區的日期為準，瀏覽器與 API 一致。 */
export const FORM_TIME_ZONE = 'Asia/Taipei';

/** 某個時區今天的日期（YYYY-MM-DD）。 */
export function todayIn(timeZone: string = FORM_TIME_ZONE, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}
