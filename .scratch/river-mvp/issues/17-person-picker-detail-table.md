# 17: 人員選擇器與明細表欄位

**What to build:** Form 新增兩種進階欄位：人員選擇器（例如選擇「專案負責人」）和明細表（例如報銷單的多行項目，每一行有自己的欄位）。JSONata 表達式可以讀取這兩種欄位的值，例如加總明細表的金額。

**Blocked by:** 05（表單設計器與開始表單）

**Status:** resolved

- [x] 人員選擇器欄位：可以搜尋啟用中的 Participant，存下 Participant ID，並以唯讀方式顯示姓名
- [x] 明細表欄位：Designer 定義表中的欄位；Participant 可以新增或刪除行（使用 TanStack Form 的 array field）；每一行分別驗證
- [x] JSONata 可以讀取兩種欄位的值（Seam ①：用明細表金額的加總決定分支）

## Comments

實作摘要（2026-09-26）：

- Forms（`packages/forms`）：
  - 新增兩種欄位類型：`person`（人員選擇器）與 `table`（明細表）。明細表的欄定義在 `columns`，欄的類型是 `TABLE_COLUMN_TYPES`（除了明細表以外的基本欄位與人員選擇器，不能巢狀）；最多 20 欄、100 行。
  - `formToZod`：人員選擇器存下 Participant ID（UUID，轉成小寫），不是 UUID 時回報「不是有效的人員」；明細表是每一行一個物件的陣列，每一行依欄的定義分別驗證（沒送的欄補成 null、沒有定義的鍵丟掉），必填時至少要有一行。
  - 驗證錯誤的鍵：一般欄位是欄位代碼；明細表裡的一格是 `items[1].amount`（和 TanStack Form 的欄位名稱寫法相同，行數從 0 開始），由 `fieldPath` 組出。
  - `checkForm`：明細表沒有欄位時回報 `FIELD_NO_COLUMNS`；明細表的欄和一般欄位一樣檢查名稱、代碼、選項、範圍與格式，錯誤的 `fieldId` 是那一欄的 ID，代碼只需要在同一張明細表裡不重複。
  - `personRefs(form, data)`：列出資料裡人員選擇器（包括明細表每一行）選到的 Participant ID 與它的錯誤鍵。
- API：
  - `GET /api/participants/search?q=`：任何有效的 Participant 都可以依姓名或 email（不分大小寫、部分符合）搜尋沒有停用的人，最多 20 位，只回傳 id、姓名、email。
  - 發起、重新送出與填表 Task 的資料除了 formToZod，還要檢查人員選擇器選到的人存在且沒有停用；不符時 422，錯誤標在那一格（「找不到這個人，或帳號已停用」）。這一項要查資料庫，所以不在共用的 formToZod 裡，瀏覽器端不會事先擋下。
  - Request 明細的每一步資料新增 `people`：這一步選到的人的 id 與姓名，唯讀顯示用（已停用的人也查得到姓名）。
- JSONata：資料照原樣存進 request_data，evaluateCondition／Auto-approval 不需要修改。人員選擇器的值是 Participant ID（例如 `owner = "<id>"`），明細表是物件陣列（例如 `$sum(items.amount) > 10000`、`$count(items)`）。
- Web：
  - 表單設計器新增兩種欄位；明細表展開後可以新增、刪除欄，設定每一欄的類型、名稱、代碼、必填，並再展開設定該欄的規則。即時預覽的「驗證規則」列出每一欄，條件分支的「可用的欄位代碼」列出 `items.amount` 這類路徑。
  - 填寫：人員選擇器搜尋 API、選到後以唯讀方式顯示頭像與姓名，可以清除重選；明細表用 TanStack Form 的 array field（`mode="array"`、`pushValue`、`removeValue`），每一格各自顯示錯誤（包括 API 回傳的 `items[1].amount`）。
  - 唯讀顯示：人員顯示姓名；明細表顯示成表格。重新送出時以明細的 `people` 預先顯示已選的人。
- 測試：
  - 單元測試：`packages/forms` 的驗證、檢查與 `personRefs`。
  - Seam ①：`apps/api/test/person-picker-detail-table.test.ts` 9 個測試，涵蓋搜尋（只列出沒有停用的人）、存下 ID 並在明細帶出姓名、選到已停用或不存在的人時 422、明細表每一行分別驗證、必填至少一行、沒有欄位時不能發佈，以及 JSONata 以明細金額加總與人員 ID 決定分支。
- 已知限制與待決定：
  - 「啟用中的 Participant」解讀為「沒有停用」：邀請中（還沒設定密碼）的人也可以被選，和 Designer 指派審批人時的挑選方式一致。
  - 明細表沒有提供「最少幾行、最多幾行」的規則，只有必填（至少一行）與固定上限 100 行；需要時再加。
  - 選到的人在送出之後才停用，資料照樣保留、唯讀仍顯示姓名；重新送出時會被擋下，要改選別人。

