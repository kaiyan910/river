import { checkForm, FORM_ERROR_CODES } from '@river/forms';
import { formIdOf, type ProcessDsl } from './schema.js';

export const DSL_ERROR_CODES = [
  'MISSING_START',
  'MISSING_END',
  'DANGLING_EDGE',
  'UNREACHABLE_NODE',
  'NODE_NO_NAME',
  'APPROVAL_NO_ASSIGNEE',
  'FORM_NODE_NO_FORM',
  'FORM_NODE_NO_ASSIGNEE',
  'NODE_FORM_MISSING',
  ...FORM_ERROR_CODES,
] as const;
export type DslErrorCode = (typeof DSL_ERROR_CODES)[number];

export interface DslError {
  /** 出錯的節點；整份流程層級與 Form 本身的錯誤為 null。 */
  nodeId: string | null;
  code: DslErrorCode;
  message: string;
  /** Form 本身的錯誤：哪一份 Form、哪個欄位（Form 層級為 null）。 */
  formId?: string;
  fieldId?: string | null;
}

/**
 * 發佈前檢查。純函式：前端即時標示錯誤與 API 拒絕發佈都呼叫它，所以兩邊的結果一定一致。
 * 錯誤依檢查項目排列：流程層級 → 連線 → 可達性 → 節點設定 → 節點用到的 Form。
 */
export function checkProcess(dsl: ProcessDsl): DslError[] {
  const errors: DslError[] = [];
  const ids = new Set(dsl.nodes.map((n) => n.id));
  const starts = dsl.nodes.filter((n) => n.type === 'start');

  if (starts.length === 0)
    errors.push({ nodeId: null, code: 'MISSING_START', message: '流程沒有「開始」節點。' });
  if (!dsl.nodes.some((n) => n.type === 'end'))
    errors.push({ nodeId: null, code: 'MISSING_END', message: '流程沒有「結束」節點。' });

  for (const edge of dsl.edges) {
    if (ids.has(edge.source) && ids.has(edge.target)) continue;
    const attached = [edge.source, edge.target].find((id) => ids.has(id)) ?? null;
    errors.push({
      nodeId: attached,
      code: 'DANGLING_EDGE',
      message: '有一條連線的另一端沒有接到節點。',
    });
  }

  // 沒有 start 時每個節點都到不了，已經由 MISSING_START 回報。
  if (starts.length > 0) {
    const reached = new Set(starts.map((n) => n.id));
    const queue = [...reached];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      for (const edge of dsl.edges) {
        if (edge.source !== id || !ids.has(edge.target) || reached.has(edge.target)) continue;
        reached.add(edge.target);
        queue.push(edge.target);
      }
    }
    for (const node of dsl.nodes)
      if (!reached.has(node.id))
        errors.push({
          nodeId: node.id,
          code: 'UNREACHABLE_NODE',
          message: `「${node.name}」從「開始」走不到。`,
        });
  }

  for (const node of dsl.nodes)
    if (!node.name.trim())
      errors.push({ nodeId: node.id, code: 'NODE_NO_NAME', message: '有一個節點沒有名稱。' });

  for (const node of dsl.nodes)
    if (node.type === 'approval' && !node.assignee)
      errors.push({
        nodeId: node.id,
        code: 'APPROVAL_NO_ASSIGNEE',
        message: `「${node.name}」還沒有指派審批人。`,
      });

  const formIds = new Set(dsl.forms.map((f) => f.id));
  for (const node of dsl.nodes) {
    if (node.type === 'form') {
      if (!node.formId)
        errors.push({
          nodeId: node.id,
          code: 'FORM_NODE_NO_FORM',
          message: `填表節點「${node.name}」必須指定 Form。`,
        });
      if (!node.assignee)
        errors.push({
          nodeId: node.id,
          code: 'FORM_NODE_NO_ASSIGNEE',
          message: `「${node.name}」還沒有指派填表人。`,
        });
    }
    const formId = formIdOf(node);
    if (formId && !formIds.has(formId))
      errors.push({
        nodeId: node.id,
        code: 'NODE_FORM_MISSING',
        message: `「${node.name}」使用的 Form 已經不存在。`,
      });
  }

  // 只檢查有節點使用的 Form；共用的 Form 只回報一次。
  const used = new Set(dsl.nodes.map(formIdOf));
  for (const form of dsl.forms)
    if (used.has(form.id))
      for (const e of checkForm(form))
        errors.push({
          nodeId: null,
          formId: e.formId,
          fieldId: e.fieldId,
          code: e.code,
          message: e.message,
        });

  return errors;
}
