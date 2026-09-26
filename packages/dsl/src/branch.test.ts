import { describe, expect, it } from 'vitest';
import { chooseBranch, evaluateHttpBody, shouldAutoApprove } from './branch.js';
import type { ProcessEdge } from './schema.js';

const when = (id: string, expression: string): ProcessEdge => ({
  id,
  source: 'amount',
  target: id,
  branch: { type: 'expression', expression },
});
const otherwise: ProcessEdge = {
  id: 'default',
  source: 'amount',
  target: 'end',
  branch: { type: 'default' },
};

describe('選擇條件節點的出邊', () => {
  const edges = [when('gm', 'amount > 100000'), otherwise, when('manager', 'amount > 10000')];

  it('依出邊順序評估，第一個成立的出邊勝出', async () => {
    expect(await chooseBranch(edges, { amount: 200000 })).toBe('gm');
    expect(await chooseBranch(edges, { amount: 50000 })).toBe('manager');
  });

  it('沒有任何條件成立時走預設出邊', async () => {
    expect(await chooseBranch(edges, { amount: 500 })).toBe('default');
  });

  it('可以用欄位代碼讀取多個欄位', async () => {
    const byType = [when('travel', "type = '出差' and days >= 3"), otherwise];
    expect(await chooseBranch(byType, { type: '出差', days: 5 })).toBe('travel');
    expect(await chooseBranch(byType, { type: '出差', days: 1 })).toBe('default');
  });

  it('欄位沒有填時條件不成立', async () => {
    expect(await chooseBranch(edges, { amount: null })).toBe('default');
    expect(await chooseBranch(edges, {})).toBe('default');
  });

  it('結果不是 true 的表達式不算成立', async () => {
    expect(await chooseBranch([when('truthy', 'amount'), otherwise], { amount: 1 })).toBe(
      'default',
    );
  });

  it('執行時出錯的表達式視為不成立，繼續評估下一條，並回報是哪一條出錯', async () => {
    const failing = [when('bad', '$number(note) > 1'), when('ok', 'true'), otherwise];
    const errors: string[] = [];
    expect(await chooseBranch(failing, { note: 'abc' }, (id) => errors.push(id))).toBe('ok');
    expect(errors).toEqual(['bad']);
  });

  it('沒有預設出邊又沒有條件成立時回傳 null', async () => {
    expect(await chooseBranch([when('gm', 'amount > 1')], { amount: 0 })).toBeNull();
  });
});

describe('判斷是否自動核准', () => {
  it('結果是 true 時自動核准', async () => {
    expect(await shouldAutoApprove('amount < 1000', { amount: 800 })).toBe(true);
  });

  it('結果是 false、不是 true（truthy 也不算）或欄位沒有填時不自動核准', async () => {
    expect(await shouldAutoApprove('amount < 1000', { amount: 5000 })).toBe(false);
    expect(await shouldAutoApprove('amount', { amount: 1 })).toBe(false);
    expect(await shouldAutoApprove('amount < 1000', {})).toBe(false);
  });

  it('執行時出錯時不自動核准，並回報錯誤', async () => {
    const errors: unknown[] = [];
    expect(
      await shouldAutoApprove('$number(note) < 1', { note: 'abc' }, (e) => errors.push(e)),
    ).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('語法錯誤時不自動核准', async () => {
    expect(await shouldAutoApprove('amount <', { amount: 1 })).toBe(false);
  });
});

describe('HTTP 節點的 body', () => {
  const data = { destination: '台中', amount: 1200, items: [{ name: '高鐵' }, { name: '住宿' }] };

  it('以 JSONata 從 Request 資料組成 body', async () => {
    await expect(
      evaluateHttpBody('{ "to": destination, "total": amount * 2, "items": items.name }', data),
    ).resolves.toEqual({ to: '台中', total: 2400, items: ['高鐵', '住宿'] });
  });

  it('空白的表達式代表沒有 body', async () => {
    await expect(evaluateHttpBody('  ', data)).resolves.toBeUndefined();
  });

  it('執行時出錯就丟出錯誤，不當作空的 body 送出', async () => {
    await expect(evaluateHttpBody('amount + destination', data)).rejects.toBeDefined();
  });
});
