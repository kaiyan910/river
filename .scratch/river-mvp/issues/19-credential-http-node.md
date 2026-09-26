# 19: Credential 與 HTTP 節點

**What to build:** 持有 credential.manage 的人可以建立與輪替 Credential，秘密存下之後就不會再顯示。Designer 可以在流程中加入 HTTP 節點：用 JSONata 從 Request 資料組成 body，並以名稱引用 Credential；秘密只在 activity 內解密。

**Blocked by:** 09（條件分支（JSONata））

**Status:** resolved

- [x] Credential 可以建立、輪替和刪除；秘密加密儲存，只能寫入，API 永遠不回傳秘密
- [x] 新增 http 節點：method、URL、JSONata body、Credential 名稱（選填）；DSL 中只存 Credential 名稱
- [x] `httpRequest` activity 在執行時才解密 Credential，並帶重試
- [x] 重試全部失敗時：Request 暫停，並通知 Administrator；Administrator 可以重試或 Cancel（spec 待決問題 #1 的建議預設）
- [x] Credential 輪替後，下一次呼叫就使用新的秘密，不需要重新發佈 Process
- [x] Seam ①：stub server 收到正確的 body 和認證 header；Temporal history 中找不到秘密

## Comments

實作摘要（2026-09-26）：

- 資料：
  - 新增 `credentials` 資料表（migration `0015_credentials`，完全由 drizzle-kit 產生）：名稱唯一、建立後不能改；`scheme` 是 `bearer`（`Authorization: Bearer <秘密>`）或 `header`（自訂 header 名稱，例如 `X-API-Key`）；記錄建立與最後輪替的人和時間。
  - 秘密以 AES-256-GCM（`node:crypto`）加密後存進 `secret`：金鑰來自新的環境變數 `CREDENTIAL_ENCRYPTION_KEY`（base64 的 32 bytes，api 與 worker 共用），每次加密用新的 12 bytes 隨機 IV，AAD 綁定 Credential ID（把密文複製到另一列也解不開），格式 `v1.<iv>.<tag>.<密文>` 保留換金鑰的空間。實作在 `packages/db/src/credential-cipher.ts`。
  - 事件新增 `step.http_sent`（呼叫成功）、`step.http_failed`（重試全部失敗、Request 暫停，comment 是失敗原因）、`request.retried`（Administrator 重試）。事件類型是 text 欄位，不需要 migration。
- DSL：新增 `http` 節點（method、URL、JSONata body、Credential 名稱，body 與 Credential 都選填），DSL 只存 Credential 名稱。檢查器新增 `HTTP_NO_URL`、`HTTP_INVALID_URL`（必須是 http/https 完整網址）、`HTTP_BODY_NOT_ALLOWED`（GET 不能帶 body），body 語法錯誤沿用 `INVALID_JSONATA`。`@river/dsl/branch` 新增 `evaluateHttpBody`。
- API：
  - `GET/POST /api/credentials`、`PUT /api/credentials/:id/secret`（輪替）、`DELETE /api/credentials/:id`，都需要 `credential.manage`；任何回應都不含秘密或密文。重複名稱回 409。
  - `GET /api/credentials/directory`（`process.edit`、`process.publish` 或 `credential.manage`）：Designer 挑選用，只有名稱與送出方式。
  - `POST /api/requests/:id/retry`（`request.cancel`）：Request 暫停時重試；先鎖住 Request、確認仍在暫停才寫 `request.retried`，提交後送 `retry` Signal（帶重試次數）。沒有暫停回 409。暫停中的 Request 用既有的 Cancel 結束。
  - Request 清單與明細新增 `paused`（步驟、原因、時間）；暫停由事件推導：Request 仍是 running，而且 `step.http_failed`／`request.retried`／`request.resubmitted` 中最後一筆是 `step.http_failed`。
- Worker：
  - `httpRequest` activity：輸入只有 ID，從 Postgres 讀取這一輪的 Form 資料組成 body，每次執行才讀取並解密 Credential（所以輪替後下一次呼叫就用新的秘密），沒有回傳值；錯誤訊息只有狀態碼或錯誤代碼，Temporal history 裡找不到秘密、body 或 Form 資料。不跟隨轉址，避免認證 header 被送到別的主機。
  - 重試：retry policy 5 秒起、倍數 2、最多 4 次；連線失敗、逾時、5xx、408、429 會重試，其他 4xx、找不到或解不開 Credential、body 算不出來直接失敗。
  - 全部失敗時 `pauseForHttp` 寫入 `step.http_failed` 並寄信給持有 `request.cancel` 的 Administrator（新的 `httpFailed` 通知，只有步驟名稱，連到 `/admin/reassign?id=<Request>`），回傳目前的重試次數；workflow 等到 sequence 更大的 `retry` Signal 再呼叫一次，或 Request 被 Cancel、Withdraw、Return 時停下來。
  - HTTP 節點與 `retry` Signal 都是新的，舊的 history 裡不會出現，依既有慣例不需要 `patched()`。
- Web：
  - 新的「Credential」頁（`/designer/credentials`，需要 `credential.manage`）：建立（名稱、送出方式、秘密）、輪替、刪除；秘密只能輸入，不會顯示。
  - 流程設計器新增 HTTP 節點：method、URL、JSONata body（列出可用的欄位代碼）、從 Credential 名錄挑選（已刪除的名稱會標示）。
  - 例外處理頁顯示暫停的步驟、原因與時間，持有 `request.cancel` 的人可以重試或 Cancel；入口網站顯示「已暫停」、時間軸與進度圖的 HTTP 步驟。
- 測試：
  - Seam ①：`apps/api/test/credential-http-node.test.ts` 12 個測試：Credential 的建立（API 不回傳秘密、資料庫只存密文）、驗證、權限、輪替與刪除；stub server 收到 JSONata 組成的 body 與 Bearer header，Temporal history 找不到秘密與 Form 資料；自訂 header 與不帶 Credential；輪替後下一次呼叫就用新的秘密；重試全部失敗後暫停、通知 Administrator、重試後完成；暫停中 Cancel；找不到 Credential 直接暫停、建立後重試成功；發佈前檢查。
  - DSL 單元測試：HTTP 節點的檢查與 `evaluateHttpBody`。
- spec 待決問題的處理：
  - #1（重試失敗後）：採用建議的預設，Request 暫停並通知 Administrator，Administrator 可以重試或 Cancel。暫停不是新的 Request 狀態：status 仍是 running（並行的其他分支照常進行），另外以 `paused` 表示。
  - #2（HTTP 回應寫回 Request 資料）：採用建議的預設，不做；HTTP 節點只看成功（2xx）或失敗。
- 已知限制：
  - HTTP 呼叫是「至少一次」：送出成功後、寫入事件前失敗的話，重試會重複送出；外部系統最好能冪等處理。
  - 刪除仍被引用的 Credential 不會擋下，也不會在發佈時檢查名稱是否存在（DSL 檢查是純函式）；執行時找不到會暫停 Request，重新建立同名的 Credential 後重試即可。
  - 更換 `CREDENTIAL_ENCRYPTION_KEY` 後既有的 Credential 都解不開，必須逐一輪替；還沒有多把金鑰並存的機制。
