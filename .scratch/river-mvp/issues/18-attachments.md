# 18: 附件欄位

**What to build:** Form 新增附件欄位，Participant 可以上傳收據、報價單等檔案。檔案透過 presigned URL 直接上傳到 S3 相容的 Garage；只有看得到該 Request 的人可以下載。

**Blocked by:** 05（表單設計器與開始表單）

**Status:** resolved

- [x] 附件欄位可以設定允許的檔案類型、大小上限和數量
- [x] API 發出 presigned 上傳 URL，瀏覽器直接上傳到 Garage；attachments 資料表記錄檔案的中繼資料
- [x] 下載時同樣使用 presigned URL，並先檢查請求者看不看得到該 Request
- [x] 附件內容與下載 URL 都不會進入 Temporal（Seam ①）

## Comments

實作摘要（2026-09-26）：

- Form：新增欄位類型 `attachment`（`packages/forms/src/attachment.ts`）。規則 `accept`（副檔名清單，例如 `.pdf`）、`maxSizeMb`（系統上限 50 MB）、`maxFiles`（系統上限 20）。欄位值是附件的中繼資料清單 `{ id, name, size, contentType }`；formToZod 檢查必填、數量、類型與大小，瀏覽器與 API 共用。發佈前檢查新增 `FIELD_BAD_ACCEPT`（副檔名格式不正確）。
- 資料：新增 `attachments` 資料表（migration `0013_attachments`）：storage key、檔名、類型、大小、上傳者、所屬 Request（還沒隨表單送出時為 null）、確認已上傳的時間。
- API：
  - `POST /api/attachments`：登記檔名、類型、大小（≤ 系統上限），回傳 presigned PUT URL（15 分鐘；Content-Type 與 Content-Length 簽進 URL，上傳別的大小會被 object storage 拒絕）。瀏覽器直接上傳到 Garage，不經過 API。
  - 送出表單（發起、重新送出、完成填表 Task）時，附件欄位的值換成資料庫裡的中繼資料（瀏覽器送來的檔名、大小不算數），只接受自己上傳且還沒送出的附件、或已經屬於這筆 Request 的附件（重新送出時沿用）；還沒確認的附件以 HEAD 確認已上傳且大小相符，之後才依 Form 驗證。存下資料時在同一個 transaction 把附件綁到 Request。
  - `GET /api/attachments/:id/download`：看得到附件所屬 Request 的人（和 Request 明細同一個 `visibleTo` 條件）才拿得到 5 分鐘的 presigned GET URL（帶 Content-Disposition 與原檔名）；還沒送出的附件只有上傳的人拿得到；其他人一律 404。
  - object storage 放在 `AttachmentStorage` 介面後面，實作是 `S3AttachmentStorage`（`@aws-sdk/client-s3`，path-style）。新的環境變數 `S3_ENDPOINT`、`S3_PUBLIC_ENDPOINT`（選填，瀏覽器看到的網址）、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`。
  - `bun run setup:storage` 設定 bucket 的 CORS（允許 `BETTER_AUTH_URL` 與 trusted origins 的 PUT、GET）；Garage 的 key 與 bucket 建立步驟寫在 `deploy/README.md`。
- Temporal：workflow 的輸入與 Signal 不變，只有 ID 與決策結果；Form 資料裡只有附件的中繼資料，而且只在 Postgres。
- Web：表單設計器的附件欄位設定（允許的類型、大小上限、數量）；填寫時選檔先在瀏覽器檢查再逐一上傳，可以移除；唯讀顯示時點檔名下載。設計器的即時預覽不會真的上傳。
- 測試：Seam ① 用 Testcontainers 啟動真實的 Garage（和正式環境同一套），走完登記 → presigned 上傳 → 送出 → presigned 下載的完整路徑；涵蓋欄位設定與發佈檢查、填表 Task 的附件、下載權限、類型／大小／數量不符、還沒上傳或大小不符、別人的或已屬於其他 Request 的附件、Return 後沿用附件，以及安全測試（檔案內容、檔名、下載 URL 與簽章、附件 ID 都不在 Temporal history 的任何 payload 中）。

尚未處理：登記後一直沒有送出的附件（孤兒 object）目前不會自動清除，之後可以用排程依 `request_id is null` 與 `created_at` 清理。

