# 13: 可見範圍

**What to build:** Designer 可以用 Initiator Role 限制誰能發起某個 Process，用 Observer Role 讓某些 Role 查看該 Process 的所有 Request。除此之外，只有關係人（發起人，以及曾經被指派過 Task 的人）和持有 request.view_all 的人，可以看到一筆 Request。

**Blocked by:** 07（指派給 Role，先送出者勝出）

**Status:** ready-for-agent

- [ ] Process 可以設定 Initiator Role；沒有設定時，所有 Participant 都可以發起。入口網站只列出使用者可以發起的 Process，API 也會拒絕沒有權限的發起請求
- [ ] Process 可以設定 Observer Role，其成員可以看到該 Process 的所有 Request
- [ ] Request 的列表和明細 API 都依可見範圍過濾（在 repository 層檢查）；無關的 Participant 取得明細時收到 404
- [ ] 持有 request.view_all 的人可以看到所有 Request
- [ ] Seam ① 為每一種可見身分，各有正反兩面的測試
