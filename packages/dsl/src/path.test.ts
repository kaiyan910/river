import { describe, expect, it } from 'vitest';
import { type PathGraph, requestPath } from './path.js';

/**
 * start → check ─(days > 1)→ manual ─→ end
 *               └(預設)────→ auto ───┘
 */
const branching: PathGraph = {
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'check', type: 'condition' },
    { id: 'manual', type: 'approval' },
    { id: 'auto', type: 'approval' },
    { id: 'end', type: 'end' },
  ],
  edges: [
    { id: 'e-start', source: 'start', target: 'check' },
    { id: 'e-manual', source: 'check', target: 'manual' },
    { id: 'e-auto', source: 'check', target: 'auto' },
    { id: 'e-manual-end', source: 'manual', target: 'end' },
    { id: 'e-auto-end', source: 'auto', target: 'end' },
  ],
};

const ids = (path: ReturnType<typeof requestPath>) => path.steps.map((s) => s.nodeId);

describe('Request 實際走的路徑', () => {
  it('條件判斷後只走選中的分支，另一條分支被略過', () => {
    const path = requestPath(branching, new Map([['check', 'e-auto']]));
    expect(path.steps).toEqual([
      { nodeId: 'start', via: null },
      { nodeId: 'check', via: 'e-start' },
      { nodeId: 'auto', via: 'e-auto' },
      { nodeId: 'end', via: 'e-auto-end' },
    ]);
    expect(path.reachable.has('manual')).toBe(false);
  });

  it('條件還沒判斷時接到分支的匯合點，兩條分支都還可能走到', () => {
    const path = requestPath(branching, new Map());
    expect(path.steps).toEqual([
      { nodeId: 'start', via: null },
      { nodeId: 'check', via: 'e-start' },
      { nodeId: 'end', via: null },
    ]);
    expect([...path.reachable].sort()).toEqual(['auto', 'check', 'end', 'manual', 'start']);
  });

  it('匯合點是各條分支都會經過的第一個節點，不一定是結束', () => {
    const graph: PathGraph = {
      nodes: [...branching.nodes, { id: 'finance', type: 'approval' }],
      edges: [
        ...branching.edges.filter((e) => e.target !== 'end'),
        { id: 'e-manual-finance', source: 'manual', target: 'finance' },
        { id: 'e-auto-finance', source: 'auto', target: 'finance' },
        { id: 'e-finance-end', source: 'finance', target: 'end' },
      ],
    };
    expect(ids(requestPath(graph, new Map()))).toEqual(['start', 'check', 'finance', 'end']);
  });

  it('一條分支直接連到結束時，匯合點就是結束', () => {
    const graph: PathGraph = {
      nodes: branching.nodes,
      edges: branching.edges.map((e) => (e.id === 'e-auto' ? { ...e, target: 'end' } : e)),
    };
    expect(ids(requestPath(graph, new Map()))).toEqual(['start', 'check', 'end']);
    expect(ids(requestPath(graph, new Map([['check', 'e-auto']])))).toEqual([
      'start',
      'check',
      'end',
    ]);
  });

  it('連續的條件：前一個判斷過、後一個還沒判斷', () => {
    const graph: PathGraph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'c1', type: 'condition' },
        { id: 'c2', type: 'condition' },
        { id: 'a', type: 'approval' },
        { id: 'b', type: 'approval' },
        { id: 'end', type: 'end' },
      ],
      edges: [
        { id: 'e0', source: 'start', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'c2' },
        { id: 'e2', source: 'c1', target: 'end' },
        { id: 'e3', source: 'c2', target: 'a' },
        { id: 'e4', source: 'c2', target: 'b' },
        { id: 'e5', source: 'a', target: 'end' },
        { id: 'e6', source: 'b', target: 'end' },
      ],
    };
    const path = requestPath(graph, new Map([['c1', 'e1']]));
    expect(ids(path)).toEqual(['start', 'c1', 'c2', 'end']);
    expect(path.reachable.has('a') && path.reachable.has('b')).toBe(true);
  });

  it('遇到迴圈時停下，不會無限循環', () => {
    const graph: PathGraph = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'a', type: 'approval' },
        { id: 'b', type: 'approval' },
      ],
      edges: [
        { id: 'e0', source: 'start', target: 'a' },
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' },
      ],
    };
    expect(ids(requestPath(graph, new Map()))).toEqual(['start', 'a', 'b']);
  });

  /**
   * start → split ─→ it → security ─┐
   *               └→ finance ───────┴→ join → manager → end
   */
  const parallel: PathGraph = {
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'split', type: 'parallelSplit' },
      { id: 'it', type: 'approval' },
      { id: 'security', type: 'approval' },
      { id: 'finance', type: 'approval' },
      { id: 'join', type: 'parallelJoin' },
      { id: 'manager', type: 'approval' },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'e-start', source: 'start', target: 'split' },
      { id: 'e-it', source: 'split', target: 'it' },
      { id: 'e-finance', source: 'split', target: 'finance' },
      { id: 'e-security', source: 'it', target: 'security' },
      { id: 'e-security-join', source: 'security', target: 'join' },
      { id: 'e-finance-join', source: 'finance', target: 'join' },
      { id: 'e-join', source: 'join', target: 'manager' },
      { id: 'e-end', source: 'manager', target: 'end' },
    ],
  };

  it('並行分支的每一條分支都列出，依出邊順序一條接一條，最後接到匯合點', () => {
    const path = requestPath(parallel, new Map());
    expect(path.steps).toEqual([
      { nodeId: 'start', via: null },
      { nodeId: 'split', via: 'e-start' },
      { nodeId: 'it', via: 'e-it' },
      { nodeId: 'security', via: 'e-security' },
      { nodeId: 'finance', via: 'e-finance' },
      { nodeId: 'join', via: 'e-finance-join' },
      { nodeId: 'manager', via: 'e-join' },
      { nodeId: 'end', via: 'e-end' },
    ]);
    expect(path.reachable.size).toBe(parallel.nodes.length);
  });

  it('並行分支裡還沒判斷的條件，接到分支上的匯合點', () => {
    const graph: PathGraph = {
      nodes: [
        ...parallel.nodes,
        { id: 'check', type: 'condition' },
        { id: 'cio', type: 'approval' },
      ],
      edges: [
        ...parallel.edges.filter((e) => e.id !== 'e-security-join'),
        { id: 'e-check', source: 'security', target: 'check' },
        { id: 'e-cio', source: 'check', target: 'cio' },
        { id: 'e-skip', source: 'check', target: 'join' },
        { id: 'e-cio-join', source: 'cio', target: 'join' },
      ],
    };
    expect(ids(requestPath(graph, new Map()))).toEqual([
      'start',
      'split',
      'it',
      'security',
      'check',
      'finance',
      'join',
      'manager',
      'end',
    ]);
    expect(ids(requestPath(graph, new Map([['check', 'e-cio']])))).toContain('cio');
  });
});
