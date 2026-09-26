# 20: Service Account 與外部 API

**What to build:** Administrator 可以建立 Service Account，限定它可以發起哪些 Process，並發放 API key。外部系統用這把 key 透過 API 發起 Request，可以用 `on_behalf_of` 代表某位 Participant；也可以查詢自己發起的 Request 的狀態。提供 OpenAPI 文件。

**Blocked by:** 08（指派給 Manager 與 Fallback Role）、13（可見範圍）

**Status:** resolved

- [x] Administrator 可以建立 Service Account、設定可發起的 Process、發放和輪替 API key；key 只存 hash，只在發放時顯示一次
- [x] 外部 API 用 Bearer key 驗證，只能發起授權範圍內的 Process
- [x] 帶 `on_behalf_of` 時，該 Participant 就是發起人，指派給 Manager 的節點使用他的 Manager
- [x] 沒有帶 `on_behalf_of` 時，發起人是 Service Account，指派給 Manager 的節點改走 Fallback Role
- [x] 外部系統可以查詢自己發起的 Request 的狀態
- [x] 用 @nestjs/swagger 產生外部 API 的 OpenAPI 文件
- [x] Seam ① 涵蓋以上所有情況

## Comments

實作摘要（2026-09-26）：

- 資料（migration `0014_service_accounts`，全部由 drizzle-kit 產生）：
  - `service_accounts`：名稱（唯一）、`api_key_hash`（SHA-256，唯一）、`api_key_prefix`（`river_sk_` 加 4 個字元，只給人辨識）、`api_key_issued_at`。key 是 256 bits 的隨機值，高熵，所以用 SHA-256 而不是慢速 hash，可以直接以 hash 查詢。
  - `service_account_processes`：可以發起的 Process，改了立刻生效。
  - `requests.initiator_id` 改為可以是 null，新增 `requests.service_account_id`；check constraint 要求兩者至少一個。帶 `on_behalf_of` 時兩者都有（發起人是 Participant，記下經由哪個 Service Account）；沒有帶時只有 `service_account_id`，發起人就是 Service Account。
  - `request_data.submitted_by` 改為可以是 null（Service Account 自己發起時的開始表單）。
- Permission：新增 `service_account.manage`，放進 Administrator 預設組合（Service Account 可以代表任何人發起，屬於敏感的管理權限）。
- API：
  - `GET/POST /api/service-accounts`、`PUT /api/service-accounts/:id/processes`、`POST /api/service-accounts/:id/api-key`（輪替）、`GET /api/service-accounts/process-options`（`service_account.manage`）。建立時就發放第一把 key；建立與輪替的回應帶明文 key，只出現這一次，清單只有前綴。只能授權發佈過的 Process（400），同名 409。
  - 外部 API `POST /api/external/requests`、`GET /api/external/requests`、`GET /api/external/requests/:id`：`@RequireServiceAccount()` 跳過 Better Auth 的全域 AuthGuard，改由 `ServiceAccountGuard` 驗證 `Authorization: Bearer <key>`。session cookie 不能呼叫外部 API，API key 也不能呼叫 UI API（都回 401）。
  - 發起：不在授權範圍（包括不存在的 Process）回 403；`on_behalf_of` 是 Participant 的 email（不分大小寫），找不到或已停用回 422；開始表單照樣驗證（422）。`RequestsService` 拆出 `currentVersion` 與 `launch`，平台與外部 API 共用同一段建立 Request、啟動 workflow 的程式。
  - 查詢：只查得到自己發起的 Request（其他一律 404）；回傳狀態、Process、發起人、目前在等的步驟名稱，不含 Form 資料與處理人。
  - OpenAPI：`SwaggerModule.createDocument(..., { include: [ExternalApiModule] })`，只涵蓋外部 API，Bearer 驗證方式 `serviceAccountKey`；Swagger UI 在 `/api/external/docs`、JSON 在 `/api/external/docs-json`，不需要登入。原本涵蓋全部路由的 `/api/docs` 移除（issue 01 留下的待決定事項：UI API 的合約是 `packages/contracts`，不公開成文件）。
  - Request 的 `initiator` 加上 `type`（`participant` / `service_account`），並新增 `serviceAccount`（經由哪個 Service Account 發起，平台上發起的為 null）。Service Account 自己發起時，時間軸的 `request.started` 與開始表單的 `submittedBy` 顯示為該 Service Account。
- Worker：發起人為 null（Service Account）時，指派給 Manager 的步驟改派給 Fallback Role（`no_manager`）；通知發起人、Email 節點寄給發起人或 Manager 都沒有收件人。不影響 workflow 的指令，不需要 `patched()`。
- Web：
  - `/admin/service-accounts`：建立、勾選可以發起的 Process、輪替 API key（二次確認）；建立或輪替後在畫面上顯示一次明文 key（可複製），換頁就消失；連到外部 API 文件。
  - 入口網站：Service Account 發起的 Request 以機器人圖示與「名稱（Service Account）」顯示；代表 Participant 發起的顯示「姓名（經由 Service Account 名稱）」。
- 附件（issue 18）：外部 API 不能引用附件，包括帶 `on_behalf_of` 時（附件只能由登入的 Participant 自己上傳後引用，Service Account 不能綁走他人還沒送出的附件）；附件欄位帶任何附件都回 422「找不到附件」。`AttachmentsService.resolve` 的 `submitterId` 與 `bindAttachments` 的 `submittedBy` 改為可以是 null。
- 測試：`apps/api/test/service-account.test.ts` 11 個 Seam ① 測試，涵蓋 Permission、建立與授權範圍、key 只存 hash 與只顯示一次、Bearer 驗證與兩種驗證互不相通、授權範圍立刻生效、輪替後舊 key 失效、`on_behalf_of`（Manager、我的申請、開始表單驗證、無效的 Participant）、沒有 `on_behalf_of`（Fallback Role、時間軸）、只查得到自己發起的 Request、外部 API 不能引用附件、OpenAPI 文件只含外部 API。
- 已知限制與待決定：
  - `on_behalf_of` 用 email 指定 Participant（外部系統通常沒有 River 的 Participant ID），spec 沒有規定格式。
  - 帶 `on_behalf_of` 時不檢查該 Participant 是否在 Initiator Role 裡：授權範圍由 Administrator 設定在 Service Account 上（例如 HR 系統替還不在任何 Role 的新人發起）。
  - Service Account 自己發起的 Request 被 Return 後沒有人能重新送出或 Withdraw（外部 API 沒有這兩個操作），會停在 returned，外部系統查得到這個狀態；需要時由 Administrator Cancel。
  - 沒有停用或刪除 Service Account 的功能；要讓外部系統停止呼叫時，輪替 key 並清空授權範圍。
