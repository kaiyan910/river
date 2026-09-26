import { describe, expect, it } from 'vitest';
import { personRefs } from './people.js';
import type { FormSchema } from './schema.js';

const form: FormSchema = {
  id: 'expense',
  name: '報銷單',
  fields: [
    { id: 'f1', key: 'owner', type: 'person', label: '專案負責人', required: false, rules: {} },
    { id: 'f2', key: 'note', type: 'text', label: '備註', required: false, rules: {} },
    {
      id: 'f3',
      key: 'items',
      type: 'table',
      label: '明細',
      required: false,
      rules: {},
      columns: [
        { id: 'c1', key: 'amount', type: 'money', label: '金額', required: false, rules: {} },
        { id: 'c2', key: 'payee', type: 'person', label: '收款人', required: false, rules: {} },
      ],
    },
  ],
};

describe('人員選擇器選到的人', () => {
  it('列出一般欄位與明細表每一行選到的 Participant ID，鍵和驗證錯誤的鍵相同', () => {
    expect(
      personRefs(form, {
        owner: 'p1',
        note: 'p9',
        items: [
          { amount: 1, payee: 'p2' },
          { amount: 2, payee: null },
          { amount: 3, payee: 'p1' },
        ],
      }),
    ).toEqual([
      { path: 'owner', id: 'p1' },
      { path: 'items[0].payee', id: 'p2' },
      { path: 'items[2].payee', id: 'p1' },
    ]);
  });

  it('沒有選人或資料不完整時是空的', () => {
    expect(personRefs(form, { owner: null, items: 'x' })).toEqual([]);
  });
});
