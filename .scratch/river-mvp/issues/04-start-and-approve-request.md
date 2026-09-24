# 04: 發起並核准最小的 Request

**What to build:** 這是第一條真正跑完的流程。Participant 在入口網站選一個已發佈的 Process 發起 Request；審批人在「我的待辦」看到 Task 並核准；Request 完成。發起人可以在「我的申請」看到狀態和時間軸。這張 ticket 會建立通用的 interpreter workflow，以及 Task 收件匣與稽核歷程。

**Blocked by:** 02（Participant、Role、Permission 管理）、03（Designer 發佈最小的 Process）

**Status:** ready-for-agent

- [ ] Participant 可以在入口網站看到已發佈的 Process，並發起 Request（先只填一個標題欄位）
- [ ] 每筆 Request 對應一個 Temporal workflow，workflow ID 等於 Request ID；輸入只有 Request ID 和 Process Version ID
- [ ] Request 流轉到審批節點時，activity 在 Postgres 建立 Task，審批人可以在「我的待辦」看到
- [ ] 審批人核准後：API 先更新 Task（使用樂觀鎖），再送出 `taskCompleted` Signal；workflow 走到 end，Request 變成 completed
- [ ] Signal 是冪等的：重複送出同一個 taskId 不會產生任何影響（有測試）
- [ ] 每個狀態變化都寫入只能新增的 request_events；「我的申請」列表和 Request 時間軸直接讀這張表
- [ ] Seam ① 的 API 測試涵蓋從發起、核准到完成的完整流程
