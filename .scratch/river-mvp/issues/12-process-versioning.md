# 12: 新版本與版本鎖定

**What to build:** Designer 可以從目前的 Process Version 建立新草稿並修改，再發佈成新的 Process Version。發佈之後，執行中的 Request 繼續用原本的版本跑完，新的 Request 使用新版本。

**Blocked by:** 04（發起並核准最小的 Request）

**Status:** ready-for-agent

- [ ] Designer 可以從目前的 Process Version 建立新草稿；草稿的修改不影響目前版本
- [ ] Process 頁面會列出所有 Process Version，並標示目前版本
- [ ] Seam ①：v1 的 Request 停在審批節點時發佈 v2（在中間多加一個審批節點），v1 的 Request 仍照 v1 跑完；之後發起的 Request 使用 v2
