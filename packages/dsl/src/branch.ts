import jsonata from 'jsonata';
import type { ProcessEdge } from './schema.js';

/**
 * JSONata 的執行：條件節點選出邊、審批節點的 Auto-approval，以及 HTTP 節點的 body。
 * 只在 activity 中呼叫：表達式可能用到 $now() 等非決定性的函式。
 * 另外以 `@river/dsl/branch` 匯出，不放進主入口，免得 workflow sandbox 意外打包 JSONata。
 */

/**
 * 從條件節點的出邊中選出要走的那一條，回傳它的 ID。
 * 表達式依出邊順序評估，第一個結果「是 true」的勝出（非空字串、數字等 truthy 值不算）；
 * 執行時出錯（例如型別不符）視為不成立，並交給 onError 記錄。都不成立時走預設出邊；連預設出邊都沒有時回傳 null。
 * data 的鍵是欄位代碼。
 */
export async function chooseBranch(
  outgoing: readonly ProcessEdge[],
  data: Record<string, unknown>,
  onError: (edgeId: string, error: unknown) => void = () => {},
): Promise<string | null> {
  for (const edge of outgoing) {
    if (edge.branch?.type !== 'expression') continue;
    if (await holds(edge.branch.expression, data, (error) => onError(edge.id, error)))
      return edge.id;
  }
  return outgoing.find((e) => e.branch?.type === 'default')?.id ?? null;
}

/**
 * 審批節點的 Auto-approval 條件是否成立。和條件分支一樣，結果「是 true」才算成立；
 * 執行時出錯（包括語法錯誤）一律不成立並交給 onError 記錄：往安全的方向失敗，交給審批人。
 */
export function shouldAutoApprove(
  expression: string,
  data: Record<string, unknown>,
  onError: (error: unknown) => void = () => {},
): Promise<boolean> {
  return holds(expression, data, onError);
}

/**
 * HTTP 節點的 body：以 JSONata 從這一輪的 Form 資料組成，結果以 JSON 送出。
 * 空白的表達式代表不帶 body（回傳 undefined）。執行時出錯直接丟出，不送出不完整的 body。
 * 回傳一般的 JSON 值（JSONata 的陣列帶有額外的屬性，轉一次 JSON 去掉）。
 */
export async function evaluateHttpBody(
  expression: string,
  data: Record<string, unknown>,
): Promise<unknown> {
  if (!expression.trim()) return undefined;
  const result: unknown = await jsonata(expression).evaluate(data);
  return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
}

async function holds(
  expression: string,
  data: Record<string, unknown>,
  onError: (error: unknown) => void,
): Promise<boolean> {
  try {
    return (await jsonata(expression).evaluate(data)) === true;
  } catch (error) {
    onError(error);
    return false;
  }
}
