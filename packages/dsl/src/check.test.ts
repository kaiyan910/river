import type { FormSchema } from '@river/forms';
import { describe, expect, it } from 'vitest';
import { checkProcess } from './check.js';
import { type ProcessDsl, type ProcessNode, processDslSchema } from './schema.js';

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
const formNode = (
  id: string,
  formId: string | null = 'advance',
  participantId: string | null = 'p-2',
): ProcessNode => ({
  id,
  type: 'form',
  name: `填表 ${id}`,
  formId,
  assignee: participantId ? { type: 'participant', participantId } : null,
  position: at,
});
const trip: FormSchema = {
  id: 'trip',
  name: '出差申請單',
  fields: [
    { id: 'f1', key: 'destination', type: 'text', label: '目的地', required: true, rules: {} },
  ],
};
const advance: FormSchema = {
  id: 'advance',
  name: '預支款確認',
  fields: [{ id: 'f2', key: 'amount', type: 'money', label: '金額', required: true, rules: {} }],
};
const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target });

/** start → 主管審批 → end */
function minimal(): ProcessDsl {
  return {
    nodes: [start(), approval('manager'), end()],
    edges: [edge('start', 'manager'), edge('manager', 'end')],
    forms: [],
  };
}

describe('DSL 檢查', () => {
  it('start → 審批 → end 且審批人已指派時沒有錯誤', () => {
    expect(checkProcess(minimal())).toEqual([]);
  });

  it('沒有 start 或 end 節點', () => {
    expect(checkProcess({ nodes: [approval('a')], edges: [], forms: [] })).toEqual([
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

  it('審批與填表節點可以指派給 Role', () => {
    const role = { type: 'role' as const, roleId: 'r-finance' };
    const dsl: ProcessDsl = {
      nodes: [
        start(),
        { ...formNode('register'), assignee: role } as ProcessNode,
        { ...approval('finance'), assignee: role } as ProcessNode,
        end(),
      ],
      edges: [edge('start', 'register'), edge('register', 'finance'), edge('finance', 'end')],
      forms: [advance],
    };

    expect(processDslSchema.parse(dsl)).toEqual(dsl);
    expect(checkProcess(dsl)).toEqual([]);
  });

  it('審批與填表節點可以指派給發起人的 Manager，並設定 Fallback Role', () => {
    const manager = { type: 'manager' as const, fallbackRoleId: 'r-hr' };
    const dsl: ProcessDsl = {
      nodes: [
        start(),
        { ...formNode('register'), assignee: manager } as ProcessNode,
        { ...approval('approve'), assignee: manager } as ProcessNode,
        end(),
      ],
      edges: [edge('start', 'register'), edge('register', 'approve'), edge('approve', 'end')],
      forms: [advance],
    };

    expect(processDslSchema.parse(dsl)).toEqual(dsl);
    expect(checkProcess(dsl)).toEqual([]);
  });

  it('指派給 Manager 的節點必須設定 Fallback Role', () => {
    const noFallback = { type: 'manager' as const, fallbackRoleId: null };
    const dsl: ProcessDsl = {
      nodes: [
        start(),
        { ...formNode('register'), assignee: noFallback } as ProcessNode,
        { ...approval('approve'), assignee: noFallback } as ProcessNode,
        end(),
      ],
      edges: [edge('start', 'register'), edge('register', 'approve'), edge('approve', 'end')],
      forms: [advance],
    };

    expect(checkProcess(dsl)).toEqual([
      {
        nodeId: 'register',
        code: 'MANAGER_NO_FALLBACK_ROLE',
        message: expect.stringContaining('填表 register'),
      },
      {
        nodeId: 'approve',
        code: 'MANAGER_NO_FALLBACK_ROLE',
        message: expect.stringContaining('審批 approve'),
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
      forms: [],
    };

    expect(checkProcess(dsl).map((e) => [e.code, e.nodeId])).toEqual([
      ['MISSING_END', null],
      ['DANGLING_EDGE', 'a'],
      ['UNREACHABLE_NODE', 'b'],
      ['APPROVAL_NO_ASSIGNEE', 'a'],
    ]);
  });

  describe('Form', () => {
    /** start（開始表單 trip）→ 財務填表（advance）→ 主管審批 → end */
    function withForms(): ProcessDsl {
      return {
        nodes: [
          { ...start(), formId: 'trip' } as ProcessNode,
          formNode('finance'),
          approval('manager'),
          end(),
        ],
        edges: [edge('start', 'finance'), edge('finance', 'manager'), edge('manager', 'end')],
        forms: [trip, advance],
      };
    }

    it('開始表單與填表節點都指定了正確的 Form 時沒有錯誤', () => {
      expect(checkProcess(withForms())).toEqual([]);
    });

    it('開始節點可以沒有開始表單', () => {
      const dsl = withForms();
      dsl.nodes[0] = start();
      expect(checkProcess(dsl)).toEqual([]);
    });

    it('填表節點必須指定 Form', () => {
      const dsl = withForms();
      dsl.nodes[1] = formNode('finance', null);

      expect(checkProcess(dsl)).toEqual([
        {
          nodeId: 'finance',
          code: 'FORM_NODE_NO_FORM',
          message: expect.stringContaining('填表 finance'),
        },
      ]);
    });

    it('填表節點必須指派填表人', () => {
      const dsl = withForms();
      dsl.nodes[1] = formNode('finance', 'advance', null);

      expect(checkProcess(dsl).map((e) => [e.code, e.nodeId])).toEqual([
        ['FORM_NODE_NO_ASSIGNEE', 'finance'],
      ]);
    });

    it('節點指定的 Form 不存在', () => {
      const dsl = withForms();
      dsl.forms = [advance];

      expect(checkProcess(dsl).map((e) => [e.code, e.nodeId])).toEqual([
        ['NODE_FORM_MISSING', 'start'],
      ]);
    });

    it('節點用到的 Form 有問題時一併回報，並標出是哪一份 Form、哪個欄位', () => {
      const dsl = withForms();
      dsl.forms = [
        {
          ...trip,
          fields: [{ ...(trip.fields[0] as FormSchema['fields'][number]), key: 'Bad Key' }],
        },
        advance,
      ];

      expect(checkProcess(dsl)).toEqual([
        {
          nodeId: null,
          formId: 'trip',
          fieldId: 'f1',
          code: 'FIELD_BAD_KEY',
          message: expect.any(String),
        },
      ]);
    });

    it('兩個節點共用的 Form 只回報一次', () => {
      const dsl = withForms();
      dsl.nodes[1] = formNode('finance', 'trip');
      dsl.forms = [{ ...trip, fields: [] }];

      expect(checkProcess(dsl).map((e) => e.code)).toEqual(['FORM_EMPTY']);
    });

    it('沒有節點使用的 Form 不擋發佈', () => {
      const dsl = withForms();
      dsl.forms.push({ id: 'draft', name: '', fields: [] });

      expect(checkProcess(dsl)).toEqual([]);
    });
  });
});
