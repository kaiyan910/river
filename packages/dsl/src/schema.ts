import { formSchema } from '@river/forms';
import { z } from 'zod';

/**
 * Process DSL：以節點與邊組成的有向圖，以 JSON 儲存。
 * 目前有 start、form、approval、end；其他節點類型（condition、parallelSplit…）由後續 ticket 加入。
 * Form 屬於 Process，跟流程圖放在同一份 DSL，發佈時一起存成 Process Version 的快照。
 */

const nodeIdSchema = z.string().min(1);

/** 節點在畫布上的位置；只影響畫面，不影響執行。 */
const positionSchema = z.object({ x: z.number(), y: z.number() });

const nodeBase = {
  id: nodeIdSchema,
  /** 草稿中可以暫時空白，發佈前由檢查器擋下。 */
  name: z.string().max(100),
  position: positionSchema,
};

/** 人工步驟的指派對象。之後會加上 Role 與發起人的 Manager。 */
export const assigneeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('participant'), participantId: z.string().min(1) }),
]);
export type Assignee = z.infer<typeof assigneeSchema>;

/** 節點使用的 Form（同一份 DSL 裡 forms 的 id）；草稿中可以還沒指定。 */
const formRefSchema = z.string().min(1).nullish();

/** 開始節點可以指定開始表單；沒有時發起人只填標題。 */
export const startNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('start'),
  formId: formRefSchema,
});
export const endNodeSchema = z.object({ ...nodeBase, type: z.literal('end') });
/** 審批節點；草稿中可以還沒指派（null），發佈前由檢查器擋下。 */
export const approvalNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('approval'),
  assignee: assigneeSchema.nullable(),
});

/** 填表節點：指派一位 Participant 填一份 Form；發佈前兩者都必須設定。 */
export const formNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('form'),
  formId: formRefSchema,
  assignee: assigneeSchema.nullable(),
});

export const processNodeSchema = z.discriminatedUnion('type', [
  startNodeSchema,
  formNodeSchema,
  approvalNodeSchema,
  endNodeSchema,
]);
export type ProcessNode = z.infer<typeof processNodeSchema>;
export type NodeType = ProcessNode['type'];

/** 邊的兩端在 schema 層不檢查是否存在，懸空的邊交給檢查器回報，草稿才能先儲存。 */
export const processEdgeSchema = z.object({
  id: z.string().min(1),
  source: nodeIdSchema,
  target: nodeIdSchema,
});
export type ProcessEdge = z.infer<typeof processEdgeSchema>;

export const processDslSchema = z.object({
  nodes: z.array(processNodeSchema),
  edges: z.array(processEdgeSchema),
  forms: z.array(formSchema).max(50).default([]),
});
export type ProcessDsl = z.infer<typeof processDslSchema>;

/** 開始與填表節點使用的 Form id；其他節點或還沒指定時為 null。 */
export function formIdOf(node: { type: NodeType; formId?: string | null }): string | null {
  return (node.type === 'start' || node.type === 'form') && node.formId ? node.formId : null;
}

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  start: '開始',
  form: '填表',
  approval: '審批',
  end: '結束',
};

/** 新 Process 的草稿：只有「開始」和「結束」，還沒連線。 */
export function initialProcessDsl(): ProcessDsl {
  return {
    nodes: [
      { id: 'start', type: 'start', name: NODE_TYPE_LABELS.start, position: { x: 0, y: 0 } },
      { id: 'end', type: 'end', name: NODE_TYPE_LABELS.end, position: { x: 0, y: 340 } },
    ],
    edges: [],
    forms: [],
  };
}

/**
 * 從「開始」沿著連線走到「結束」的節點順序；每個節點取第一條出邊。
 * 目前的節點類型只能組成一直線，之後有條件與並行分支時要改寫。
 */
export function mainPath(dsl: ProcessDsl): ProcessNode[] {
  const byId = new Map(dsl.nodes.map((n) => [n.id, n]));
  const path: ProcessNode[] = [];
  let node: ProcessNode | undefined = dsl.nodes.find((n) => n.type === 'start');
  while (node && !path.includes(node)) {
    path.push(node);
    const id: string = node.id;
    const edge = dsl.edges.find((e) => e.source === id);
    node = edge && byId.get(edge.target);
  }
  return path;
}
