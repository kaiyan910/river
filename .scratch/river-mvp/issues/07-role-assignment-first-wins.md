# 07: 指派給 Role，先送出者勝出

**What to build:** Designer 可以把審批或填表節點指派給一個 Role。Role 的每位成員都能在「我的待辦」看到該 Task，不需要認領就可以直接處理；最先送出的決定生效，後送出的人會收到「已由 X 處理」。

**Blocked by:** 04（發起並核准最小的 Request）

**Status:** ready-for-agent

- [ ] 人工節點的指派對象新增 Role 選項
- [ ] Role 的所有成員的「我的待辦」都會出現該 Task；Task 完成後，就從所有人的待辦中消失
- [ ] 兩位成員同時送出時，只有一位成功，另一位收到 409 和「已由 X 處理」；workflow 只收到一次 Signal（Seam ① 並發測試）
- [ ] 時間軸記錄實際處理 Task 的人
