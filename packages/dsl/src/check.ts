import { checkForm, FORM_ERROR_CODES } from '@river/forms';
import jsonata from 'jsonata';
import { EMAIL_TEMPLATE_VARIABLES, unknownTemplateVariables } from './email-template.js';
import { parallelPairings } from './parallel.js';
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
  'TIMEOUT_INVALID_HOURS',
  'ESCALATION_NO_TARGET',
  'ESCALATION_NO_FALLBACK_ROLE',
  'NODE_FORM_MISSING',
  'CONDITION_NO_DEFAULT',
  'CONDITION_MULTIPLE_DEFAULTS',
  'CONDITION_EDGE_NO_EXPRESSION',
  'INVALID_JSONATA',
  'AUTO_APPROVAL_NO_EXPRESSION',
  'PARALLEL_TOO_FEW_BRANCHES',
  'PARALLEL_SPLIT_UNMATCHED',
  'PARALLEL_JOIN_UNMATCHED',
  'PARALLEL_BRANCH_CROSSED',
  'EMAIL_NO_RECIPIENT',
  'EMAIL_NO_SUBJECT',
  'EMAIL_UNKNOWN_VARIABLE',
  ...FORM_ERROR_CODES,
] as const;
export type DslErrorCode = (typeof DSL_ERROR_CODES)[number];

export interface DslError {
  /** 出錯的節點；整份流程層級與 Form 本身的錯誤為 null。 */
  nodeId: string | null;
  /**
   * 出錯的連線：條件節點某一條出邊的錯誤（nodeId 是條件節點），
   * 或從並行分支外面連進分支裡的連線（nodeId 是連線的起點）。其他錯誤沒有這個欄位。
   */
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

  for (const node of dsl.nodes) {
    if (node.type !== 'approval' || !node.autoApprove) continue;
    const expression = node.autoApprove.expression.trim();
    if (!expression) {
      errors.push({
        nodeId: node.id,
        code: 'AUTO_APPROVAL_NO_EXPRESSION',
        message: `「${node.name}」啟用了自動核准，必須設定條件。`,
      });
      continue;
    }
    const syntaxError = jsonataSyntaxError(expression);
    if (syntaxError)
      errors.push({
        nodeId: node.id,
        code: 'INVALID_JSONATA',
        message: `「${node.name}」自動核准條件的 JSONata 表達式有語法錯誤：${syntaxError}`,
      });
  }

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
    if (node.type !== 'approval' && node.type !== 'form') continue;
    const { reminder, escalation } = node;
    for (const [label, timeout] of [
      ['Reminder', reminder],
      ['Escalation', escalation],
    ] as const)
      if (timeout && !(Number.isFinite(timeout.afterHours) && timeout.afterHours > 0))
        errors.push({
          nodeId: node.id,
          code: 'TIMEOUT_INVALID_HOURS',
          message: `「${node.name}」的 ${label} 時數必須大於 0。`,
        });
    if (!escalation) continue;
    if (node.assignee?.type === 'role' && !escalation.target)
      errors.push({
        nodeId: node.id,
        code: 'ESCALATION_NO_TARGET',
        message: `「${node.name}」指派給 Role，設定 Escalation 時必須指定要轉給誰。`,
      });
    if (node.assignee?.type === 'participant' && !escalation.fallbackRoleId)
      errors.push({
        nodeId: node.id,
        code: 'ESCALATION_NO_FALLBACK_ROLE',
        message: `「${node.name}」設定了 Escalation，必須設定 Fallback Role（處理人沒有 Manager 時轉給它）。`,
      });
  }

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

  errors.push(...checkParallel(dsl));

  for (const node of dsl.nodes) {
    if (node.type !== 'email') continue;
    if (!node.recipient)
      errors.push({
        nodeId: node.id,
        code: 'EMAIL_NO_RECIPIENT',
        message: `Email「${node.name}」還沒有設定收件對象。`,
      });
    if (!node.subject.trim())
      errors.push({
        nodeId: node.id,
        code: 'EMAIL_NO_SUBJECT',
        message: `Email「${node.name}」還沒有填寫主旨。`,
      });
    const allowed = Object.keys(EMAIL_TEMPLATE_VARIABLES)
      .map((v) => `{{${v}}}`)
      .join('、');
    for (const [part, template] of [
      ['主旨', node.subject],
      ['內文', node.message],
    ] as const) {
      const unknown = unknownTemplateVariables(template);
      if (unknown.length > 0)
        errors.push({
          nodeId: node.id,
          code: 'EMAIL_UNKNOWN_VARIABLE',
          message: `Email「${node.name}」的${part}用了不能用的變數 ${unknown.map((v) => `{{${v}}}`).join('、')}；信件不能包含 Form 資料，只能用 ${allowed}。`,
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

/**
 * split 與 join 必須配對：每個 split 至少兩條分支，每一條分支最後都回到同一個 join（中間可以有條件與內層的並行分支），
 * 每個 join 剛好屬於一個 split；分支之間不能互相連線，分支外面也不能直接連進分支裡或 join。
 * interpreter 依這個結構同時執行各條分支，所以配對不起來的流程不能發佈。
 */
function checkParallel(dsl: ProcessDsl): DslError[] {
  const errors: DslError[] = [];
  const byId = new Map(dsl.nodes.map((n) => [n.id, n]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const pairings = parallelPairings(dsl);
  const matched = (joinId: string) => [...pairings.values()].filter((p) => p.join === joinId);
  const crossed = new Set<string>();

  for (const [splitId, pairing] of pairings) {
    const split = nameOf(splitId);
    if (pairing.branches.length < 2)
      errors.push({
        nodeId: splitId,
        code: 'PARALLEL_TOO_FEW_BRANCHES',
        message: `並行分支「${split}」至少要有兩條出邊。`,
      });
    const { join } = pairing;
    if (!join) {
      if (!pairing.innerUnmatched)
        errors.push({
          nodeId: splitId,
          code: 'PARALLEL_SPLIT_UNMATCHED',
          message: `並行分支「${split}」的每一條分支都必須回到同一個並行匯合節點。`,
        });
      continue;
    }

    const region = new Set<string>();
    let overlapping = false;
    for (const branch of pairing.branches)
      for (const id of branch.nodes) {
        if (region.has(id)) overlapping = true;
        region.add(id);
      }
    if (overlapping)
      errors.push({
        nodeId: splitId,
        code: 'PARALLEL_BRANCH_CROSSED',
        message: `並行分支「${split}」的分支之間不能互相連線。`,
      });

    // 多個 split 共用的 join 已經由 PARALLEL_JOIN_UNMATCHED 回報，不再逐條回報連進 join 的連線。
    const guarded = matched(join).length > 1 ? region : new Set([...region, join]);
    for (const edge of dsl.edges) {
      if (!guarded.has(edge.target) || edge.source === splitId || region.has(edge.source)) continue;
      if (crossed.has(edge.id) || !byId.has(edge.source)) continue;
      crossed.add(edge.id);
      errors.push({
        nodeId: edge.source,
        edgeId: edge.id,
        code: 'PARALLEL_BRANCH_CROSSED',
        message: `「${nameOf(edge.source)}」連進了並行分支「${split}」裡面；分支只能從並行分支節點進入。`,
      });
    }
  }

  for (const node of dsl.nodes) {
    if (node.type !== 'parallelJoin') continue;
    const splits = matched(node.id).length;
    // 配對不起來的 split 走到了這個 join：錯誤已經回報在 split 上。
    const reachedByUnmatched = [...pairings.values()].some(
      (p) => !p.join && p.terminals.has(node.id),
    );
    if (splits > 1)
      errors.push({
        nodeId: node.id,
        code: 'PARALLEL_JOIN_UNMATCHED',
        message: `並行匯合「${node.name}」同時是多個並行分支的匯合點；每個並行分支要有自己的並行匯合。`,
      });
    else if (splits === 0 && !reachedByUnmatched)
      errors.push({
        nodeId: node.id,
        code: 'PARALLEL_JOIN_UNMATCHED',
        message: `並行匯合「${node.name}」沒有對應的並行分支節點。`,
      });
  }
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
