import {
  type Assignee,
  type CanvasNodeData,
  checkProcess,
  fromCanvas,
  NODE_TYPE_LABELS,
  type NodeSettings,
  type NodeType,
  type ProcessDsl,
  type ProcessNode,
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
import { CirclePlay, CircleStop, ClipboardPen, FileText, UserCheck, Users } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Avatar } from '@/components/people';
import { directoryQueryOptions, roleDirectoryQueryOptions } from '@/lib/org';
import { cn } from '@/lib/utils';

export type RFNode = Node<CanvasNodeData, NodeType>;

export const NODE_ICONS = {
  start: CirclePlay,
  form: ClipboardPen,
  approval: UserCheck,
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
  const [edges, setEdges] = useState<Edge[]>(() => toCanvas(initial).edges);
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

  const onNodesChange = useCallback(
    (changes: NodeChange<RFNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  );
  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((es) =>
        c.source === c.target
          ? es
          : addEdge({ ...c, id: `edge-${crypto.randomUUID().slice(0, 8)}` }, es),
      ),
    [],
  );

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
    edges,
    dsl,
    errors,
    selected: nodesWithErrors.find((n) => n.selected) ?? null,
    onNodesChange,
    onEdgesChange,
    onConnect,
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
  return assignee.type === 'role' ? (
    <RoleLine roleId={assignee.roleId} />
  ) : (
    <PersonLine participantId={assignee.participantId} />
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

export const nodeTypes = { start: NodeCard, form: NodeCard, approval: NodeCard, end: NodeCard };
