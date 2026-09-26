# 24: 自動核准（Auto-approval）

**What to build:** Designer 可以在審批節點上設定一個 JSONata 條件。流程走到這個節點時，如果條件成立，系統直接核准這一步，不建立 Task，時間軸記錄「符合條件，自動核准」。條件不成立或無法判斷時，照常把 Task 交給審批人。例如「金額小於 1000 時主管審批自動核准」。

**Blocked by:** 09（條件分支（JSONata））

**Status:** resolved

- [x] 審批節點新增自動核准設定（JSONata 表達式）；只有審批節點有，填表節點沒有；跟著 Process Version 鎖定
- [x] 設定了自動核准的審批節點仍然必須指派審批人
- [x] DSL 檢查器新增規則：啟用自動核准卻沒有表達式、表達式有 JSONata 語法錯誤（Seam ②）
- [x] 流程走到節點時，在 activity 中用這一輪的 Form 資料判斷；workflow 內不執行 JSONata，activity 只回傳成立或不成立
- [x] 條件成立：不建立 Task，時間軸新增自動核准事件，進度條標成完成；不寄任何通知
- [x] 條件不成立，或執行時出錯：照常建立 Task 交給審批人（往安全的方向失敗）
- [x] 時間軸只顯示「符合條件，自動核准」，不露出表達式；發起前的流程預覽不標示可能自動核准
- [x] Return 後重新送出會重新判斷；先前的自動核准和人工核准一樣全部失效
- [x] Seam ①：條件成立時自動核准、不出現在審批人的待辦中；條件不成立時照常建立 Task；表達式執行出錯時照常建立 Task；Form 的值不出現在 Temporal history 中

## Comments

### 設計紀錄（2026-09-26，grilling）

- 用詞：`CONTEXT.md` 新增 **Auto-approval**（自動核准）；_Avoid_: Skip、bypass、免審。與「Escalation 絕不會自動核准」並存：只有條件能觸發，逾時永遠不會。
- 為什麼不直接用條件節點繞過審批節點：
  - 繞過的話，Request 裡看不出這一步存在。
  - 自動核准會留下紀錄，稽核時看得出是系統放行的。
- 不建立 Task：Task 的定義是「指派給人的待辦」，系統放行不是待辦。因此審批人「我處理過的」裡面不會出現自動核准的那一步。
- 不公開條件：表達式可能包含不該公開的門檻（例如主管免審的金額上限），公開了也可能讓人切割申請來規避審批。
- 實作方向（不需要另外決定）：
  - DSL：審批節點新增 `autoApprove: { expression } | null`，草稿中表達式可以是空白。
  - 檢查器：
    - 新增 `AUTO_APPROVAL_NO_EXPRESSION`。
    - 語法錯誤沿用 `INVALID_JSONATA`，錯誤標在節點上（沒有 `edgeId`）。
  - Worker：
    - 新增 activity（例如 `evaluateAutoApproval`），和 `evaluateCondition` 共用「讀取這一輪資料」的邏輯；執行時出錯要寫 log（不含 Form 資料）。
    - 條件成立時，在同一個 transaction 寫入 `request_events`（例如 `step.auto_approved`，帶 nodeId），並先確認 Request 仍是 running。
    - 審批節點新增的設定欄位不會出現在舊的 history 裡，所以不需要 `patched()`。沒有設定 `autoApprove` 的節點，行為要和原本完全一樣。
  - 合約與 Web：
    - 時間軸事件新增自動核准類型（帶節點名稱）。
    - 入口網站的進度條也要看這種事件。
    - Designer 屬性面板新增勾選框與表達式欄位，列出可用的欄位代碼。
    - 畫布節點上標出「條件成立時自動核准」。
- 不寫 ADR：以上決定之後改起來都不難。
