import type { FormSchema } from './schema.js';
import { fieldPath } from './validate.js';

/** 人員選擇器選到的一位 Participant；path 和驗證錯誤的鍵相同（例如 owner、items[0].payee）。 */
export interface PersonRef {
  path: string;
  id: string;
}

/**
 * 列出一份資料（正規化後、存進 request_data 的樣子）中人員選擇器選到的所有 Participant ID，
 * 包括明細表每一行的人員欄。API 用來檢查人員是否存在且沒有停用，以及唯讀顯示時查出姓名。
 */
export function personRefs(form: FormSchema, data: Record<string, unknown>): PersonRef[] {
  const refs: PersonRef[] = [];
  for (const f of form.fields) {
    const v = data[f.key];
    if (f.type === 'person' && typeof v === 'string') refs.push({ path: f.key, id: v });
    if (f.type !== 'table' || !Array.isArray(v)) continue;
    v.forEach((row: unknown, i) => {
      if (!row || typeof row !== 'object') return;
      for (const c of f.columns ?? []) {
        const id = (row as Record<string, unknown>)[c.key];
        if (c.type === 'person' && typeof id === 'string')
          refs.push({ path: fieldPath([f.key, i, c.key]), id });
      }
    });
  }
  return refs;
}
