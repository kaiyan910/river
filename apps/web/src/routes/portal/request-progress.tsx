import '@xyflow/react/dist/style.css';
import type { ProcessFlow, RequestDetail } from '@river/contracts';
import { isSystemNode, requestPath } from '@river/dsl';
import {
  Background,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react';
import {
  Check,
  ChevronDown,
  Circle,
  CirclePlay,
  CircleStop,
  ClipboardPen,
  GitFork,
  GitMerge,
  Loader2,
  Split,
  Undo2,
  UserCheck,
} from 'lucide-react';
import { useState } from 'react';
import { branchLabel } from '@/lib/processes';
import { assigneeLabel, isAdvancing } from '@/lib/requests';
import { cn } from '@/lib/utils';

type FlowNode = ProcessFlow['nodes'][number];

/** skipped：條件選了別的分支，這一輪不會走到。 */
type StepState = 'done' | 'current' | 'advancing' | 'returned' | 'todo' | 'skipped';

interface PathItem {
  node: FlowNode;
  /** 走進這一步的連線；條件還沒判斷、直接接到匯合點時為 null。 */
  via: string | null;
  state: StepState;
}

interface RequestProgress {
  path: PathItem[];
  /** 流程圖上每個節點在這一輪的狀態。 */
  states: Map<string, StepState>;
  /** 條件節點 ID 對應這一輪選中的出邊 ID。 */
  chosen: Map<string, string>;
  /** 這一輪已經走過的連線。 */
  walked: Set<string>;
  captions: Map<string, string>;
}

/**
 * 這一輪實際走的路徑，以及流程圖上每個節點的狀態。
 * 每一步的狀態：已完成、目前（有 open Task）、處理中（workflow 正在走到這一步）、還沒到；
 * 被 Return 的那一步標成 returned；重新送出後先前的核准都失效，所以只看這一輪的 Task 與事件。
 * 自動核准的步驟沒有 Task，看這一輪的 step.auto_approved；條件節點看這一輪的 step.branch_chosen。
 * 並行分支與匯合節點沒有 Task 也沒有事件：走進它們的每一步都完成（或被略過）時就算完成。
 */
function progressOf(request: RequestDetail): RequestProgress {
  const tasks = request.tasks.filter((t) => t.round === request.round);
  const roundStart = request.events.findLastIndex((e) => e.type === 'request.resubmitted');
  const roundEvents = request.events.slice(roundStart + 1);
  const autoApproved = new Set(
    roundEvents.flatMap((e) => (e.type === 'step.auto_approved' && e.node ? [e.node.id] : [])),
  );
  const chosen = new Map(
    roundEvents.flatMap((e) =>
      e.type === 'step.branch_chosen' && e.node && e.edge ? [[e.node.id, e.edge.id] as const] : [],
    ),
  );
  inferChosenBranches(
    request.flow,
    chosen,
    (id) => autoApproved.has(id) || tasks.some((t) => t.nodeId === id),
  );
  const { steps, reachable } = requestPath(request.flow, chosen);
  const byId = new Map(request.flow.nodes.map((n) => [n.id, n]));

  const memo = new Map<string, StepState>();
  const stateOf = (node: FlowNode): StepState => {
    const known = memo.get(node.id);
    if (known) return known;
    // 先記成 todo，迴圈繞回來時不會無限遞迴。
    memo.set(node.id, 'todo');
    const state = computeState(node);
    memo.set(node.id, state);
    return state;
  };
  const computeState = (node: FlowNode): StepState => {
    if (!reachable.has(node.id)) return 'skipped';
    switch (node.type) {
      case 'start':
        return 'done';
      case 'end':
        return request.status === 'completed' ? 'done' : 'todo';
      case 'condition':
        return chosen.has(node.id) ? 'done' : 'todo';
      case 'parallelSplit':
      case 'parallelJoin': {
        const before = request.flow.edges
          .filter((e) => e.target === node.id)
          .flatMap((e) => byId.get(e.source) ?? [])
          .map(stateOf);
        return before.includes('done') && before.every((s) => s === 'done' || s === 'skipped')
          ? 'done'
          : 'todo';
      }
      default: {
        if (autoApproved.has(node.id)) return 'done';
        const task = tasks.findLast((t) => t.nodeId === node.id);
        if (task?.status === 'open') return 'current';
        if (task?.outcome === 'returned') return 'returned';
        return task?.status === 'completed' ? 'done' : 'todo';
      }
    }
  };

  const states = new Map<string, StepState>();
  const walked = new Set<string>();
  let previousDone = true;
  const path = steps.flatMap(({ nodeId, via }): PathItem[] => {
    const node = byId.get(nodeId);
    if (!node) return [];
    // 並行分支上，路徑的前一步是另一條分支的最後一步，所以看走進這一步的連線的起點。
    const source = byId.get(request.flow.edges.find((e) => e.id === via)?.source ?? '');
    const cameFromDone = source ? stateOf(source) === 'done' : previousDone;
    let state = stateOf(node);
    // 並行分支與匯合節點一瞬間就走過，不會停在「處理中」。
    const instant = node.type === 'parallelSplit' || node.type === 'parallelJoin';
    if (state === 'todo' && !instant && cameFromDone && isAdvancing(request)) state = 'advancing';
    if (via && cameFromDone) walked.add(via);
    previousDone = state === 'done';
    states.set(nodeId, state);
    return [{ node, via, state }];
  });
  for (const node of request.flow.nodes)
    if (!states.has(node.id)) states.set(node.id, stateOf(node));

  const captions = new Map(
    request.flow.nodes.map((node) => {
      const state = states.get(node.id);
      const step = request.steps.find((s) => s.nodeId === node.id);
      const edge = request.flow.edges.find((e) => e.id === chosen.get(node.id));
      let caption = '';
      if (state === 'skipped') caption = '略過';
      else if (node.type === 'start') caption = request.initiator.name;
      else if (node.type === 'end') caption = state === 'done' ? '已完成' : '';
      else if (node.type === 'condition')
        caption = !edge?.branch
          ? '依條件而定'
          : edge.branch.type === 'default'
            ? '走預設分支'
            : `符合 ${branchLabel(edge.branch)}`;
      else if (node.type === 'parallelSplit') caption = '各分支同時進行';
      else if (node.type === 'parallelJoin')
        caption = state === 'done' ? '所有分支已完成' : '等所有分支完成';
      else if (autoApproved.has(node.id)) caption = '自動核准';
      else if (step?.assignee) caption = assigneeLabel(step.assignee);
      return [node.id, caption] as const;
    }),
  );
  return { path, states, chosen, walked, captions };
}

/**
 * 舊的 Request 沒有 step.branch_chosen 事件：條件節點的出邊直接連到的節點這一輪有動靜
 * （有 Task 或自動核准），就是當時走的分支。
 */
function inferChosenBranches(
  flow: ProcessFlow,
  chosen: Map<string, string>,
  active: (nodeId: string) => boolean,
): void {
  for (const node of flow.nodes) {
    if (node.type !== 'condition' || chosen.has(node.id)) continue;
    const edge = flow.edges.find((e) => e.source === node.id && active(e.target));
    if (edge) chosen.set(node.id, edge.id);
  }
}

const STEP_TONE: Record<StepState, string> = {
  done: 'border-status-approved bg-status-approved text-white',
  current: 'border-status-open bg-status-open text-white',
  advancing: 'border-status-open bg-card text-status-open',
  returned: 'border-status-returned bg-status-returned text-white',
  todo: 'border-border bg-card text-muted-foreground',
  skipped: 'border-dashed border-border bg-card text-muted-foreground',
};

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <Check size={13} strokeWidth={2.5} />;
  if (state === 'advancing') return <Loader2 size={13} className="animate-spin" />;
  if (state === 'returned') return <Undo2 size={13} strokeWidth={2.5} />;
  return <Circle size={8} fill={state === 'current' ? 'currentColor' : 'none'} />;
}

/** 進度條上的一步；條件節點畫成菱形。 */
function StepMarker({ item }: { item: PathItem }) {
  if (item.node.type === 'condition')
    return (
      <span aria-hidden className="grid size-7 place-items-center">
        <span
          className={cn(
            'grid size-5 rotate-45 place-items-center rounded-[4px] border-2',
            STEP_TONE[item.state],
          )}
        >
          <span className="-rotate-45">
            {item.state === 'done' ? (
              <Check size={11} strokeWidth={3} />
            ) : (
              <StepIcon state={item.state} />
            )}
          </span>
        </span>
      </span>
    );
  return (
    <span
      aria-hidden
      className={cn('grid size-7 place-items-center rounded-full border-2', STEP_TONE[item.state])}
    >
      <StepIcon state={item.state} />
    </span>
  );
}

/**
 * 進度：只列出這一輪實際走過、或接下來會走的步驟，條件節點標出判斷的結果。
 * 條件還沒判斷時，後面接到分支的匯合點並以虛線相連。有沒走到的節點時，可以展開完整的流程圖。
 */
export function Progress({ request }: { request: RequestDetail }) {
  const progress = progressOf(request);
  const [showFlow, setShowFlow] = useState(false);
  const { path } = progress;
  return (
    <div className="grid gap-3">
      <ol className="flex items-start">
        {path.map((item, i) => {
          const next = path[i + 1];
          return (
            <li key={item.node.id} className="flex flex-1 items-start last:flex-none">
              <div className="grid justify-items-center gap-1 text-center">
                <StepMarker item={item} />
                <span className="font-medium text-[0.88em]">{item.node.name}</span>
                <span className="text-[0.8em] text-muted-foreground">
                  {progress.captions.get(item.node.id)}
                </span>
              </div>
              {next &&
                (next.via === null ? (
                  <div
                    title="依條件而定"
                    className="mx-2 mt-3.5 flex-1 border-border border-t-2 border-dashed"
                  />
                ) : (
                  <div
                    className={cn(
                      'mx-2 mt-3.5 h-0.5 flex-1 rounded',
                      progress.walked.has(next.via) ? 'bg-status-approved' : 'bg-border',
                    )}
                  />
                ))}
            </li>
          );
        })}
      </ol>
      {path.length < request.flow.nodes.length && (
        <button
          type="button"
          aria-expanded={showFlow}
          onClick={() => setShowFlow((v) => !v)}
          className="inline-flex cursor-pointer items-center gap-1 justify-self-start text-[0.86em] text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            size={14}
            aria-hidden
            className={cn('transition-transform', showFlow && 'rotate-180')}
          />
          {showFlow ? '收起流程圖' : '查看完整流程圖'}
        </button>
      )}
      {showFlow && <FlowGraph flow={request.flow} progress={progress} />}
    </div>
  );
}

const FLOW_ICONS = {
  start: CirclePlay,
  form: ClipboardPen,
  approval: UserCheck,
  condition: Split,
  parallelSplit: GitFork,
  parallelJoin: GitMerge,
  end: CircleStop,
} as const;

/** 和 Designer 畫布的節點同寬，節點位置才不會重疊。 */
const FLOW_NODE_WIDTH = 200;

const FLOW_TONE: Record<StepState, string> = {
  done: 'border-status-approved',
  current: 'border-status-open ring-2 ring-status-open/25',
  advancing: 'border-status-open',
  returned: 'border-status-returned ring-2 ring-status-returned/25',
  todo: '',
  skipped: 'border-dashed opacity-50',
};

type FlowStepNode = Node<{ node: FlowNode; state: StepState; caption: string }, 'step'>;

function FlowStep({ data: { node, state, caption } }: NodeProps<FlowStepNode>) {
  const Icon = FLOW_ICONS[node.type];
  const round = node.type === 'start' || node.type === 'end';
  return (
    <div
      style={{ width: FLOW_NODE_WIDTH }}
      className={cn(
        'relative rounded-lg border bg-card px-3 py-2 shadow-sm',
        round && 'rounded-full text-center',
        isSystemNode(node) && 'border-dashed',
        FLOW_TONE[state],
      )}
    >
      {node.type !== 'start' && (
        <Handle type="target" position={Position.Top} isConnectable={false} className="opacity-0" />
      )}
      <div className={cn('flex items-center gap-1.5', round && 'justify-center')}>
        <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-medium">{node.name}</span>
      </div>
      {caption && !round && (
        <div className="mt-1 truncate text-[0.85em] text-muted-foreground">{caption}</div>
      )}
      {state !== 'todo' && state !== 'skipped' && (
        <span
          aria-hidden
          className={cn(
            '-top-2 -right-2 absolute grid size-5 place-items-center rounded-full border-2',
            STEP_TONE[state],
          )}
        >
          <StepIcon state={state} />
        </span>
      )}
      {node.type !== 'end' && (
        <Handle
          type="source"
          position={Position.Bottom}
          isConnectable={false}
          className="opacity-0"
        />
      )}
    </div>
  );
}

const flowNodeTypes = { step: FlowStep };

/**
 * 唯讀的完整流程圖，沿用 Designer 畫布上的位置：走過的連線畫成綠色，
 * 條件選了別的分支而不會走到的節點與連線淡化並標成「略過」。
 */
function FlowGraph({ flow, progress }: { flow: ProcessFlow; progress: RequestProgress }) {
  const nodes: FlowStepNode[] = flow.nodes.map((node) => ({
    id: node.id,
    type: 'step',
    position: node.position,
    data: {
      node,
      state: progress.states.get(node.id) ?? 'todo',
      caption: progress.captions.get(node.id) ?? '',
    },
  }));
  const edges: Edge[] = flow.edges.map((e) => {
    const notChosen = progress.chosen.has(e.source) && progress.chosen.get(e.source) !== e.id;
    const skipped =
      notChosen ||
      progress.states.get(e.source) === 'skipped' ||
      progress.states.get(e.target) === 'skipped';
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.branch ? branchLabel(e.branch) : undefined,
      style: progress.walked.has(e.id)
        ? { stroke: 'var(--status-approved)', strokeWidth: 2 }
        : skipped
          ? { strokeDasharray: '4 4', opacity: 0.5 }
          : { strokeWidth: 1.5 },
      labelStyle: skipped ? { opacity: 0.5 } : undefined,
    };
  });
  return (
    <div className="h-[380px] overflow-hidden rounded-lg border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={flowNodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
      >
        <Background gap={16} />
        <Controls position="bottom-left" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
