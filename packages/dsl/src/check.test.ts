import { describe, expect, it } from 'vitest';
import { checkProcess } from './check.js';
import type { ProcessDsl, ProcessNode } from './schema.js';

const at = { x: 0, y: 0 };
const start = (id = 'start'): ProcessNode => ({ id, type: 'start', name: '開始', position: at });
const end = (id = 'end'): ProcessNode => ({ id, type: 'end', name: '結束', position: at });
const approval = (id: string, participantId: string | null = 'p-1'): ProcessNode => ({
  id,
  type: 'approval',
  name: `審批 ${id}`,
  assignee: participantId ? { type: 'participant', participantId } : null,
  position: at,
});
const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target });

/** start → 主管審批 → end */
function minimal(): ProcessDsl {
  return {
    nodes: [start(), approval('manager'), end()],
    edges: [edge('start', 'manager'), edge('manager', 'end')],
  };
}

describe('DSL 檢查', () => {
  it('start → 審批 → end 且審批人已指派時沒有錯誤', () => {
    expect(checkProcess(minimal())).toEqual([]);
  });

  it('沒有 start 或 end 節點', () => {
    expect(checkProcess({ nodes: [approval('a')], edges: [] })).toEqual([
      { nodeId: null, code: 'MISSING_START', message: expect.any(String) },
      { nodeId: null, code: 'MISSING_END', message: expect.any(String) },
    ]);
  });

  it('從 start 到不了的節點', () => {
    const dsl = minimal();
    dsl.nodes.push(approval('orphan'));

    expect(checkProcess(dsl)).toEqual([
      {
        nodeId: 'orphan',
        code: 'UNREACHABLE_NODE',
        message: expect.stringContaining('審批 orphan'),
      },
    ]);
  });

  it('只能從到不了的節點走到的節點，同樣算到不了', () => {
    const dsl = minimal();
    dsl.nodes.push(approval('orphan'), approval('after-orphan'));
    dsl.edges.push(edge('orphan', 'after-orphan'));

    expect(checkProcess(dsl).map((e) => [e.code, e.nodeId])).toEqual([
      ['UNREACHABLE_NODE', 'orphan'],
      ['UNREACHABLE_NODE', 'after-orphan'],
    ]);
  });

  it('連線有一端接到不存在的節點時是懸空的邊', () => {
    const dsl = minimal();
    dsl.edges.push(edge('manager', 'gone'), edge('gone', 'end'));

    expect(checkProcess(dsl)).toEqual([
      { nodeId: 'manager', code: 'DANGLING_EDGE', message: expect.any(String) },
      { nodeId: 'end', code: 'DANGLING_EDGE', message: expect.any(String) },
    ]);
  });

  it('兩端都不存在的邊，節點 ID 是 null', () => {
    const dsl = minimal();
    dsl.edges.push(edge('ghost-a', 'ghost-b'));

    expect(checkProcess(dsl)).toEqual([
      { nodeId: null, code: 'DANGLING_EDGE', message: expect.any(String) },
    ]);
  });

  it('審批節點沒有指派對象', () => {
    const dsl = minimal();
    dsl.nodes[1] = approval('manager', null);

    expect(checkProcess(dsl)).toEqual([
      {
        nodeId: 'manager',
        code: 'APPROVAL_NO_ASSIGNEE',
        message: expect.stringContaining('審批 manager'),
      },
    ]);
  });

  it('節點名稱不能空白', () => {
    const dsl = minimal();
    dsl.nodes[1] = { ...approval('manager'), name: '  ' };

    expect(checkProcess(dsl)).toEqual([
      { nodeId: 'manager', code: 'NODE_NO_NAME', message: expect.any(String) },
    ]);
  });

  it('沒有 start 時不另外回報到不了的節點', () => {
    const dsl = minimal();
    dsl.nodes.shift();
    dsl.edges.shift();

    expect(checkProcess(dsl).map((e) => e.code)).toEqual(['MISSING_START']);
  });

  it('同一份 DSL 會列出所有錯誤', () => {
    const dsl: ProcessDsl = {
      nodes: [start(), approval('a', null), approval('b')],
      edges: [edge('start', 'a'), edge('a', 'missing')],
    };

    expect(checkProcess(dsl).map((e) => [e.code, e.nodeId])).toEqual([
      ['MISSING_END', null],
      ['DANGLING_EDGE', 'a'],
      ['UNREACHABLE_NODE', 'b'],
      ['APPROVAL_NO_ASSIGNEE', 'a'],
    ]);
  });
});
