# 21: 排程發起

**What to build:** Designer 可以為 Process 設定排程，例如每月 1 號自動發起一筆 Request。排程設定中必須指定一位 Participant 作為發起人。

**Blocked by:** 04（發起並核准最小的 Request）

**Status:** ready-for-agent

- [ ] Process 可以設定 cron 排程，並指定作為發起人的 Participant（spec 待決問題 #3 的建議預設）
- [ ] 排程由 Temporal Schedule 實作；修改或刪除設定時，會同步更新 Temporal Schedule
- [ ] 時間到時，以指定的 Participant 為發起人、使用目前的 Process Version 發起 Request
- [ ] 指定的發起人已停用時，跳過這次發起，並通知 Administrator
- [ ] Seam ① 測試時間到了會發起 Request
