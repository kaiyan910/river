# 03: Designer 發佈最小的 Process

**What to build:** Designer 可以在 React Flow 畫布上建立一個 Process 草稿：start → 審批節點（指派給特定 Participant）→ end。畫布會即時顯示 DSL 檢查錯誤；只有通過檢查的草稿才能發佈成 Process Version。這張 ticket 會建立 DSL package（型別、Zod schema、畫布與 DSL 的轉換、檢查器）。

**Blocked by:** 01（Walking skeleton）

**Status:** ready-for-agent

- [ ] 持有 process.edit 的人可以建立 Process 草稿，在畫布上新增 start、approval、end 節點並連線，草稿可以儲存
- [ ] 審批節點可以選擇指派給一位特定 Participant
- [ ] DSL 檢查器是純函式，輸出包含節點 ID、錯誤代碼和訊息的錯誤清單；目前檢查：沒有 start 或 end、到不了的節點、懸空的邊、審批節點沒有指派對象（Seam ② 測試）
- [ ] 畫布上即時標示有錯誤的節點
- [ ] 持有 process.publish 的人可以發佈；API 使用同一個檢查器，檢查不通過時拒絕發佈並回傳相同的錯誤
- [ ] 發佈後產生一個不可修改的 Process Version，並成為該 Process 的目前版本
