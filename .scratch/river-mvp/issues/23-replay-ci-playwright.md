# 23: Replay CI 與 Playwright smoke

**What to build:** 在 CI 加入兩種保護：用保存下來的 workflow history 樣本重跑新版 interpreter（Seam ③），確保修改程式碼不會破壞執行中的 Request；再用 Playwright 在瀏覽器中走一次完整流程。

**Blocked by:** 06（Return、重新送出與 Withdraw）、10（並行分支與匯合）、14（Reminder 與 Escalation）

**Status:** ready-for-agent

- [ ] 保存具代表性的 history 樣本：一般核准、Return 後重新送出、並行分支、Escalation
- [ ] CI 對所有樣本跑 replay；發生 nondeterminism 時 CI 失敗
- [ ] 文件說明新增或更新樣本的流程，以及修改 interpreter 時該用 Worker Versioning 還是 `patched()`
- [ ] Playwright smoke：Designer 發佈一個簡單的 Process → Participant 發起 → 審批人 Return → 發起人重新送出 → 核准 → 完成
- [ ] Playwright 測試在 CI 中對 Docker Compose 環境執行
