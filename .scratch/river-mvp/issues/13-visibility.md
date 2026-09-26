# 13: 可見範圍

**What to build:** Designer 可以用 Initiator Role 限制誰能發起某個 Process，用 Observer Role 讓某些 Role 查看該 Process 的所有 Request。除此之外，只有關係人（發起人，以及曾經被指派過 Task 的人）和持有 request.view_all 的人，可以看到一筆 Request。

**Blocked by:** 07（指派給 Role，先送出者勝出）

**Status:** resolved

- [x] Process 可以設定 Initiator Role；沒有設定時，所有 Participant 都可以發起。入口網站只列出使用者可以發起的 Process，API 也會拒絕沒有權限的發起請求
- [x] Process 可以設定 Observer Role，其成員可以看到該 Process 的所有 Request
- [x] Request 的列表和明細 API 都依可見範圍過濾（在 repository 層檢查）；無關的 Participant 取得明細時收到 404
- [x] 持有 request.view_all 的人可以看到所有 Request
- [x] Seam ① 為每一種可見身分，各有正反兩面的測試

## Comments

實作摘要（2026-09-26）：

- 資料：
  - 新增 `process_initiator_roles`、`process_observer_roles` 兩張表（migration `0011_process_access.sql`）。
  - 設定在 Process 上，不在 Process Version 裡：儲存後立刻生效，不需要重新發佈。
- 存取檢查（`apps/api/src/auth/data-access.ts`）：
  - `startableBy`：沒有 Initiator Role，或自己是其中任一個 Role 的成員。
  - `visibleTo`：自己發起的；有 Task 指派給自己或自己所屬的 Role、或自己處理過 Task 的；自己所屬的 Role 是該 Process 的 Observer Role 的。持有 `request.view_all` 時不限制。
  - 兩者都寫成 SQL 條件放進查詢的 WHERE；列表與明細共用同一個條件。Role 成員在查詢當下決定，移出 Role 立刻看不到。
- API：
  - `PUT /api/processes/:id/access`（需要 `process.publish`，因為不經發佈就生效）以整份取代兩種 Role；不存在的 Role 回 422。`GET /api/processes/:id` 帶 `initiatorRoles`、`observerRoles`。
  - `GET /api/processes/startable` 只列出自己可以發起的 Process；`POST /api/requests` 沒有權限時回 403。
  - 新增 `GET /api/requests`：看得到的所有 Request。`GET /api/requests/:id` 看不到時回 404。
  - 重新送出與 Withdraw 仍然只有發起人可以做；Observer 與 `request.view_all` 是唯讀。
- Web：
  - Designer 標題列顯示「誰可發起 · 誰可查看」，點開後用勾選清單設定 Initiator Role 與 Observer Role。
  - 入口網站新增「可查看的 Request」頁（`/requests/visible`），列出 `GET /api/requests`，可依發起人與 Process 名稱搜尋。
  - Request 明細只對發起人顯示重新送出與 Withdraw。
- 測試：Seam ① `apps/api/test/visibility.test.ts` 有 12 個測試，每種可見身分（發起人、指派給特定人、Role 成員、Observer Role、`request.view_all`）與 Initiator Role 都有正反兩面，另外涵蓋移出 Observer Role 後看不到。
- 已知限制與待決定：
  - 「全部 Request」（`/admin/requests`，需要 `request.view_all`）仍是佔位頁；持有 `request.view_all` 的人目前在「可查看的 Request」看到全部。可以在 issue 15（Cancel）時一併決定是否合併。
  - Service Account（issue 20）還沒有 Initiator Role 的授權規則。

