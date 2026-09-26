import type { GraphShape } from './schema.js';

export type PathGraph = GraphShape;
type PathNode = GraphShape['nodes'][number];

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
 * 並行分支的每一條分支依出邊順序一條接一條列出，再接到匯合點。其他節點沿著第一條出邊走。遇到迴圈時停下。
 */
export function requestPath(graph: PathGraph, chosen: ReadonlyMap<string, string>): RequestPath {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const outgoing = (id: string) => graph.edges.filter((e) => e.source === id && byId.has(e.target));
  const start = graph.nodes.find((n) => n.type === 'start');

  const steps: PathStep[] = [];
  const visited = new Set<string>();
  /** 從 node 往下走；遇到 parallelJoin 時不列出它，回傳它與走進它的連線，由對應的並行分支接手。 */
  const walk = (first: PathNode | undefined, firstVia: string | null): PathStep | undefined => {
    let node = first;
    let via = firstVia;
    while (node && !visited.has(node.id)) {
      const { id, type } = node;
      if (type === 'parallelJoin') return { nodeId: id, via };
      visited.add(id);
      steps.push({ nodeId: id, via });
      if (type === 'end') break;
      const out = outgoing(id);
      if (type === 'parallelSplit') {
        // 每一條分支依出邊順序列出，最後接到匯合點；走進匯合點的連線取最後一條分支的。
        let joined: PathStep | undefined;
        for (const e of out) joined = walk(byId.get(e.target), e.id) ?? joined;
        const join = joined && byId.get(joined.nodeId);
        if (!joined || !join || visited.has(join.id)) break;
        visited.add(join.id);
        steps.push(joined);
        const after = outgoing(join.id)[0];
        node = after && byId.get(after.target);
        via = after?.id ?? null;
        continue;
      }
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
    return undefined;
  };
  walk(start, null);

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
