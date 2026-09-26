import type { GraphShape } from './schema.js';

export interface ParallelPairing {
  /** 每一條分支都回到的 parallelJoin；有分支走到「結束」、別的 join 或繞回 split 時為 null。 */
  join: string | null;
  /** join 為 null 是因為分支裡的內層 split 本身配對不起來（錯誤已經算在內層）。 */
  innerUnmatched: boolean;
  /**
   * 每一條分支（依出邊順序）經過的節點，不含這個 split 與它的 join；
   * 分支裡的內層並行分支（含內層的 join）整段算在這條分支裡。
   */
  branches: { edgeId: string; nodes: Set<string> }[];
  /** 各條分支停下來的節點：parallelJoin 或「結束」。配對成功時只有 join。 */
  terminals: Set<string>;
}

/**
 * 每個 parallelSplit 各自配對的 parallelJoin。沿著每一條分支往下走（條件節點的每一條出邊都算），
 * 遇到內層的 split 就整段跳到它的 join 之後，第一個遇到的 join 就是這條分支的終點。
 * 每一條分支都停在同一個 join 時才算配對成功。純函式，不依賴 JSONata，workflow 與畫面都可以用。
 */
export function parallelPairings(graph: GraphShape): Map<string, ParallelPairing> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const outgoing = (id: string) => graph.edges.filter((e) => e.source === id && byId.has(e.target));
  const pairings = new Map<string, ParallelPairing>();

  const pair = (splitId: string, enclosing: readonly string[]): ParallelPairing => {
    const known = pairings.get(splitId);
    if (known) return known;
    const stack = [...enclosing, splitId];
    const terminals = new Set<string>();
    let broken = false;
    let innerUnmatched = false;

    const branches = outgoing(splitId).map((first) => {
      const nodes = new Set<string>();
      const queue = [first.target];
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const type = byId.get(id)?.type;
        if (type === 'parallelJoin' || type === 'end') {
          terminals.add(id);
          continue;
        }
        if (nodes.has(id)) continue;
        // 繞回這個 split 或外層的 split：分支永遠回不到 join。
        if (stack.includes(id)) {
          broken = true;
          continue;
        }
        nodes.add(id);
        let from = id;
        if (type === 'parallelSplit') {
          const inner = pair(id, stack);
          if (!inner.join) {
            broken = innerUnmatched = true;
            continue;
          }
          for (const b of inner.branches) for (const n of b.nodes) nodes.add(n);
          if (nodes.has(inner.join)) continue;
          nodes.add(inner.join);
          from = inner.join;
        }
        for (const e of outgoing(from)) queue.push(e.target);
      }
      return { edgeId: first.id, nodes };
    });

    const [only, ...others] = terminals;
    const join =
      !broken &&
      only !== undefined &&
      others.length === 0 &&
      byId.get(only)?.type === 'parallelJoin'
        ? only
        : null;
    const pairing = { join, innerUnmatched: !join && innerUnmatched, branches, terminals };
    pairings.set(splitId, pairing);
    return pairing;
  };

  for (const node of graph.nodes) if (node.type === 'parallelSplit') pair(node.id, []);
  return pairings;
}
