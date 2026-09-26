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
  // 進階欄位（issue 17）
  'person',
  'table',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** 明細表裡每一欄可以用的類型：除了明細表本身（不能巢狀）以外的欄位。 */
export const TABLE_COLUMN_TYPES = [
  'text',
  'textarea',
  'number',
  'money',
  'date',
  'radio',
  'multiselect',
  'checkbox',
  'person',
] as const satisfies readonly FieldType[];
export type TableColumnType = (typeof TABLE_COLUMN_TYPES)[number];

/** 明細表最多幾行、最多幾欄。 */
export const TABLE_MAX_ROWS = 100;
export const TABLE_MAX_COLUMNS = 20;

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
  person: '人員選擇器',
  table: '明細表',
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

/** 一般欄位與明細表的欄共用的設定。 */
const fieldShape = {
  id: z.string().min(1),
  /** 存進 request_data 的鍵；明細表的欄是每一行物件裡的鍵。 */
  key: z.string().max(50),
  label: z.string().max(100),
  required: z.boolean(),
  help: z.string().max(200).optional(),
  rules: fieldRulesSchema.default({}),
  /** 單選、多選的選項。 */
  options: z.array(z.string().max(100)).max(50).optional(),
};

/** 明細表的一欄：和一般欄位一樣驗證，只是值存在每一行裡。 */
export const tableColumnSchema = z.object({ ...fieldShape, type: z.enum(TABLE_COLUMN_TYPES) });
export type TableColumn = z.infer<typeof tableColumnSchema>;

/** 草稿中欄位可以暫時不完整（名稱空白、代碼重複…），由 checkForm 在發佈前擋下。 */
export const formFieldSchema = z.object({
  ...fieldShape,
  type: z.enum(FIELD_TYPES),
  /** 明細表的欄。 */
  columns: z.array(tableColumnSchema).max(TABLE_MAX_COLUMNS).optional(),
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
