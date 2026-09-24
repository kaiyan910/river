# 14: Reminder 與 Escalation

**What to build:** Designer 可以在人工節點上設定逾時處理：N 小時後發出 Reminder（可以重複），M 小時後 Escalation。指派給特定人或 Manager 的節點，Escalation 轉給處理人的 Manager；指派給 Role 的節點，轉給 Designer 另外指定的對象。Escalation 絕不會自動核准。

**Blocked by:** 08（指派給 Manager 與 Fallback Role）、11（Email 通知與 Email 節點）

**Status:** ready-for-agent

- [ ] 人工節點可以設定 Reminder（間隔、是否重複）與 Escalation（時限、目標）
- [ ] DSL 檢查器新增規則：指派給 Role 的節點設定 Escalation 時，必須指定目標（Seam ②）
- [ ] Reminder 用 durable timer 實作，時間到時寄信給目前的處理人
- [ ] Escalation 時，原 Task 變成 superseded，並為新的處理人建立 Task；時間軸記錄原因。處理人沒有 Manager 時，轉給 Fallback Role
- [ ] Task 在逾時前完成時，timer 會取消，不會發出 Reminder 或 Escalation
- [ ] Seam ① 用 time skipping 涵蓋以上所有情況
