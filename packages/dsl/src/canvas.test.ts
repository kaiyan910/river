import { describe, expect, it } from 'vitest';
import { fromCanvas, toCanvas } from './canvas.js';
import { checkProcess } from './check.js';
import type { ProcessDsl } from './schema.js';

const dsl: ProcessDsl = {
  nodes: [
    { id: 'start', type: 'start', name: '開始', position: { x: 0, y: 0 } },
    { id: 'a', type: 'approval', name: '主管審批', assignee: null, position: { x: 0, y: 170 } },
    { id: 'end', type: 'end', name: '結束', position: { x: 0, y: 340 } },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'a' },
    { id: 'e2', source: 'a', target: 'end' },
  ],
  forms: [{ id: 'trip', name: '出差申請單', fields: [] }],
};

describe('畫布與 DSL 的轉換', () => {
  it('轉成畫布再轉回來，得到同一份 DSL', () => {
    expect(fromCanvas(toCanvas(dsl), dsl.forms)).toEqual(dsl);
  });

  it('畫布節點帶著檢查器對它回報的錯誤', () => {
    const canvas = toCanvas(dsl, checkProcess(dsl));

    expect(canvas.nodes.map((n) => [n.id, n.data.errors.map((e) => e.code)])).toEqual([
      ['start', []],
      ['a', ['APPROVAL_NO_ASSIGNEE']],
      ['end', []],
    ]);
  });

  it('畫布上拖動、改設定後轉回的 DSL 反映新位置與設定', () => {
    const canvas = toCanvas(dsl);
    const moved = canvas.nodes.map((n) =>
      n.id === 'a'
        ? {
            ...n,
            position: { x: 40, y: 200 },
            data: {
              ...n.data,
              node: {
                ...n.data.node,
                assignee: { type: 'participant' as const, participantId: 'p-9' },
              },
            },
            // React Flow 會在節點上加自己的欄位，轉換時要忽略。
            selected: true,
            measured: { width: 200, height: 60 },
          }
        : n,
    );

    expect(fromCanvas({ nodes: moved, edges: canvas.edges }).nodes[1]).toEqual({
      id: 'a',
      type: 'approval',
      name: '主管審批',
      assignee: { type: 'participant', participantId: 'p-9' },
      position: { x: 40, y: 200 },
    });
  });
});
