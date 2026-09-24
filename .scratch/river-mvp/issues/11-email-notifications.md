# 11: Email 通知與 Email 節點

**What to build:** 有新 Task 時，平台會寄信通知處理人；Request 被 Return 或完成時，會寄信通知發起人。Designer 也可以在流程中加入 Email 節點。所有信件只包含 Request 標題、Process 名稱和回到平台的連結，一律不含表單內容。

**Blocked by:** 04（發起並核准最小的 Request）

**Status:** ready-for-agent

- [ ] 以下事件會寄出 email：新 Task（寄給處理人；指派給 Role 時寄給所有成員）、Return、Request 完成（寄給發起人）
- [ ] 信件用 React Email 範本渲染；連結直接開到對應的 Task 或 Request，未登入時先登入，登入後再導回原本的頁面
- [ ] 新增 email 節點；收件對象可以是特定人、Role、發起人或發起人的 Manager；範本只能使用非敏感的變數
- [ ] Seam ① 測試斷言：寄出的信件內容中不含任何表單欄位的值
- [ ] 在本機可以透過 Mailpit 看到所有信件
