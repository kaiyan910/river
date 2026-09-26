import { describe, expect, it } from 'vitest';
import { fillEmailTemplate, unknownTemplateVariables } from './email-template.js';

const values = {
  requestTitle: '10/3 特休',
  processName: '請假',
  link: 'https://river.test/requests?id=r-1',
};

describe('Email 節點的訊息範本', () => {
  it('把變數換成對應的值，大括號裡可以有空白', () => {
    expect(fillEmailTemplate('「{{requestTitle}}」（{{ processName }}）：{{link}}', values)).toBe(
      '「10/3 特休」（請假）：https://river.test/requests?id=r-1',
    );
  });

  it('不能用的變數換成空字串，不會把原本的寫法留在信裡', () => {
    expect(fillEmailTemplate('金額 {{amount}} 元', values)).toBe('金額  元');
  });

  it('列出不能用的變數，每個只列一次', () => {
    expect(unknownTemplateVariables('{{amount}} {{requestTitle}} {{ amount }} {{}}')).toEqual([
      'amount',
      '',
    ]);
  });
});
