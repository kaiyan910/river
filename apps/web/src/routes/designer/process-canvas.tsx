import {
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
import { CirclePlay, CircleStop, UserCheck } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Avatar } from '@/components/people';
import { directoryQueryOptions } from '@/lib/org';
import { cn } from '@/lib/utils';

export type RFNode = Node<CanvasNodeData, NodeType>;

export const NODE_ICONS = { start: CirclePlay, approval: UserCheck, end: CircleStop } as const;

/** 節點的寬度與大約高度；置中節點、在畫面中央新增節點時用來算中心點。 */
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 60;

function newNodeId(type: NodeType): string {
  return `${type}-${crypto.randomUUID().slice(0, 8)}`;
}

function newNode(type: NodeType, position: { x: number; y: number }): ProcessNode {
  const base = { id: newNodeId(type), name: NODE_TYPE_LABELS[type], position };
  return type === 'approval'
    ? { ...base, type, name: '新的審批', assignee: null }
    : { ...base, type };
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
 * 畫布狀態：React Flow 的節點與邊，以及由它們轉出的 DSL 與即時檢查結果。
 * 轉換與檢查都用 @river/dsl，與 API 拒絕發佈時的結果一致。
 */
export function useProcessCanvas(initial: ProcessDsl) {
  const [nodes, setNodes] = useState<RFNode[]>(() => toCanvas(initial).nodes);
  const [edges, setEdges] = useState<Edge[]>(() => toCanvas(initial).edges);

  const dsl = useMemo(() => fromCanvas({ nodes, edges }), [nodes, edges]);
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
    const [node] = toCanvas({ nodes: [newNode(type, position)], edges: [] }).nodes;
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
  };
}

function NodeCard({ data, selected, type }: NodeProps<RFNode>) {
  const Icon = NODE_ICONS[type];
  const hasError = data.errors.length > 0;
  return (
    <div
      style={{ width: NODE_WIDTH }}
      className={cn(
        'relative rounded-lg border bg-card px-3 py-2 shadow-sm',
        type !== 'approval' && 'rounded-full text-center',
        selected && 'border-primary ring-2 ring-primary/30',
        hasError && 'border-destructive ring-2 ring-destructive/25',
      )}
      title={data.errors.map((e) => e.message).join('\n') || undefined}
    >
      {type !== 'start' && <Handle type="target" position={Position.Top} />}
      <div className={cn('flex items-center gap-1.5', type !== 'approval' && 'justify-center')}>
        <Icon size={14} className="text-muted-foreground" aria-hidden />
        <span className="truncate font-medium">{data.node.name}</span>
      </div>
      {data.node.type === 'approval' && (
        <AssigneeLine participantId={data.node.assignee?.participantId} />
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

function AssigneeLine({ participantId }: { participantId: string | undefined }) {
  const { data: people } = useQuery(directoryQueryOptions);
  if (!participantId)
    return <div className="mt-1 text-[0.85em] text-destructive">未指派審批人</div>;
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

export const nodeTypes = { start: NodeCard, approval: NodeCard, end: NodeCard };
