# 08: 指派給 Manager 與 Fallback Role

**What to build:** Administrator 可以設定每位 Participant 的 Manager。Designer 可以把人工節點指派給「發起人的 Manager」，而且必須同時設定 Fallback Role；當發起人沒有 Manager，或 Manager 已停用時，Task 改派給 Fallback Role。

**Blocked by:** 07（指派給 Role，先送出者勝出）

**Status:** ready-for-agent

- [ ] Administrator 可以設定或清除 Participant 的 Manager；不能設定自己為 Manager，也不能形成循環
- [ ] 人工節點的指派對象新增「發起人的 Manager」選項
- [ ] DSL 檢查器新增一條規則：指派給 Manager 的節點必須設定 Fallback Role（Seam ②）
- [ ] 發起人有有效的 Manager 時，Task 指派給 Manager
- [ ] 發起人沒有 Manager，或 Manager 已停用時，Task 指派給 Fallback Role，時間軸記錄原因（Seam ①）
