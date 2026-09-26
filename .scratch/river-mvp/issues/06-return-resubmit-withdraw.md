# 06: Return、重新送出與 Withdraw

**What to build:** 審批人可以 Return 一個 Task（必須填寫意見），Request 回到發起人手上。發起人修改表單後重新送出，Request 從 Process 的開頭重新開始，先前的核准全部失效。Request 完成之前，發起人隨時可以 Withdraw。已決定不做「永久拒絕」：審批結果只有核准和 Return。

**Blocked by:** 05（表單設計器與開始表單）

**Status:** resolved

- [x] 審批人 Return 時必須填寫意見；Request 狀態變成 returned，發起人可以在「我的申請」看到意見
- [x] Return 時，該 Request 所有 open 的 Task 都變成 superseded
- [x] 發起人修改開始表單後重新送出，workflow 從 start 重新執行，所有審批都要重新進行；時間軸保留先前每一輪的紀錄
- [x] Return 次數多時，workflow 會使用 `continueAsNew`（有測試：連續 Return 多次後，Request 仍然能正常完成）
- [x] Request 在 running 或 returned 狀態時，發起人可以 Withdraw；Withdraw 後 open 的 Task 都變成 superseded，Request 狀態為 withdrawn
- [x] Seam ① 涵蓋：Return → 修改 → 重新送出 → 完成，以及 Withdraw

## Comments

### 實作紀錄（2026-09-26）

- 資料：
  - `requests.status` 多了 `returned`、`withdrawn`；`tasks.status` 多了 `superseded`，`outcome` 多了 `returned`。
  - `requests`、`tasks`、`request_data` 都加上 `round`（第幾輪）。`request_data` 的 unique 改成 `(request_id, node_id, round)`：重新送出不會覆寫資料，每一輪的資料都保留（回答 05 留下的問題）。
  - 新事件：`task.returned`、`task.superseded`、`request.resubmitted`、`request.withdrawn`。
- API：
  - `POST /api/tasks/:id/complete` 接受 `outcome: 'returned'`，只有審批 Task 可以用，而且一定要填意見（400）。同一個 transaction 裡先鎖 Request，再把 Task 標成 returned、其他 open Task 標成 superseded，最後把 Request 改成 returned。
  - `POST /api/requests/:id/resubmit`：只有發起人可以呼叫，Request 必須是 returned 狀態；以同一份開始表單驗證，round + 1。
  - `POST /api/requests/:id/withdraw`：running 或 returned 都可以；原因選填；open Task 全部作廢。
  - 鎖定順序一律是先 Request 後 Task；`createTask` activity 也先鎖 Request，Request 不是 running 時不會建立 Task。
  - 「我的申請」多了 `returned`（誰、哪一步、意見）；明細多了 `round`，`data` 只放這一輪的資料，Task 與時間軸保留每一輪。
  - 作廢的 Task 不會出現在「我的待辦」；對作廢的 Task 送出核准回 409，並說明原因。
- Workflow：
  - 新增 `resubmitted { round }` 與 `withdraw` Signal。Return 之後停下來等；重新送出時，每次都用 `continueAsNew` 帶著新的 round 從頭跑；Withdraw 時直接結束。
  - `resubmitted` 只有在 round 比目前的大時才生效，所以可以重送。
  - Return 的 Signal 如果遺失，收到 resubmitted 一樣會從頭開始。Withdraw 的 Signal 如果遺失，`createTask` 回傳 false 時 workflow 就會結束。
  - 沒有加 `patched()`：舊 history 的 command 順序不變。新的 Signal handler 和 condition 不會產生 command；`continueAsNew` 只會走在新 Signal 的路徑；`createTask` 只認 `false`，舊版回傳的 undefined 不會觸發新路徑。replay 測試留給 23。
- Web：
  - 待辦的審批區多了 Return 按鈕，意見必填。
  - 「我的申請」分頁改成「進行中（含已退回）｜已結束（完成、撤回）｜全部」。被退回的列會顯示「已退回 · 意見」。
  - 明細有「已退回，請修改後重新送出」區塊，顯示意見，並預先填好標題與開始表單。
  - Withdraw 會先展開確認，再送出。進度只看這一輪的 Task；時間軸會顯示新的事件。
- 測試：Seam ① `apps/api/test/return-withdraw.test.ts` 有 8 個測試，涵蓋意見必填、Return、重新送出後從頭開始、重新送出的限制與並發、連續 6 次 Return 後完成（runId 會改變）、resubmitted 冪等、running 時 Withdraw，以及 returned 時 Withdraw 與其限制。
- 已知限制、留給後續：
  - 「Return 時其他 open Task 作廢」在循序流程中測不到，留給 10（並行分支）補測試。
  - 重新送出如果在 commit 後 Signal 遺失，畫面會停在「處理中」。要等發起人再按一次，拿到 409 時才會補送 Signal。
  - 前幾輪的 Form 資料留在資料庫，畫面上還看不到。
  - 本機開發資料庫要先執行 `bun run db:migrate`（0005）。
  - `turbo test` 不依賴 `^build`。workflow bundle 讀的是 `@river/contracts` 的 `dist`，改了合約要先 build，否則 Seam ① 會卡住。
