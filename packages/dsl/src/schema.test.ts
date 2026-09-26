import { describe, expect, it } from 'vitest';
import { nodesInOrder, type ProcessDsl, type ProcessNode } from './schema.js';

const at = { x: 0, y: 0 };
const node = (id: string, type: 'start' | 'condition' | 'end' = 'condition'): ProcessNode =>
  ({ id, type, name: id, position: at }) as ProcessNode;
const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target });

describe('流程預覽的節點順序', () => {
  it('一直線的流程依連線順序排列', () => {
    const dsl: ProcessDsl = {
      nodes: [node('end', 'end'), node('b'), node('start', 'start'), node('a')],
      edges: [edge('start', 'a'), edge('a', 'b'), edge('b', 'end')],
      forms: [],
    };
    expect(nodesInOrder(dsl).map((n) => n.id)).toEqual(['start', 'a', 'b', 'end']);
  });

  it('有分支時列出每條分支上的節點，匯合點排在所有分支之後', () => {
    const dsl: ProcessDsl = {
      nodes: [node('start', 'start'), node('c'), node('gm'), node('finance'), node('end', 'end')],
      edges: [
        edge('start', 'c'),
        edge('c', 'finance'),
        edge('c', 'gm'),
        edge('gm', 'finance'),
        edge('finance', 'end'),
      ],
      forms: [],
    };
    expect(nodesInOrder(dsl).map((n) => n.id)).toEqual(['start', 'c', 'gm', 'finance', 'end']);
  });

  it('從「開始」走不到的節點不列出；有迴圈時每個節點只列一次', () => {
    const dsl: ProcessDsl = {
      nodes: [node('start', 'start'), node('a'), node('orphan'), node('end', 'end')],
      edges: [edge('start', 'a'), edge('a', 'start'), edge('a', 'end')],
      forms: [],
    };
    expect(nodesInOrder(dsl).map((n) => n.id)).toEqual(['start', 'a', 'end']);
  });
});
