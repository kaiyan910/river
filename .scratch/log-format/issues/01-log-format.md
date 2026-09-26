# 01: Log 格式可切換（JSON／人類可讀）

**What to build:** API 與 worker 的 log 可以用 `.env` 的 `LOG_FORMAT` 切換成 JSON 或人類可讀（pretty）格式。本機開發看 pretty，production 維持 JSON 給 log 收集工具解析。

**Blocked by:** 無

**Status:** resolved

- [x] 新增 `packages/logger`（`@river/logger`），寫法比照 `@river/email`：匯出 `loggerEnvSchema` 與建立 pino options 的函式
- [x] `LOG_FORMAT=json|pretty`（zod enum），未設定時預設 `json`；`.env.example` 寫 `pretty`
- [x] `LOG_LEVEL` 改成 enum 驗證（`trace`、`debug`、`info`、`warn`、`error`、`fatal`、`silent`），預設 `info`，和 `LOG_FORMAT` 一起放在 `loggerEnvSchema`
- [x] API：`LoggerModule.forRoot` 改用共用的 options
- [x] Worker：讀取 `LOG_LEVEL`／`LOG_FORMAT`；用 `Runtime.install` 把 Temporal SDK 的 log 導進同一個 pino
- [x] pretty 外觀：本機時間 `HH:MM:ss.l`、有顏色、隱藏 pid／hostname、每行前標出 `[api]`／`[worker]`、error stack 多行展開
- [x] pretty 模式的 HTTP request log 精簡成一行（例如 `GET /api/requests 200 12ms`）；JSON 模式保留完整 req/res
- [x] `pino-pretty` 裝成 dependency（production 設成 pretty 也能啟動）
- [x] 不動：測試 harness（已是 `silent`）、`deploy/compose.yaml`（不負責啟動 api／worker）

## Comments

### 設計紀錄（2026-09-26，grilling）

- 維運設定，沒有新的 domain 用語，不更新 `CONTEXT.md`。
- 不寫 ADR：之後換格式或換套件都不難。
- 預設 `json`：production 或 CI 忘了設定時，仍輸出 log 收集工具看得懂的格式。

### 實作紀錄（2026-09-26）

- pretty 模式用 pino-pretty 的同步 stream，不用 transport：transport 跑在 worker thread，無法傳入自訂格式的函式。
- 時間與等級也由 `messageFormat` 排版，因為 pino-pretty 會在訊息前硬加一個冒號。
- HTTP 訊息（`GET /api/x 200 12ms`）在兩種格式都會使用；JSON 模式另外保留完整的 req/res。
- Worker 啟動時，Temporal 會把整段 webpack bundle 統計資料當成一則 INFO 訊息印出，這是原本就有的行為，這次沒有處理。
