import { formSchema } from '@river/forms';
import { z } from 'zod';

/**
 * Process DSL：以節點與邊組成的有向圖，以 JSON 儲存。
 * 目前有 start、form、approval、condition、end；其他節點類型（parallelSplit…）由後續 ticket 加入。
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

const participantAssigneeSchema = z.object({
  type: z.literal('participant'),
  participantId: z.string().min(1),
});
const roleAssigneeSchema = z.object({ type: z.literal('role'), roleId: z.string().min(1) });

/**
 * 人工步驟的指派對象：特定 Participant、一個 Role（任一成員都可以直接處理，最先送出的生效），
 * 或發起人的 Manager。指派給 Manager 時，發起人沒有 Manager 或 Manager 已停用，Task 改派給 Fallback Role；
 * 草稿中 Fallback Role 可以還沒設定（null），發佈前由檢查器擋下。
 */
export const assigneeSchema = z.discriminatedUnion('type', [
  participantAssigneeSchema,
  roleAssigneeSchema,
  z.object({ type: z.literal('manager'), fallbackRoleId: z.string().min(1).nullable() }),
]);
export type Assignee = z.infer<typeof assigneeSchema>;

/** Task 實際的指派對象：特定 Participant 或 Role。指派給 Manager 的節點在建立 Task 時才決定是哪一種。 */
export type TaskAssignee = Extract<Assignee, { type: 'participant' | 'role' }>;

/** 節點使用的 Form（同一份 DSL 裡 forms 的 id）；草稿中可以還沒指定。 */
const formRefSchema = z.string().min(1).nullish();

/** 開始節點可以指定開始表單；沒有時發起人只填標題。 */
export const startNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('start'),
  formId: formRefSchema,
});
export const endNodeSchema = z.object({ ...nodeBase, type: z.literal('end') });
/**
 * 審批節點的 Auto-approval：流程走到這一步時，表達式的結果是 true 就由系統直接核准，不建立 Task。
 * 表達式和條件分支一樣用欄位代碼讀取這一輪填過的 Form 資料，例如 `amount < 1000`。
 * 草稿中表達式可以是空白或有語法錯誤，發佈前由檢查器擋下。
 */
export const autoApproveSchema = z.object({ expression: z.string().max(2000) });
export type AutoApprove = z.infer<typeof autoApproveSchema>;

/**
 * 審批節點；草稿中可以還沒指派（null），發佈前由檢查器擋下。
 * 設定了 Auto-approval 的節點仍然必須指派審批人：條件不成立或無法判斷時交給審批人。
 * 舊的 DSL 沒有 autoApprove，視同沒有設定。
 */
export const approvalNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('approval'),
  assignee: assigneeSchema.nullable(),
  autoApprove: autoApproveSchema.nullish(),
});

/** 填表節點：指派一位 Participant、一個 Role 或發起人的 Manager 填一份 Form；發佈前兩者都必須設定。 */
export const formNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('form'),
  formId: formRefSchema,
  assignee: assigneeSchema.nullable(),
});

/** 條件節點：本身沒有設定，分支條件放在出邊上（見 branchSchema）。 */
export const conditionNodeSchema = z.object({ ...nodeBase, type: z.literal('condition') });

export const processNodeSchema = z.discriminatedUnion('type', [
  startNodeSchema,
  formNodeSchema,
  approvalNodeSchema,
  conditionNodeSchema,
  endNodeSchema,
]);
export type ProcessNode = z.infer<typeof processNodeSchema>;
export type NodeType = ProcessNode['type'];

/**
 * 條件節點的出邊：一個 JSONata 表達式，或預設出邊。
 * 表達式依出邊在 edges 裡的順序評估，第一個結果為 true 的出邊勝出；都不成立時走預設出邊。
 * 表達式可以用欄位代碼讀取這一輪填過的 Form 資料，例如 `amount > 10000`。
 * 草稿中表達式可以是空白或有語法錯誤，發佈前由檢查器擋下。
 */
export const branchSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('expression'), expression: z.string().max(2000) }),
  z.object({ type: z.literal('default') }),
]);
export type Branch = z.infer<typeof branchSchema>;

/**
 * 邊的兩端在 schema 層不檢查是否存在，懸空的邊交給檢查器回報，草稿才能先儲存。
 * branch 只對條件節點的出邊有意義；其他節點的出邊沒有這個欄位。
 */
export const processEdgeSchema = z.object({
  id: z.string().min(1),
  source: nodeIdSchema,
  target: nodeIdSchema,
  branch: branchSchema.optional(),
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
  condition: '條件',
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
 * 流程預覽的節點順序：從「開始」走得到的每個節點各列一次，而且排在所有指向它的節點之後，
 * 所以條件分支上的節點都會列出，「結束」與分支的匯合點排在分支之後。
 * 同樣可以排的節點，依從「開始」沿著連線走到的先後排列；遇到迴圈時依走到的先後硬排，不會漏掉節點。
 */
export function nodesInOrder(dsl: ProcessDsl): ProcessNode[] {
  const byId = new Map(dsl.nodes.map((n) => [n.id, n]));
  const successors = (id: string) =>
    dsl.edges.filter((e) => e.source === id && byId.has(e.target)).map((e) => e.target);

  const start = dsl.nodes.find((n) => n.type === 'start');
  if (!start) return [];
  const reached = [start.id];
  for (let i = 0; i < reached.length; i++)
    for (const next of successors(reached[i] as string))
      if (!reached.includes(next)) reached.push(next);

  const pending = new Map(reached.map((id) => [id, 0]));
  for (const id of reached)
    for (const next of successors(id)) pending.set(next, (pending.get(next) ?? 0) + 1);

  const ordered: string[] = [];
  while (ordered.length < reached.length) {
    const remaining = reached.filter((id) => !ordered.includes(id));
    const id = remaining.find((r) => pending.get(r) === 0) ?? (remaining[0] as string);
    ordered.push(id);
    for (const next of successors(id)) pending.set(next, (pending.get(next) ?? 0) - 1);
  }
  return ordered.map((id) => byId.get(id) as ProcessNode);
}
