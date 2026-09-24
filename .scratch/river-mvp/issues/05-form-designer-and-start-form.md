# 05: 表單設計器與開始表單

**What to build:** Designer 可以用拖拉的方式設計 Form，並指定開始步驟和填表節點要用哪個 Form。Participant 發起 Request 時填寫開始表單，填表 Task 則填寫對應的 Form；審批人以唯讀方式看到表單資料。Form 資料只存在 Postgres，不會進入 Temporal。

**Blocked by:** 04（發起並核准最小的 Request）

**Status:** ready-for-agent

- [ ] 表單設計器（dnd-kit）支援以下欄位：單行文字、多行文字、數字、金額、日期、單選、多選、checkbox；可以設定必填和簡單的驗證規則
- [ ] Form 屬於 Process，並隨 Process Version 一起存成快照
- [ ] 渲染端從 Form schema 產生 Zod，交給 TanStack Form 驗證；API 端用同一份 schema 驗證，資料不合法時拒絕
- [ ] 新增 form（填表）節點類型；DSL 檢查器新增一條規則：填表節點必須指定 Form
- [ ] Form 資料依步驟存入 request_data；審批人在 Task 畫面以唯讀方式看到
- [ ] 安全測試（Seam ①）：跑完一筆 Request 後，Temporal history 的所有 payload 中都找不到任何表單欄位的值
