import { describe, expect, it } from 'vitest';
import type { FormField, FormSchema } from './schema.js';
import { validateFormData } from './validate.js';

const TODAY = '2026-09-26';

let seq = 0;
function field(key: string, type: FormField['type'], extra: Partial<FormField> = {}): FormField {
  return { id: `f${++seq}`, key, type, label: key, required: false, rules: {}, ...extra };
}
const form = (...fields: FormField[]): FormSchema => ({ id: 'form', name: '表單', fields });

const check = (f: FormSchema, data: unknown) => validateFormData(f, data, { today: TODAY });

describe('依 Form schema 驗證填寫的資料', () => {
  it('必填欄位空白時回報「必填」', () => {
    const result = check(form(field('destination', 'text', { required: true })), {
      destination: '  ',
    });

    expect(result).toEqual({ success: false, errors: { destination: '必填' } });
  });

  it('通過時回傳正規化的資料：文字去掉前後空白、數字欄位的字串轉成數字', () => {
    const trip = form(
      field('destination', 'text'),
      field('reason', 'textarea'),
      field('days', 'number'),
      field('budget', 'money'),
      field('departDate', 'date'),
      field('transport', 'radio', { options: ['高鐵', '飛機'] }),
      field('needs', 'multiselect', { options: ['訂車票', '訂住宿', '預支現金'] }),
      field('agree', 'checkbox'),
    );

    const result = check(trip, {
      destination: ' 高雄 ',
      reason: '拜訪客戶',
      days: '3',
      budget: 12500.5,
      departDate: '2026-10-06',
      transport: '高鐵',
      needs: ['訂車票', '訂住宿'],
      agree: true,
    });

    expect(result).toEqual({
      success: true,
      data: {
        destination: '高雄',
        reason: '拜訪客戶',
        days: 3,
        budget: 12500.5,
        departDate: '2026-10-06',
        transport: '高鐵',
        needs: ['訂車票', '訂住宿'],
        agree: true,
      },
    });
  });

  it('選填欄位沒有填時存成空值，沒有列在 schema 的鍵會被丟掉', () => {
    const f = form(
      field('note', 'text'),
      field('amount', 'money'),
      field('when', 'date'),
      field('pick', 'radio', { options: ['A'] }),
      field('tags', 'multiselect', { options: ['A'] }),
      field('ok', 'checkbox'),
    );

    expect(check(f, { note: '', amount: '', salary: 999999 })).toEqual({
      success: true,
      data: { note: null, amount: null, when: null, pick: null, tags: [], ok: false },
    });
  });

  it.each<[string, FormField, unknown, string]>([
    [
      '文字少於最少字數',
      field('v', 'textarea', { rules: { minLength: 10 } }),
      '太短',
      '至少 10 個字',
    ],
    [
      '文字超過最多字數',
      field('v', 'text', { rules: { maxLength: 5 } }),
      '一二三四五六',
      '最多 5 個字',
    ],
    ['單行文字沒設上限時最多 200 字', field('v', 'text'), 'a'.repeat(201), '最多 200 個字'],
    ['多行文字沒設上限時最多 5000 字', field('v', 'textarea'), 'a'.repeat(5001), '最多 5000 個字'],
    [
      '格式不符時顯示 Designer 設定的訊息',
      field('v', 'text', { rules: { pattern: '^CC-\\d{4}$', patternMessage: '格式為 CC-0000' } }),
      'CC-12',
      '格式為 CC-0000',
    ],
    [
      '格式不符且沒有設定訊息',
      field('v', 'text', { rules: { pattern: '^\\d+$' } }),
      'x',
      '格式不正確',
    ],
    ['數字欄位不是數字', field('v', 'number'), 'abc', '請輸入數字'],
    ['數字欄位只接受整數', field('v', 'number'), '3.5', '請輸入整數'],
    ['小於最小值', field('v', 'number', { rules: { min: 1 } }), 0, '不能小於 1'],
    ['大於最大值', field('v', 'money', { rules: { max: 200000 } }), '200001', '不能大於 200,000'],
    ['金額最多到小數點後兩位', field('v', 'money'), 12.345, '最多到小數點後兩位'],
    ['日期格式不正確', field('v', 'date'), '2026/10/06', '日期格式不正確'],
    ['不存在的日期', field('v', 'date'), '2026-02-30', '日期格式不正確'],
    [
      '日期早於今天',
      field('v', 'date', { rules: { notPast: true } }),
      '2026-09-25',
      '不能早於今天',
    ],
    ['單選的值不在選項裡', field('v', 'radio', { options: ['高鐵'] }), '火箭', '不是有效的選項'],
    [
      '多選的值不在選項裡',
      field('v', 'multiselect', { options: ['A'] }),
      ['A', 'B'],
      '不是有效的選項',
    ],
    [
      '多選的必填至少選一項',
      field('v', 'multiselect', { required: true, options: ['A'] }),
      [],
      '至少選擇一項',
    ],
    [
      '多選超過最多幾項',
      field('v', 'multiselect', { options: ['A', 'B', 'C'], rules: { maxSelected: 2 } }),
      ['A', 'B', 'C'],
      '最多選 2 項',
    ],
    ['必填的 checkbox 沒有勾選', field('v', 'checkbox', { required: true }), false, '必須勾選'],
    ['型別不對', field('v', 'text'), 42, '請輸入文字'],
  ])('%s', (_, f, value, message) => {
    expect(check(form(f), { v: value })).toEqual({ success: false, errors: { v: message } });
  });

  it('今天的日期不算早於今天', () => {
    const f = form(field('v', 'date', { rules: { notPast: true } }));
    expect(check(f, { v: TODAY })).toEqual({ success: true, data: { v: TODAY } });
  });

  it('不是物件的資料整份被拒絕', () => {
    expect(check(form(field('v', 'text')), ['v']).success).toBe(false);
  });
});
