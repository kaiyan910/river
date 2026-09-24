# 03: Designer 發佈最小的 Process

**What to build:** Designer 可以在 React Flow 畫布上建立一個 Process 草稿：start → 審批節點（指派給特定 Participant）→ end。畫布會即時顯示 DSL 檢查錯誤；只有通過檢查的草稿才能發佈成 Process Version。這張 ticket 會建立 DSL package（型別、Zod schema、畫布與 DSL 的轉換、檢查器）。

**Blocked by:** 01（Walking skeleton）

**Status:** resolved

- [x] 持有 process.edit 的人可以建立 Process 草稿，在畫布上新增 start、approval、end 節點並連線，草稿可以儲存
- [x] 審批節點可以選擇指派給一位特定 Participant
- [x] DSL 檢查器是純函式，輸出包含節點 ID、錯誤代碼和訊息的錯誤清單；目前檢查：沒有 start 或 end、到不了的節點、懸空的邊、審批節點沒有指派對象（Seam ② 測試）
- [x] 畫布上即時標示有錯誤的節點
- [x] 持有 process.publish 的人可以發佈；API 使用同一個檢查器，檢查不通過時拒絕發佈並回傳相同的錯誤
- [x] 發佈後產生一個不可修改的 Process Version，並成為該 Process 的目前版本

## Comments

**2026-09-24 · Prototype：流程設計頁版面**

- 原型：branch `prototype/issue-03-process-designer`（commit `2dcc0a2`），掛在 `/designer/processes`，用 `?variant=A|B|C` 切換；資料是記憶體假資料，檢查器是示意版。
- 問題：Process 清單、設計器畫布、發佈確認與版本檢視應該長什麼樣子？
- 已決定：採用 A「IDE」，沿用「控制台」的兩欄版面。
  - 左欄：Process 清單（搜尋；列上顯示狀態點：尚未發佈／已發佈／有未發佈的草稿、草稿儲存時間、目前版本 `vN`）。上方「新增 Process」展開表單，輸入名稱後建立只有「開始」「結束」的草稿。
  - 右欄上方：名稱可以直接改；版本分頁「草稿｜vN｜…」，已發佈版本加鎖頭、目前版本標「目前」；動作有「捨棄草稿」（已經發佈過才有）、「儲存草稿」（手動，有未儲存變更時才能按）、「發佈」（有錯誤時停用，按鈕上顯示錯誤數）。
  - 畫布：左上浮動節點面板（開始／審批／結束，拖到畫布上）；從節點下方的 handle 拉線；Backspace／Delete 刪除。有錯誤的節點顯示紅框與右上角的錯誤數。
  - 選取節點時右側顯示屬性面板：名稱、審批人（PersonPicker 選特定 Participant，選好後顯示姓名與「更換」）、這個節點的錯誤、刪除節點。
  - 底部可收合的「問題」面板：逐列顯示錯誤代碼、節點 ID、訊息；點一列會選取並置中該節點。沒有錯誤時顯示「沒有問題，可以發佈」。
  - 發佈對話框：目前版本與這次發佈的摘要（節點／審批／連線數）、檢查結果、選填的版本說明、「發佈後 vN 不能再修改」提示；API 拒絕時在對話框內列出錯誤。成功後顯示「已發佈 vN」，說明之後發起的 Request 用新版本、進行中的 Request 繼續用原本的版本。
  - 已發佈版本分頁：唯讀畫布，上方顯示「Process Version N 不可修改 · 發佈者 · 時間 · 說明」。
- 不採用：B（表格清單 + 全畫面編輯器、節點上直接編輯、自動儲存、發佈抽屜）、C（線性建構器：自動排版、連線上按「+」插入；之後的條件分支和平行節點放不進去）。
- 實作時要處理：
  - 選審批人需要 Designer 讀得到的人員清單；目前 `GET /api/participants` 只開放給 `user.manage`、`role.manage`。
  - 原型路由沒有檢查 `process.edit`；正式版要用 `<Guarded>`。

**2026-09-25 · 實作結果**

- DSL：`packages/dsl` 有 schema（start、approval、end；審批的指派對象目前只有特定 Participant）、`toCanvas`／`fromCanvas`、`checkProcess`。檢查項目除了 ticket 列的四項，另外加了 `NODE_NO_NAME`：節點名稱在草稿中可以空白，發佈前擋下。
- API：`/api/processes`（清單、建立、改名、`PUT …/draft` 儲存、`DELETE …/draft` 捨棄、`POST …/versions` 發佈）。查看需要 `process.edit` 或 `process.publish`；編輯需要 `process.edit`；發佈需要 `process.publish`，發佈的是**已儲存**的草稿，沒通過檢查時回 422 `{ message, errors }`。Process 名稱不能重複。
- 人員名錄：新增 `GET /api/participants/directory`（id、姓名、email、狀態），開放給 `process.edit`、`process.publish`、`user.manage`、`role.manage`。
- 待之後處理：
  - 流程設計頁仍然只給 `process.edit`，只有 `process.publish` 的人目前只能透過 API 發佈。
  - 審批人是否存在、是否已停用，檢查器與 API 都沒有檢查（畫面上會標示「已停用」）。
  - 如果另一位 Designer 在發佈對話框開著時改了草稿，發佈的會是伺服器上的最新草稿。
