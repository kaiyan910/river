import {
  type Assignee,
  type Branch,
  type CanvasEdgeData,
  type CanvasNodeData,
  checkProcess,
  type EmailRecipient,
  type Escalation,
  fromCanvas,
  isSystemNode,
  NODE_TYPE_LABELS,
  type NodeSettings,
  type NodeType,
  type ProcessDsl,
  type ProcessNode,
  type Reminder,
  toCanvas,
} from '@river/dsl';
import type { FormSchema } from '@river/forms';
import { useQuery } from '@tanstack/react-query';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  Handle,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
} from '@xyflow/react';
import {
  AlarmClock,
  CirclePlay,
  CircleStop,
  ClipboardPen,
  FileText,
  GitFork,
  GitMerge,
  Globe,
  KeyRound,
  Mail,
  Split,
  UserCheck,
  UserRoundCheck,
  Users,
  Zap,
} from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Avatar } from '@/components/people';
import { directoryQueryOptions, roleDirectoryQueryOptions } from '@/lib/org';
import { branchLabel } from '@/lib/processes';
import { cn } from '@/lib/utils';

export type RFNode = Node<CanvasNodeData, NodeType>;
export type RFEdge = Edge<CanvasEdgeData>;

export const NODE_ICONS = {
  start: CirclePlay,
  form: ClipboardPen,
  approval: UserCheck,
  condition: Split,
  parallelSplit: GitFork,
  parallelJoin: GitMerge,
  email: Mail,
  http: Globe,
  end: CircleStop,
} as const;

/** 畫布節點顯示 Form 名稱用；由編輯器提供目前的 Form 清單。 */
export const CanvasFormsContext = createContext<FormSchema[]>([]);

/** 節點的寬度與大約高度；置中節點、在畫面中央新增節點時用來算中心點。 */
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 60;

function newNodeId(type: NodeType): string {
  return `${type}-${crypto.randomUUID().slice(0, 8)}`;
}

function newNode(type: NodeType, position: { x: number; y: number }): ProcessNode {
  const base = { id: newNodeId(type), name: NODE_TYPE_LABELS[type], position };
  switch (type) {
    case 'approval':
      return { ...base, type, name: '新的審批', assignee: null };
    case 'form':
      return { ...base, type, name: '新的填表', formId: null, assignee: null };
    case 'start':
      return { ...base, type, formId: null };
    case 'condition':
      return { ...base, type, name: '新的條件' };
    case 'email':
      return {
        ...base,
        type,
        name: '寄送 Email',
        recipient: null,
        subject: '「{{requestTitle}}」有新的進度',
        message: '{{processName}} 的申請「{{requestTitle}}」有新的進度，請到平台查看。',
      };
    case 'http':
      return {
        ...base,
        type,
        name: '呼叫外部系統',
        method: 'POST',
        url: '',
        body: '',
        credential: null,
      };
    case 'parallelSplit':
    case 'parallelJoin':
    case 'end':
      return { ...base, type };
  }
}

/** 比較兩份 DSL 的內容；API 回傳的物件欄位順序與畫布轉出的不同，所以先排序欄位再比較。 */
export function sameDsl(a: ProcessDsl, b: ProcessDsl): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1)))
      : v,
  );
}

/**
 * 編輯器狀態：React Flow 的節點與邊、Form 清單，以及由它們組成的 DSL 與即時檢查結果。
 * 轉換與檢查都用 @river/dsl，與 API 拒絕發佈時的結果一致。
 */
export function useProcessCanvas(initial: ProcessDsl) {
  const [nodes, setNodes] = useState<RFNode[]>(() => toCanvas(initial).nodes);
  const [edges, setEdges] = useState<RFEdge[]>(() => toCanvas(initial).edges);
  const [forms, setForms] = useState<FormSchema[]>(() => initial.forms);

  const dsl = useMemo(() => fromCanvas({ nodes, edges }, forms), [nodes, edges, forms]);
  const errors = useMemo(() => checkProcess(dsl), [dsl]);
  const nodesWithErrors = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: { ...n.data, errors: errors.filter((e) => e.nodeId === n.id) },
      })),
    [nodes, errors],
  );
  /** 條件節點的出邊在線上標出條件；有錯誤的出邊畫成紅色。 */
  const labeledEdges = useMemo(
    () =>
      edges.map((e): RFEdge => {
        const branch = e.data?.branch;
        if (!branch) return e;
        const invalid = errors.some((err) => err.edgeId === e.id);
        return {
          ...e,
          label: branchLabel(branch),
          labelStyle: invalid ? { fill: 'var(--destructive)' } : undefined,
          style: invalid ? { stroke: 'var(--destructive)' } : e.style,
        };
      }),
    [edges, errors],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<RFNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<RFEdge>[]) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  );
  // 條件節點的新出邊先帶一個空白的表達式，由屬性面板填寫或改成預設出邊。
  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source === c.target) return;
      const fromCondition = nodes.some((n) => n.id === c.source && n.type === 'condition');
      const edge: RFEdge = {
        ...c,
        id: `edge-${crypto.randomUUID().slice(0, 8)}`,
        ...(fromCondition && { data: { branch: { type: 'expression', expression: '' } } }),
      };
      setEdges((es) => addEdge(edge, es));
    },
    [nodes],
  );

  const updateBranch = useCallback((edgeId: string, branch: Branch) => {
    setEdges((es) => {
      const source = es.find((e) => e.id === edgeId)?.source;
      return es.map((e) => {
        if (e.id === edgeId) return { ...e, data: { ...e.data, branch } };
        // 同一個條件節點只能有一條預設出邊：選了新的預設出邊，原本的改回表達式。
        if (branch.type === 'default' && e.source === source && e.data?.branch?.type === 'default')
          return { ...e, data: { ...e.data, branch: { type: 'expression', expression: '' } } };
        return e;
      });
    });
  }, []);

  /** 把出邊和同一個節點的上一條（-1）或下一條（1）出邊對調；條件依出邊順序評估。 */
  const moveEdge = useCallback((edgeId: string, delta: -1 | 1) => {
    setEdges((es) => {
      const edge = es.find((e) => e.id === edgeId);
      if (!edge) return es;
      const siblings = es.filter((e) => e.source === edge.source);
      const other = siblings[siblings.indexOf(edge) + delta];
      if (!other) return es;
      return es.map((e) => (e === edge ? other : e === other ? edge : e));
    });
  }, []);

  const addNode = useCallback((type: NodeType, position: { x: number; y: number }) => {
    const [node] = toCanvas({ nodes: [newNode(type, position)], edges: [], forms: [] }).nodes;
    if (!node) return;
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
  }, []);

  const updateNode = useCallback((id: string, patch: Partial<NodeSettings>) => {
    setNodes((ns) =>
      ns.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, node: { ...n.data.node, ...patch } as NodeSettings } }
          : n,
      ),
    );
  }, []);

  const removeNode = useCallback((id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
  }, []);

  const select = useCallback((id: string | null) => {
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
  }, []);

  const reset = useCallback((next: ProcessDsl) => {
    const canvas = toCanvas(next);
    setNodes(canvas.nodes);
    setEdges(canvas.edges);
    setForms(next.forms);
  }, []);

  return {
    nodes: nodesWithErrors,
    edges: labeledEdges,
    dsl,
    errors,
    selected: nodesWithErrors.find((n) => n.selected) ?? null,
    onNodesChange,
    onEdgesChange,
    onConnect,
    updateBranch,
    moveEdge,
    addNode,
    updateNode,
    removeNode,
    select,
    reset,
    forms,
    setForms,
  };
}

function NodeCard({ data, selected, type }: NodeProps<RFNode>) {
  const Icon = NODE_ICONS[type];
  const hasError = data.errors.length > 0;
  // 結束，以及沒有開始表單的開始節點，畫成膠囊形。
  const round = type === 'end' || (data.node.type === 'start' && !data.node.formId);
  return (
    <div
      style={{ width: NODE_WIDTH }}
      className={cn(
        'relative rounded-lg border bg-card px-3 py-2 shadow-sm',
        round && 'rounded-full text-center',
        type === 'form' && 'border-l-4 border-l-status-returned',
        isSystemNode(data.node) && 'border-dashed',
        selected && 'border-primary ring-2 ring-primary/30',
        hasError && 'border-destructive ring-2 ring-destructive/25',
      )}
      title={data.errors.map((e) => e.message).join('\n') || undefined}
    >
      {type !== 'start' && <Handle type="target" position={Position.Top} />}
      <div className={cn('flex items-center gap-1.5', round && 'justify-center')}>
        <Icon size={14} className="text-muted-foreground" aria-hidden />
        <span className="truncate font-medium">{data.node.name}</span>
      </div>
      {(data.node.type === 'approval' || data.node.type === 'form') && (
        <AssigneeLine
          assignee={data.node.assignee}
          missing={data.node.type === 'form' ? '未指派填表人' : '未指派審批人'}
        />
      )}
      {data.node.type === 'approval' && data.node.autoApprove && (
        <div className="mt-1.5 flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-[0.8em] text-accent-foreground">
          <Zap size={12} aria-hidden className="shrink-0" />
          <span className="truncate">條件成立時自動核准</span>
        </div>
      )}
      {(data.node.type === 'approval' || data.node.type === 'form') && (
        <TimeoutLine reminder={data.node.reminder} escalation={data.node.escalation} />
      )}
      {type === 'condition' && (
        <div className="mt-1 text-[0.85em] text-muted-foreground">依 Form 資料走不同的出邊</div>
      )}
      {type === 'parallelSplit' && (
        <div className="mt-1 text-[0.85em] text-muted-foreground">每條出邊同時進行</div>
      )}
      {type === 'parallelJoin' && (
        <div className="mt-1 text-[0.85em] text-muted-foreground">等所有分支完成才繼續</div>
      )}
      {data.node.type === 'email' && <RecipientLine recipient={data.node.recipient} />}
      {data.node.type === 'http' && (
        <HttpLine method={data.node.method} url={data.node.url} credential={data.node.credential} />
      )}
      {(data.node.type === 'start' || data.node.type === 'form') && (
        <FormLine formId={data.node.formId} required={data.node.type === 'form'} />
      )}
      {hasError && (
        <span className="-top-2 -right-2 absolute grid size-5 place-items-center rounded-full bg-destructive font-mono text-[11px] text-white">
          {data.errors.length}
        </span>
      )}
      {type !== 'end' && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}

/** 開始與填表節點用的 Form；開始節點沒有時不顯示。 */
function FormLine({ formId, required }: { formId?: string | null; required: boolean }) {
  const forms = useContext(CanvasFormsContext);
  const form = forms.find((f) => f.id === formId);
  if (!form && !required) return null;
  return (
    <div
      className={cn(
        'mt-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.8em]',
        form ? 'bg-accent text-accent-foreground' : 'bg-destructive/10 text-destructive',
      )}
    >
      <FileText size={12} aria-hidden className="shrink-0" />
      <span className="truncate">
        {form ? `${form.name || '（未命名的 Form）'} · ${form.fields.length} 欄` : '未指定 Form'}
      </span>
    </div>
  );
}

function AssigneeLine({ assignee, missing }: { assignee: Assignee | null; missing: string }) {
  if (!assignee) return <div className="mt-1 text-[0.85em] text-destructive">{missing}</div>;
  switch (assignee.type) {
    case 'role':
      return <RoleLine roleId={assignee.roleId} />;
    case 'participant':
      return <PersonLine participantId={assignee.participantId} />;
    case 'manager':
      return <ManagerLine fallbackRoleId={assignee.fallbackRoleId} />;
  }
}

/** Email 節點的收件對象。 */
/** 人工節點的逾時設定摘要，例如「24 小時提醒・72 小時 Escalation」。 */
function TimeoutLine({
  reminder,
  escalation,
}: {
  reminder?: Reminder | null;
  escalation?: Escalation | null;
}) {
  const parts = [
    reminder && `${reminder.afterHours} 小時${reminder.repeat ? '起每隔同樣時間' : ''}提醒`,
    escalation && `${escalation.afterHours} 小時 Escalation`,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <div className="mt-1 flex items-center gap-1 text-[0.8em] text-muted-foreground">
      <AlarmClock size={12} aria-hidden className="shrink-0" />
      <span className="truncate">{parts.join('・')}</span>
    </div>
  );
}

function RecipientLine({ recipient }: { recipient: EmailRecipient | null }) {
  if (!recipient) return <div className="mt-1 text-[0.85em] text-destructive">未設定收件對象</div>;
  switch (recipient.type) {
    case 'role':
      return <RoleLine roleId={recipient.roleId} />;
    case 'participant':
      return <PersonLine participantId={recipient.participantId} />;
    case 'initiator':
    case 'manager':
      return (
        <div className="mt-1 flex items-center gap-1.5 text-[0.85em] text-muted-foreground">
          <UserRoundCheck size={14} aria-hidden className="shrink-0" />
          <span className="truncate">
            {recipient.type === 'initiator' ? '寄給發起人' : '寄給發起人的 Manager'}
          </span>
        </div>
      );
  }
}

/** HTTP 節點的 method、URL 與引用的 Credential 名稱（秘密不會出現在 DSL 裡）。 */
function HttpLine({
  method,
  url,
  credential,
}: {
  method: string;
  url: string;
  credential: string | null;
}) {
  return (
    <div className="mt-1 grid gap-0.5 text-[0.85em] text-muted-foreground">
      {url.trim() ? (
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 font-mono text-[0.9em]">{method}</span>
          <span className="min-w-0 break-all font-mono text-[0.9em]">{url}</span>
        </div>
      ) : (
        <div className="text-destructive">未填寫 URL</div>
      )}
      {credential && (
        <div className="flex items-center gap-1.5">
          <KeyRound size={13} aria-hidden className="shrink-0" />
          <span className="truncate">{credential}</span>
        </div>
      )}
    </div>
  );
}

/** 發起人的 Manager，以及找不到有效 Manager 時接手的 Fallback Role。 */
function ManagerLine({ fallbackRoleId }: { fallbackRoleId: string | null }) {
  const { data: roles } = useQuery(roleDirectoryQueryOptions);
  const role = roles?.find((r) => r.id === fallbackRoleId);
  return (
    <div className="mt-1 grid gap-0.5 text-[0.85em] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <UserRoundCheck size={14} aria-hidden className="shrink-0" />
        <span className="truncate">發起人的 Manager</span>
      </div>
      {fallbackRoleId ? (
        <span className="truncate pl-5 text-[0.9em]">後備：{role ? role.name : '…'}</span>
      ) : (
        <span className="pl-5 text-[0.9em] text-destructive">未設定 Fallback Role</span>
      )}
    </div>
  );
}

function RoleLine({ roleId }: { roleId: string }) {
  const { data: roles } = useQuery(roleDirectoryQueryOptions);
  const role = roles?.find((r) => r.id === roleId);
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[0.85em] text-muted-foreground">
      <Users size={14} aria-hidden className="shrink-0" />
      <span className="truncate">{role ? `${role.name}（Role）` : '…'}</span>
      {role?.memberCount === 0 && <span className="text-destructive">（沒有成員）</span>}
    </div>
  );
}

function PersonLine({ participantId }: { participantId: string }) {
  const { data: people } = useQuery(directoryQueryOptions);
  const person = people?.find((p) => p.id === participantId);
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[0.85em] text-muted-foreground">
      {person ? (
        <>
          <Avatar id={person.id} name={person.name} size={18} />
          <span className="truncate">{person.name}</span>
          {person.status === 'deactivated' && <span className="text-destructive">（已停用）</span>}
        </>
      ) : (
        '…'
      )}
    </div>
  );
}

export const nodeTypes: Record<NodeType, typeof NodeCard> = {
  start: NodeCard,
  form: NodeCard,
  approval: NodeCard,
  condition: NodeCard,
  parallelSplit: NodeCard,
  parallelJoin: NodeCard,
  email: NodeCard,
  http: NodeCard,
  end: NodeCard,
};
