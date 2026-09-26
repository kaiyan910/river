import type { NodeType } from './schema.js';

/** 算路徑只需要節點的類型與連線；API 回傳給畫面的流程圖和 DSL 都符合。 */
export interface PathGraph {
  nodes: readonly { id: string; type: NodeType }[];
  edges: readonly { id: string; source: string; target: string }[];
}

/** 路徑上的一步；via 是走進這一步的連線，開始節點與「條件還沒判斷、直接跳到匯合點」時為 null。 */
export interface PathStep {
  nodeId: string;
  via: string | null;
}

export interface RequestPath {
  /** 從「開始」走到「結束」的路徑；條件還沒判斷時，跳過它的各條分支，接到分支的匯合點。 */
  steps: PathStep[];
  /** 依已經做出的判斷，仍然可能走到的節點；其餘的節點在這一輪已經被略過。 */
  reachable: Set<string>;
}

/**
 * Request 這一輪實際走的路徑。chosen 是條件節點 ID 對應選中的出邊 ID（這一輪的 step.branch_chosen）。
 * 每個條件節點依 chosen 走；還沒判斷的條件節點無法知道走哪一條，就接到各條分支都會經過的第一個節點。
 * 其他節點沿著第一條出邊走。遇到迴圈時停下。
 */
export function requestPath(graph: PathGraph, chosen: ReadonlyMap<string, string>): RequestPath {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const outgoing = (id: string) => graph.edges.filter((e) => e.source === id && byId.has(e.target));
  const start = graph.nodes.find((n) => n.type === 'start');

  const steps: PathStep[] = [];
  const visited = new Set<string>();
  let node = start;
  let via: string | null = null;
  while (node && !visited.has(node.id)) {
    const { id, type } = node;
    visited.add(id);
    steps.push({ nodeId: id, via });
    if (type === 'end') break;
    const out = outgoing(id);
    const edge = type === 'condition' ? out.find((e) => e.id === chosen.get(id)) : out[0];
    if (type === 'condition' && !edge) {
      const merge = mergePoint(
        out.map((e) => e.target),
        (id) => outgoing(id).map((e) => e.target),
      );
      node = merge === undefined ? undefined : byId.get(merge);
      via = null;
      continue;
    }
    node = edge && byId.get(edge.target);
    via = edge?.id ?? null;
  }

  const reachable = new Set<string>();
  const queue = start ? [start.id] : [];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (reachable.has(id)) continue;
    reachable.add(id);
    const out = outgoing(id);
    const decided = byId.get(id)?.type === 'condition' && out.find((e) => e.id === chosen.get(id));
    for (const e of decided ? [decided] : out) queue.push(e.target);
  }
  return { steps, reachable };
}

/** 各條分支都會經過的第一個節點（依第一條分支往下走的先後）；分支不會匯合時為 undefined。 */
function mergePoint(
  targets: readonly string[],
  successors: (id: string) => string[],
): string | undefined {
  const reach = (from: string) => {
    const order = [from];
    for (let i = 0; i < order.length; i++)
      for (const next of successors(order[i] as string))
        if (!order.includes(next)) order.push(next);
    return order;
  };
  const [first, ...others] = targets.map(reach);
  return first?.find((id) => others.every((o) => o.includes(id)));
}
