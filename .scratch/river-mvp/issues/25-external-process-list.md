# 25: 外部 API 列出可以發起的 Process

**What to build:** 外部系統可以透過外部 API 列出自己的 Service Account 被授權發起的 Process（帶 ID），並查詢單一 Process 目前版本的開始表單欄位定義，不必再向 Administrator 索取 Process ID 與欄位代碼。

**Blocked by:** 20（Service Account 與外部 API）

**Status:** resolved

- [x] `GET /api/external/processes`：只列出這個 Service Account 被授權發起的 Process，每筆有 `id`、`name`、`version`、`publishedAt`（目前 Process Version），依名稱排序、不分頁、不接受參數；不在授權範圍的 Process 不出現
- [x] `GET /api/external/processes/:id`：回傳 `{ id, name, version, publishedAt, startForm: { fields } | null }`；沒有開始表單時 `startForm` 為 null
- [x] 欄位使用獨立的外部合約（`packages/contracts`）：`key`、`label`、`type`、`required`、`help`、`rules`、`options`、明細表的 `columns`；不含內部的欄位 `id`
- [x] 沒有被授權或不存在的 Process 一律回 404（不透露有哪些 Process）
- [x] attachment 欄位照常列出，文件註明外部 API 無法填寫；person 欄位文件註明值是 Participant ID
- [x] Administrator 調整授權範圍後清單立刻反映；Designer 發佈新版本後回傳新的版本與開始表單
- [x] OpenAPI 文件包含這兩個 endpoint；用語一律是 Process，不用 workflow
- [x] Seam ①（`apps/api/test/service-account.test.ts`）涵蓋以上情況

## Comments

決定（2026-09-27，grilling）：

- 「workflow」即 glossary 的 Process；對外一律稱 Process。
- 清單只反映 Service Account 本身的授權範圍；和發起時一樣不考慮 `on_behalf_of` 與 Initiator Role。
- 清單保持輕量，欄位定義放在單筆 endpoint；帶版本號讓外部系統察覺開始表單可能變了。
- 外部合約與內部 `formSchema` 分開，內部結構調整不會破壞對外合約。
- 必填 attachment 欄位的 Process 無法透過外部 API 發起，Administrator 授權時不另外檢查（不在這次範圍）。
- person 欄位接受 email 另開 issue 26。

實作摘要（2026-09-27）：

- 合約（`packages/contracts`）：`externalProcessSchema`、`externalProcessDetailSchema`、`externalFormFieldSchema`（明細表的欄是 `externalTableColumnSchema`）。`type` 的說明註明 attachment 無法透過外部 API 填寫、person 的值是 Participant ID、table 的值格式。
- API：`ExternalProcessesController`／`ExternalProcessesService`（`apps/api/src/service-account/`），放在 `ExternalApiModule`，所以會自動出現在 OpenAPI 文件。以 `service_account_processes` inner join 各 Process 最新的 Process Version，一個查詢同時完成授權過濾與取得目前版本；單筆找不到時回 404，id 不是 UUID 時回 400。
- 測試：`service-account.test.ts` 新增 2 個 Seam ① 測試（清單與授權範圍立刻生效；開始表單欄位、無開始表單、新版本、404／400）；OpenAPI 測試加上兩個新路徑。
- 沒有 migration。
