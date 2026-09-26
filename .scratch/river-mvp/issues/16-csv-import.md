# 16: CSV 匯入

**What to build:** Administrator 可以用 CSV 一次匯入全公司的 Participant，包括每個人的 Manager；匯入後會列出失敗的行和原因。

**Blocked by:** 08（指派給 Manager 與 Fallback Role）

**Status:** resolved

- [x] CSV 欄位包括姓名、email、Manager 的 email；同一份檔案中的 Manager 參照可以互相對應，與行的順序無關
- [x] 成功匯入的人都會收到邀請信
- [x] 以下情況會列出行號和原因：重複的 email、Manager 不存在、Manager 關係形成循環、格式錯誤
- [x] 有錯誤的行不會匯入，其他正確的行照常匯入（Seam ①）

## Comments

實作摘要（2026-09-26）：

- API：
  - `POST /api/participants/import`（`user.manage`）：body 是 `{ csv }`（整份檔案的文字），回傳 `imported`（行號、participantId、Manager、邀請信是否寄出）與 `failed`（行號、email、`code`、說明）。沒有 DB schema 變動，不需要 migration。
  - 第一行是標題列，欄位順序不限；可用 `姓名`／`name`、`email`、`Manager 的 email`／`manager_email`／`manager`（比對時忽略大小寫、空白、底線、連字號與「的」）。缺少姓名或 email 欄位、標題列本身格式錯誤時回 400，不匯入任何人；Manager 欄位可以省略。
  - CSV 解析（`apps/api/src/org/csv.ts`）依 RFC 4180：引號內可以有逗號與換行、`""` 跳脫、CRLF／LF／CR、略過 Excel 的 BOM 與空白行。行號是記錄開始的實際行號（標題列是第 1 行）。
  - Manager 的 email 可以指向同一份檔案中的另一行（與順序無關），也可以是現有的 Participant；email 一律轉小寫比對。建立帳號時依「Manager 先建立」的順序，所以 Manager 參照直接寫入。
  - 失敗原因：`invalid_format`（欄位數與標題列不同、姓名空白或超過 100 字、email 或 Manager email 格式錯誤、引號錯誤）、`duplicate_email`（檔案中重複，所有重複的行都不匯入，說明中列出另外幾行）、`email_taken`（已經有帳號）、`manager_not_found`、`manager_deactivated`、`manager_cycle`（包括自己當自己的 Manager；循環上的每一行都列出）、`manager_failed`（Manager 那一行沒有匯入，例如接在循環或重複 email 下面）、`create_failed`（建立帳號時的例外，例如同時有人建立同一個 email）。
  - 匯入的人沒有任何 Permission，每人寄一封邀請信（沿用 `InvitationsService`）；寄信失敗不回滾，`invitationSent: false`，之後可以在人員詳情重寄。
  - body parser 的 JSON 上限從預設 100kb 提高到 2mb（`AuthModule.forRoot` 的 `bodyParser`），CSV 本身在 contract 限制 1,000,000 字。
- Web：人員頁新增「匯入 CSV」（`/admin/participants?id=import`）：說明欄位與範本、下載範本、選擇檔案、匯入後顯示成功人數、失敗的行（行號、email、原因）與匯入的人（點名字開啟詳情），邀請信寄送失敗時提示重寄。
- 測試：Seam ① `apps/api/test/csv-import.test.ts` 6 個測試，涵蓋 Manager 參照順序無關與現有 Participant、邀請信與設定密碼、所有失敗原因的行號與說明、錯誤行不匯入而其他行照常匯入、引號沒有結束、BOM／欄位順序／空白行／跨行欄位、標題列缺欄位回 400、沒有 `user.manage` 回 403。
- 實作時的決定（spec 沒有規定）：
  - 檔案中重複的 email，所有重複的行都不匯入（無法判斷哪一行才對）。
  - Manager 那一行沒有匯入時，指向它的行也不匯入（`manager_failed`），而不是匯入但不設定 Manager，避免 Manager 關係悄悄遺失。
  - 匯入是逐行建立帳號，不是單一 transaction：已經建立的人不會因為後面某一行建立失敗而回滾，失敗的行照樣列出。
