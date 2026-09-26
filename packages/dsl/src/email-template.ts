/**
 * Email 節點的訊息範本可以用的變數：只有非敏感的欄位，一律不含 Form 資料。
 * 範本裡寫成 `{{requestTitle}}`，大括號裡可以有空白。
 */
export const EMAIL_TEMPLATE_VARIABLES = {
  requestTitle: 'Request 標題',
  processName: 'Process 名稱',
  link: '回到 Request 的連結',
} as const;
export type EmailTemplateVariable = keyof typeof EMAIL_TEMPLATE_VARIABLES;

const VARIABLE = /\{\{\s*([^{}]*?)\s*\}\}/g;

function isKnown(name: string): name is EmailTemplateVariable {
  return Object.hasOwn(EMAIL_TEMPLATE_VARIABLES, name);
}

/** 範本裡不能用的變數名稱，每個只列一次；發佈前檢查用它擋下引用 Form 欄位的範本。 */
export function unknownTemplateVariables(template: string): string[] {
  const names = [...template.matchAll(VARIABLE)].map((m) => m[1] ?? '');
  return [...new Set(names.filter((n) => !isKnown(n)))];
}

/** 把變數換成對應的值；不能用的變數換成空字串（發佈前已經擋下，這裡只是保險）。 */
export function fillEmailTemplate(
  template: string,
  values: Record<EmailTemplateVariable, string>,
): string {
  return template.replace(VARIABLE, (_, name: string) => (isKnown(name) ? values[name] : ''));
}
