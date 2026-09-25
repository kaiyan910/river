import type { FormSchema } from '@river/forms';
import type { DslError } from './check.js';
import type { NodeType, ProcessDsl, ProcessEdge, ProcessNode } from './schema.js';

type WithoutPosition<T> = T extends unknown ? Omit<T, 'position'> : never;

/** 節點本身的設定（名稱、指派對象…），不含位置。 */
export type NodeSettings = WithoutPosition<ProcessNode>;

export interface CanvasNodeData extends Record<string, unknown> {
  node: NodeSettings;
  /** 檢查器對這個節點回報的錯誤，畫布用來標示紅框。 */
  errors: DslError[];
}

/** 與 React Flow 的 Node 相容的形狀；這個 package 不依賴 React Flow。 */
export interface CanvasNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: CanvasNodeData;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
}

export interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export function toCanvas(dsl: ProcessDsl, errors: DslError[] = []): Canvas {
  return {
    nodes: dsl.nodes.map(({ position, ...node }) => ({
      id: node.id,
      type: node.type,
      position,
      data: { node, errors: errors.filter((e) => e.nodeId === node.id) },
    })),
    edges: dsl.edges.map(({ id, source, target }) => ({ id, source, target })),
  };
}

/**
 * 從畫布狀態取出 DSL；React Flow 自己加在節點與邊上的欄位（selected、measured…）會被捨棄。
 * 畫布只有節點與連線，Form 由表單設計器另外維護，一起組成 DSL。
 */
export function fromCanvas(
  canvas: {
    nodes: readonly Pick<CanvasNode, 'id' | 'position' | 'data'>[];
    edges: readonly CanvasEdge[];
  },
  forms: FormSchema[] = [],
): ProcessDsl {
  return {
    nodes: canvas.nodes.map(
      (n) =>
        ({
          ...n.data.node,
          id: n.id,
          position: { x: n.position.x, y: n.position.y },
        }) as ProcessNode,
    ),
    edges: canvas.edges.map(({ id, source, target }): ProcessEdge => ({ id, source, target })),
    forms,
  };
}
