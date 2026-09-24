# 10: 並行分支與匯合

**What to build:** Designer 可以用並行分支讓幾個步驟同時進行，例如 IT 和財務同時審批；所有分支都完成後，Request 才會繼續。任一分支被 Return 時，整筆 Request 回到發起人手上，其他分支上的 Task 一併作廢。

**Blocked by:** 06（Return、重新送出與 Withdraw）

**Status:** ready-for-agent

- [ ] 新增 parallelSplit 與 parallelJoin 節點；join 會等待所有進入它的分支都完成
- [ ] DSL 檢查器新增規則：split 與 join 必須配對（Seam ②）
- [ ] 並行分支上的 Task 會同時出現在各自處理人的待辦中
- [ ] 任一分支 Return 時，其他分支的 open Task 都變成 superseded，Request 狀態變成 returned；重新送出後從頭開始（Seam ①）
