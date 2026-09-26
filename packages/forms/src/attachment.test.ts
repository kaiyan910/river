import { describe, expect, it } from 'vitest';
import { acceptsFile, normalizeAccept } from './attachment.js';
import { checkForm } from './check.js';
import type { FormField, FormSchema } from './schema.js';
import { validateFormData } from './validate.js';

const receipts = (extra: Partial<FormField> = {}): FormField => ({
  id: 'f1',
  key: 'receipts',
  type: 'attachment',
  label: '收據',
  required: false,
  rules: {},
  ...extra,
});
const form = (f: FormField): FormSchema => ({ id: 'form', name: '報銷單', fields: [f] });
const check = (f: FormField, data: unknown) =>
  validateFormData(form(f), data, { today: '2026-09-26' });

const MB = 1024 * 1024;
const file = (n: number, name: string, size = 1000, contentType = 'application/pdf') => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  name,
  size,
  contentType,
});

describe('附件欄位', () => {
  it('值是附件清單；沒有上傳時存成空陣列，必填時至少要一個', () => {
    expect(check(receipts(), {})).toEqual({ success: true, data: { receipts: [] } });
    expect(check(receipts({ required: true }), { receipts: [] })).toEqual({
      success: false,
      errors: { receipts: '至少上傳一個檔案' },
    });
  });

  it('通過時只留下附件的中繼資料，重複的附件只算一次', () => {
    const a = file(1, '收據.pdf');
    const result = check(receipts(), { receipts: [{ ...a, extra: 'x' }, a] });
    expect(result).toEqual({ success: true, data: { receipts: [a] } });
  });

  it('檔案類型、大小上限與數量都依 Designer 的設定檢查', () => {
    const f = receipts({ rules: { accept: ['.pdf', '.jpg'], maxSizeMb: 2, maxFiles: 2 } });

    expect(check(f, { receipts: [file(1, 'a.PDF'), file(2, 'b.jpg')] }).success).toBe(true);
    expect(check(f, { receipts: [file(1, '報價單.docx')] })).toEqual({
      success: false,
      errors: { receipts: '「報價單.docx」的檔案類型不允許，只接受 .pdf、.jpg' },
    });
    expect(check(f, { receipts: [file(1, 'big.pdf', 2 * MB + 1)] })).toEqual({
      success: false,
      errors: { receipts: '「big.pdf」超過 2 MB' },
    });
    expect(check(f, { receipts: [file(1, 'a.pdf'), file(2, 'b.pdf'), file(3, 'c.pdf')] })).toEqual({
      success: false,
      errors: { receipts: '最多 2 個檔案' },
    });
  });

  it('不是附件清單時回報格式不正確', () => {
    expect(check(receipts(), { receipts: 'a.pdf' }).success).toBe(false);
    expect(check(receipts(), { receipts: [{ name: 'a.pdf' }] }).success).toBe(false);
  });

  it('允許的檔案類型：副檔名不分大小寫；沒有設定時都可以', () => {
    expect(acceptsFile(undefined, 'a.exe')).toBe(true);
    expect(acceptsFile(['.pdf'], 'A.PDF')).toBe(true);
    expect(acceptsFile(['.pdf'], 'pdf')).toBe(false);
    expect(normalizeAccept(' PDF, .jpg ,,png ')).toEqual(['.pdf', '.jpg', '.png']);
  });

  it('發佈前檢查：副檔名格式不正確時回報錯誤', () => {
    expect(checkForm(form(receipts({ rules: { accept: ['.pdf'] } })))).toEqual([]);
    expect(checkForm(form(receipts({ rules: { accept: ['pdf', '.p d f'] } })))).toEqual([
      { formId: 'form', fieldId: 'f1', code: 'FIELD_BAD_ACCEPT', message: expect.any(String) },
    ]);
  });
});
