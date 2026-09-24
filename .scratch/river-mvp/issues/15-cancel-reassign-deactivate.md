# 15: Cancel、Reassign 與停用帳號

**What to build:** Administrator 可以處理例外狀況：Cancel 任何執行中的 Request、把任何 open 的 Task Reassign 給其他人，以及停用離職員工的帳號。停用前會先顯示影響範圍；停用後，session 立即失效，直接指派給此人的 Task 會進入「待 Reassign」清單。

**Blocked by:** 08（指派給 Manager 與 Fallback Role）、11（Email 通知與 Email 節點）

**Status:** ready-for-agent

- [ ] 持有 request.cancel 的人可以 Cancel Request（必須填寫原因）；所有 open 的 Task 都變成 superseded，Request 狀態為 cancelled
- [ ] 持有 task.reassign 的人可以 Reassign Task；原 Task 變成 superseded，並為新的處理人建立 Task
- [ ] 停用前預覽影響範圍：直接指派給此人的 open Task，以及以此人為 Manager 的 Participant
- [ ] 停用後，此人的所有 session 立即失效；資料一律不刪除；此人發起的 Request 照常繼續
- [ ] 直接指派給已停用 Participant 的 open Task 會出現在「待 Reassign」清單，並寄信通知 Administrator
- [ ] Seam ① 涵蓋以上所有情況
