# 01: 「結束」節點可以關閉完成通知

**What to build:** Designer 可以在每一個「結束」節點上設定 Request 走到這裡完成時，是否寄完成通知給發起人。預設寄送。同一個 Process 裡，走到不同「結束」的 Request 可以有的寄、有的不寄。

**Blocked by:** 無

**Status:** resolved

- [x] DSL：「結束」節點新增選填的完成通知開關；沒有設定時視為寄送，所以舊的 Process Version 和執行中的 Request 行為不變
- [x] Interpreter：Request 完成時依它走到的「結束」節點決定是否寄完成通知；只有明確關閉時才不寄
- [x] 只影響系統內建的完成通知；Email 節點照常寄出，Return、新 Task 等其他通知也不受影響
- [x] 不寄時不寫任何 Request 事件（時間軸與進度不顯示；寄出時本來就不寫事件）
- [x] Designer 屬性面板：「結束」節點有「寄送完成通知」開關，新節點預設開啟
- [x] 畫布：關閉時「結束」節點顯示「不通知」提示；開啟時不顯示
- [x] Seam ① 測試：開啟時寄出、關閉時不寄、同一個 Process 走到不同「結束」時各自依設定；Email 節點在關閉時仍會寄出
- [x] Seam ③ replay 測試通過（舊 history 沒有這個欄位，呼叫的 activity 順序不變，不需要 `patched()`）

## 已決定

- 設定在每一個「結束」節點上，不在 Process 上；隨 Process Version 鎖定。
- 「結束」不會出現在並行分支內（分支必須走到匯合點），所以每一筆完成的 Request 只對應一個「結束」節點。
- 術語用「完成通知」（見 `CONTEXT.md`），避免「完成電郵」。
- 改回來的成本低，不寫 ADR。

## Comments

實作摘要（2026-09-26）：

- DSL：`endNodeSchema` 新增 `completionNotification: boolean | null | undefined`；只有 `false` 時不寄。
- Interpreter：`walk` 記下走到的「結束」節點（`reachedEnd`），`completeRequest` 之後依它決定是否呼叫 `notify('completed')`。舊 history 沒有這個欄位，呼叫的 activity 不變，不需要 `patched()`。workflow 只 import `@river/dsl` 的型別，所以直接在 interpreter 判斷，不加 helper。
- Designer：屬性面板加「寄送完成通知給發起人」checkbox；畫布上關閉時顯示「不通知發起人」。
- 測試：
  - Seam ①：`email-notifications.test.ts` 新增 2 個測試（關閉時不寄、Email 節點照常寄；同一個 Process 走到不同「結束」各自依設定）。拿掉 interpreter 的判斷時兩個都會失敗。
  - Seam ③：新增 `quiet-end` 樣本並加入 `REQUIRED`，舊樣本沒有重新產生。
- 已知限制：畫布與屬性面板的 UI 只跑過 typecheck，還沒在瀏覽器手動確認。
