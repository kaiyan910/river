import { describe, expect, it } from 'vitest';
import { checkForm } from './check.js';
import type { FormField, FormSchema, TableColumn } from './schema.js';

function field(id: string, extra: Partial<FormField> = {}): FormField {
  return { id, key: id, type: 'text', label: `欄位 ${id}`, required: false, rules: {}, ...extra };
}
const form = (...fields: FormField[]): FormSchema => ({ id: 'trip', name: '出差申請單', fields });

describe('Form 檢查', () => {
  it('名稱、代碼、選項都正確的 Form 沒有錯誤', () => {
    expect(
      checkForm(
        form(
          field('destination', { required: true, rules: { maxLength: 50 } }),
          field('transport', { type: 'radio', options: ['高鐵', '飛機'] }),
          field('costCenter', { rules: { pattern: '^CC-\\d{4}$' } }),
        ),
      ),
    ).toEqual([]);
  });

  it('沒有名稱或沒有任何欄位', () => {
    expect(checkForm({ id: 'trip', name: ' ', fields: [] })).toEqual([
      { formId: 'trip', fieldId: null, code: 'FORM_NO_NAME', message: expect.any(String) },
      { formId: 'trip', fieldId: null, code: 'FORM_EMPTY', message: expect.any(String) },
    ]);
  });

  it('欄位名稱不能空白', () => {
    expect(checkForm(form(field('a', { label: '' })))).toEqual([
      { formId: 'trip', fieldId: 'a', code: 'FIELD_NO_LABEL', message: expect.any(String) },
    ]);
  });

  it.each(['', 'Destination', '1st', 'cost-center', '目的地'])(
    '欄位代碼要以小寫英文字母開頭，只能有英數與底線：「%s」',
    (key) => {
      expect(checkForm(form(field('a', { key }))).map((e) => e.code)).toEqual(['FIELD_BAD_KEY']);
    },
  );

  it('欄位代碼重複時，第二個欄位回報錯誤', () => {
    expect(checkForm(form(field('a', { key: 'amount' }), field('b', { key: 'amount' })))).toEqual([
      {
        formId: 'trip',
        fieldId: 'b',
        code: 'FIELD_DUPLICATE_KEY',
        message: expect.stringContaining('amount'),
      },
    ]);
  });

  it.each(['radio', 'multiselect'] as const)('%s 至少要有一個選項', (type) => {
    expect(checkForm(form(field('a', { type, options: ['', ' '] }))).map((e) => e.code)).toEqual([
      'FIELD_NO_OPTIONS',
    ]);
  });

  it('沒有重複的分支、單層的重複都是安全的格式', () => {
    for (const pattern of ['^(高鐵|飛機)$', '^CC-\\d{4}$', '^[A-Z]+(-\\d+)?$', '^(ab)+$'])
      expect(checkForm(form(field('a', { rules: { pattern } })))).toEqual([]);
  });

  it('選項不能重複', () => {
    const f = field('a', { type: 'radio', options: ['高鐵', '高鐵'] });
    expect(checkForm(form(f)).map((e) => e.code)).toEqual(['FIELD_DUPLICATE_OPTION']);
  });

  it.each([
    ['最小值大於最大值', { min: 10, max: 1 }],
    ['最少字數大於最多字數', { minLength: 10, maxLength: 5 }],
  ])('%s', (_, rules) => {
    expect(checkForm(form(field('a', { rules }))).map((e) => e.code)).toEqual(['FIELD_BAD_RANGE']);
  });

  it.each([
    ['不是有效的正規表示式', '(abc'],
    ['巢狀的重複（可能造成 ReDoS）', '^(a+)+$'],
    ['重複的群組裡有 *', '(\\w*)*'],
    ['重複的群組裡有分支（分支可能重疊）', '^(a|aa)+$'],
  ])('格式%s', (_, pattern) => {
    expect(checkForm(form(field('a', { rules: { pattern } }))).map((e) => e.code)).toEqual([
      'FIELD_BAD_PATTERN',
    ]);
  });
});

describe('明細表的欄位', () => {
  const column = (id: string, extra: Partial<TableColumn> = {}): TableColumn => ({
    id,
    key: id,
    type: 'text',
    label: `欄 ${id}`,
    required: false,
    rules: {},
    ...extra,
  });
  const table = (columns: TableColumn[]) =>
    field('items', { type: 'table', label: '報銷明細', columns });

  it('欄位定義正確的明細表沒有錯誤；代碼只需要在同一張明細表裡不重複', () => {
    expect(
      checkForm(form(field('item'), table([column('item'), column('amount', { type: 'money' })]))),
    ).toEqual([]);
  });

  it('明細表至少要有一個欄位', () => {
    expect(checkForm(form(table([])))).toEqual([
      { formId: 'trip', fieldId: 'items', code: 'FIELD_NO_COLUMNS', message: expect.any(String) },
    ]);
  });

  it('明細表的欄位和一般欄位一樣檢查，錯誤標在那個欄位上', () => {
    expect(
      checkForm(
        form(
          table([
            column('a', { label: '' }),
            column('b', { key: 'a' }),
            column('c', { type: 'radio', options: [] }),
            column('d', { key: 'Bad' }),
          ]),
        ),
      ).map((e) => [e.fieldId, e.code]),
    ).toEqual([
      ['a', 'FIELD_NO_LABEL'],
      ['b', 'FIELD_DUPLICATE_KEY'],
      ['c', 'FIELD_NO_OPTIONS'],
      ['d', 'FIELD_BAD_KEY'],
    ]);
  });
});
