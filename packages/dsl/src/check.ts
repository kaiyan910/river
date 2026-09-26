import { checkForm, FORM_ERROR_CODES } from '@river/forms';
import jsonata from 'jsonata';
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
  'MANAGER_NO_FALLBACK_ROLE',
  'NODE_FORM_MISSING',
  'CONDITION_NO_DEFAULT',
  'CONDITION_MULTIPLE_DEFAULTS',
  'CONDITION_EDGE_NO_EXPRESSION',
  'INVALID_JSONATA',
  ...FORM_ERROR_CODES,
] as const;
export type DslErrorCode = (typeof DSL_ERROR_CODES)[number];

export interface DslError {
  /** 出錯的節點；整份流程層級與 Form 本身的錯誤為 null。 */
  nodeId: string | null;
  /** 條件節點某一條出邊的錯誤：哪一條出邊（nodeId 是條件節點）。 */
  edgeId?: string;
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

  for (const node of dsl.nodes)
    if (
      (node.type === 'approval' || node.type === 'form') &&
      node.assignee?.type === 'manager' &&
      !node.assignee.fallbackRoleId
    )
      errors.push({
        nodeId: node.id,
        code: 'MANAGER_NO_FALLBACK_ROLE',
        message: `「${node.name}」指派給發起人的 Manager，必須設定 Fallback Role。`,
      });

  for (const node of dsl.nodes) {
    if (node.type !== 'condition') continue;
    const outgoing = dsl.edges.filter((e) => e.source === node.id);
    const defaults = outgoing.filter((e) => e.branch?.type === 'default').length;
    if (defaults === 0)
      errors.push({
        nodeId: node.id,
        code: 'CONDITION_NO_DEFAULT',
        message: `條件「${node.name}」必須有一條預設出邊，沒有任何條件成立時走這條。`,
      });
    if (defaults > 1)
      errors.push({
        nodeId: node.id,
        code: 'CONDITION_MULTIPLE_DEFAULTS',
        message: `條件「${node.name}」只能有一條預設出邊。`,
      });
    for (const edge of outgoing) {
      if (edge.branch?.type === 'default') continue;
      const expression = edge.branch?.expression.trim();
      const at = { nodeId: node.id, edgeId: edge.id };
      if (!expression) {
        errors.push({
          ...at,
          code: 'CONDITION_EDGE_NO_EXPRESSION',
          message: `條件「${node.name}」有一條出邊還沒設定條件。`,
        });
        continue;
      }
      const syntaxError = jsonataSyntaxError(expression);
      if (syntaxError)
        errors.push({
          ...at,
          code: 'INVALID_JSONATA',
          message: `條件「${node.name}」有一條出邊的 JSONata 表達式有語法錯誤：${syntaxError}`,
        });
    }
  }

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

/** 只解析、不執行；語法正確時回傳 null。JSONata 丟出的不是 Error，而是帶 message、position 的物件。 */
function jsonataSyntaxError(expression: string): string | null {
  try {
    jsonata(expression);
    return null;
  } catch (e) {
    const { message, position } = (e ?? {}) as { message?: unknown; position?: unknown };
    const text = typeof message === 'string' ? message : '無法解析';
    return typeof position === 'number' ? `${text}（第 ${position} 個字元）` : text;
  }
}
