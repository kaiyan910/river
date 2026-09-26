# 10: 並行分支與匯合

**What to build:** Designer 可以用並行分支讓幾個步驟同時進行，例如 IT 和財務同時審批；所有分支都完成後，Request 才會繼續。任一分支被 Return 時，整筆 Request 回到發起人手上，其他分支上的 Task 一併作廢。

**Blocked by:** 06（Return、重新送出與 Withdraw）

**Status:** resolved

- [x] 新增 parallelSplit 與 parallelJoin 節點；join 會等待所有進入它的分支都完成
- [x] DSL 檢查器新增規則：split 與 join 必須配對（Seam ②）
- [x] 並行分支上的 Task 會同時出現在各自處理人的待辦中
- [x] 任一分支 Return 時，其他分支的 open Task 都變成 superseded，Request 狀態變成 returned；重新送出後從頭開始（Seam ①）

## Comments

實作摘要（2026-09-26）：

- DSL：新增 `parallelSplit`、`parallelJoin` 節點。`parallelPairings`（`packages/dsl/src/parallel.ts`）沿著每一條分支往下走，內層 split 整段跳過，找出每個 split 配對的 join。
- 檢查器新增 4 個錯誤代碼：
  - `PARALLEL_TOO_FEW_BRANCHES`：split 少於兩條出邊。
  - `PARALLEL_SPLIT_UNMATCHED`：分支走到「結束」、走到不同的 join，或繞回 split。
  - `PARALLEL_JOIN_UNMATCHED`：沒有對應的 split，或被多個 split 共用。
  - `PARALLEL_BRANCH_CROSSED`：分支之間互相連線，或從分支外面連進分支或 join，並標出是哪一條連線。
  - 分支裡可以有條件節點與內層的並行分支。
- Interpreter：`walk` 遇到 split 時用 `Promise.all` 同時走每一條分支，第一個遇到的 join 就是終點；全部回到 join 後才往下走。
  - 沒有並行分支的流程，呼叫的 activity 與順序都和原本一樣。
  - `createTask` 回傳 false 且不在並行分支上時，照舊直接結束。
  - 在並行分支上時，其他分支也一起停下：可能是另一條分支被 Return，要等重新送出或 Withdraw；也可能是 Withdraw 的 Signal 沒送到，這時 workflow 會結束，不會一直等下去。
- `evaluateCondition` 與 `evaluateAutoApproval` 的重試冪等：
  - 並行分支上其他分支會插入事件，所以不再看 Request 的最後一筆事件。
  - 改由 workflow 傳入「這一輪第幾次走到這個節點」（`visit`），activity 只數這個節點本身的紀錄：`step.branch_chosen`、`step.auto_approved`，或為它建立的 Task。
  - 舊的 workflow 沒有 `visit`，沿用原本的做法。
- Return：API 原本就會把 Request 所有 open 的 Task 作廢（`supersedeOpenTasks`），不需要修改。
- 流程預覽不列出條件、並行分支與並行匯合節點（`isSystemNode`）。
- 入口網站的進度條把每一條分支依出邊順序一條接一條列出，再接到匯合點；split 和 join 在走進它們的每一步都完成時算完成。
- Designer 的節點面板新增「並行分支」與「並行匯合」。
- `CONTEXT.md` 新增 Parallel Branch（並行分支）。
- 測試：
  - Seam ①：`apps/api/test/parallel.test.ts` 有 8 個測試，涵蓋：
    - Task 同時出現；
    - 等待所有分支完成；
    - 任一分支 Return 後從頭開始；
    - 較後面的步驟 Return；
    - Withdraw；
    - Withdraw 的 Signal 遺失；
    - 流程預覽；
    - 沒有配對時不能發佈。
  - Seam ②：新增 11 個測試。`requestPath` 新增 2 個測試。
- 已知限制、待決定：
  - 還沒有 replay 測試與 history 樣本（23）；「沒有並行分支的流程行為不變」只靠程式註解說明。
  - 並行分支在進度條上是依序列出的，還沒有畫成並排。
  - `apps/web/src/routes/designer/processes.tsx:1030` 有一個 biome a11y 錯誤，是之前就存在的。
  - `bun run typecheck` 的 turbo cache 沒有因為上游 package 改變而失效，`@river/web` 的型別錯誤曾經被 cache 蓋住；要加 `--force` 或直接在 `apps/web` 執行 `tsc`。
