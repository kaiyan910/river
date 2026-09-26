# 09: 條件分支（JSONata）

**What to build:** Designer 可以加入條件節點：每條出邊有一個 JSONata 表達式，另有一條預設出邊。Request 依表單資料走不同的分支，例如金額大於 10000 時加走總經理審批。表達式在 activity 中計算，只把選中的出邊回傳給 workflow。

**Blocked by:** 05（表單設計器與開始表單）

**Status:** resolved

- [x] 新增 condition 節點；每條出邊可以設定 JSONata 表達式，並依序評估；必須有一條預設出邊
- [x] 表達式可以用欄位的 key 讀取 Form 欄位的值
- [x] DSL 檢查器新增規則：JSONata 語法錯誤、缺少預設出邊（Seam ②）
- [x] `evaluateCondition` activity 從 Postgres 讀取資料並計算，只回傳出邊 ID；workflow 內不執行 JSONata
- [x] Seam ①：金額低於和高於門檻時，Request 各自走不同的路徑；沒有任何條件成立時，走預設出邊

## Comments

### 實作紀錄（2026-09-26）

- DSL：新增 `condition` 節點（本身沒有設定）。條件放在出邊上：`edge.branch` 是 `{ type: 'expression', expression }` 或 `{ type: 'default' }`，依出邊在 `edges` 裡的順序評估，第一個結果「是 `true`」的出邊勝出（truthy 的值不算）。
- 檢查器（Seam ②）：新增 4 個錯誤碼。
  - `CONDITION_NO_DEFAULT`：缺少預設出邊。
  - `CONDITION_MULTIPLE_DEFAULTS`：預設出邊不只一條。
  - `CONDITION_EDGE_NO_EXPRESSION`：出邊沒有條件，或條件是空白。
  - `INVALID_JSONATA`：只解析、不執行。
  - 出邊的錯誤帶 `edgeId`，合約的 `dslErrorSchema` 也一併加上這個欄位。
- 表達式的資料：`chooseBranch`（`@river/dsl/branch`）。
  - 把這一輪所有 `request_data` 依填寫順序合併，鍵是欄位代碼；同一個 key 出現在多份 Form 時，以最後填寫的為準。
  - 表達式執行時出錯視為不成立，並用 activity log 記下出邊 ID 和 JSONata 的錯誤代碼，不記錄 Form 資料。
  - 這支函式不從 `@river/dsl` 主入口匯出，免得 workflow sandbox 意外打包 JSONata。
- Worker：新增 `evaluateCondition({ requestId, processVersionId, nodeId })` activity，從 Postgres 讀取 Process Version 與資料，只回傳出邊 ID。interpreter 遇到 condition 節點時呼叫它，再沿著那條出邊往下走。舊的 history 裡不會出現 condition 節點，其他節點的 `next` 行為也沒變，所以沒有加 `patched()`。
- 流程預覽：原本的 `mainPath` 只取第一條出邊，遇到分支會漏掉步驟，所以改成 `nodesInOrder`。
  - 列出從「開始」走得到的所有節點，並做拓樸排序，讓「結束」和匯合點排在分支之後。
  - 條件節點本身不列出。
- Web（Designer）：
  - 節點面板新增「條件」。
  - 條件節點的出邊在線上標出條件或「預設」，有錯誤時畫成紅色。
  - 屬性面板可以：
    - 設定每條出邊的表達式；
    - 勾選預設出邊（勾選新的預設出邊時，原本的預設出邊改回表達式）；
    - 上下調整評估順序；
    - 查看流程裡可用的欄位代碼。
- 測試：
  - Seam ①：`apps/api/test/condition-branch.test.ts` 有 7 個測試，涵蓋：
    - 高於門檻時加走總經理；
    - 低於門檻時走預設出邊；
    - 依出邊順序，第一個成立的條件勝出；
    - Return 後改金額重新送出，依新一輪的資料判斷；
    - 流程預覽；
    - 安全斷言：Form 的值不出現在 history 中；
    - 語法錯誤或缺少預設出邊時不能發佈。
  - Seam ②：新增 6 個測試。
  - 另外有 `chooseBranch`、`nodesInOrder` 與畫布轉換的單元測試。
- 已知限制、待決定：
  - repo 還沒有 replay 測試與 history 樣本（23）。「新增節點類型不需要 `patched()`」這個推論，目前只靠程式註解說明。
  - `CONTEXT.md` 還沒有「條件節點」、「出邊」、「預設出邊」這些詞。
  - 入口網站的進度條：沒有走到的分支步驟一直顯示「還沒到」。
  - 表達式沒有執行時間上限。

