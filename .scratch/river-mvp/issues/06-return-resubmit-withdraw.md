# 06: Return、重新送出與 Withdraw

**What to build:** 審批人可以 Return 一個 Task（必須填寫意見），Request 回到發起人手上。發起人修改表單後重新送出，Request 從 Process 的開頭重新開始，先前的核准全部失效。Request 完成之前，發起人隨時可以 Withdraw。已決定不做「永久拒絕」：審批結果只有核准和 Return。

**Blocked by:** 05（表單設計器與開始表單）

**Status:** ready-for-agent

- [ ] 審批人 Return 時必須填寫意見；Request 狀態變成 returned，發起人可以在「我的申請」看到意見
- [ ] Return 時，該 Request 所有 open 的 Task 都變成 superseded
- [ ] 發起人修改開始表單後重新送出，workflow 從 start 重新執行，所有審批都要重新進行；時間軸保留先前每一輪的紀錄
- [ ] Return 次數多時，workflow 會使用 `continueAsNew`（有測試：連續 Return 多次後，Request 仍然能正常完成）
- [ ] Request 在 running 或 returned 狀態時，發起人可以 Withdraw；Withdraw 後 open 的 Task 都變成 superseded，Request 狀態為 withdrawn
- [ ] Seam ① 涵蓋：Return → 修改 → 重新送出 → 完成，以及 Withdraw
