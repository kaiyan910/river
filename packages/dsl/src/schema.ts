import { z } from 'zod';

/**
 * Process DSL：以節點與邊組成的有向圖，以 JSON 儲存。
 * 目前只有 start、approval、end；其他節點類型（form、condition、parallelSplit…）由後續 ticket 加入。
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

export const startNodeSchema = z.object({ ...nodeBase, type: z.literal('start') });
export const endNodeSchema = z.object({ ...nodeBase, type: z.literal('end') });
/** 審批節點；草稿中可以還沒指派（null），發佈前由檢查器擋下。 */
export const approvalNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('approval'),
  assignee: assigneeSchema.nullable(),
});

export const processNodeSchema = z.discriminatedUnion('type', [
  startNodeSchema,
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
});
export type ProcessDsl = z.infer<typeof processDslSchema>;

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  start: '開始',
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
  };
}
