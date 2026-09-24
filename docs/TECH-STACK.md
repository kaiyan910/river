# River Tech Stack

本文件記錄 River 的技術選型與架構約束。領域用詞（Process、Request、Task、Role、Permission 等）以 [`CONTEXT.md`](../CONTEXT.md) 為準。

## 總覽

全 TypeScript monorepo，部署在自有 VM 上，用 Docker Compose 執行。Temporal 負責流程執行，Postgres 是業務資料的唯一依據。

```
                    ┌──────────────── Caddy（同一個網域，TLS）────────────────┐
                    │   /            → web（靜態 SPA）                        │
                    │   /api/*       → api                                    │
                    └───────────┬─────────────────────────────────────────────┘
                                │
   ┌──────────────┐     ┌───────▼───────┐   Signal / Start    ┌──────────────┐
   │ web (SPA)    │────▶│ api (NestJS)  │───────────────────▶│ Temporal     │
   │ React Flow   │     │ Better Auth   │                     │ Server       │
   │ 表單設計器    │     └───┬───────┬───┘                     └──────┬───────┘
   └──────────────┘         │       │                                │ poll
                            │       │ presigned URL           ┌──────▼───────┐
                     ┌──────▼──┐  ┌─▼──────────┐              │ worker       │
                     │ Postgres│◀─┤ S3 相容     │              │ interpreter  │
                     │ (app)   │  │ (Garage)   │              │ + activities │
                     └────▲────┘  └────────────┘              └──────┬───────┘
                          └───────────────── activities 讀寫 ─────────┘
```

| 層級 | 選型 |
|---|---|
| 語言 / Runtime | TypeScript（strict）· Node.js 24 LTS（Bun 只用作 package manager，不用作 runtime） |
| Monorepo | Bun workspaces + Turborepo |
| 前端 | Vite · React · TanStack Router · TanStack Query · shadcn/ui（Tailwind） |
| 流程畫布 | `@xyflow/react`（React Flow） |
| 表單設計器 | 自建，基於 dnd-kit + 自訂 form schema |
| 表單執行 | TanStack Form + Zod（由 form schema 產生，透過 Standard Schema 直接接上） |
| API | NestJS v12 · `nestjs-zod` · `@nestjs/swagger`（OpenAPI） |
| 認證 | Better Auth（email 密碼、DB session、TOTP） |
| 執行引擎 | Temporal（self-host）· Temporal TypeScript SDK |
| 表達式 | JSONata |
| 資料庫 | PostgreSQL 17 或以上 · Drizzle ORM · Drizzle Kit migrations |
| 物件儲存 | S3 相容（Garage）· `@aws-sdk/client-s3` |
| Email | Resend（`resend` SDK）· React Email 範本 · 開發時用 Mailpit |
| 反向代理 | Caddy |
| 測試 | Vitest · Temporal `TestWorkflowEnvironment` 與 replay 測試 · Playwright |
| Logging | pino（API 用 `nestjs-pino`）· worker 使用同一套 logger |

## Monorepo 結構

```
river/
├─ apps/
│  ├─ web/          # Vite React SPA：Designer 工作區、Participant 入口、Administrator 後台
│  ├─ api/          # NestJS：UI 用的 REST API + Service Account 用的外部 API
│  └─ worker/       # Temporal worker：interpreter workflow + activities
├─ packages/
│  ├─ dsl/          # Process DSL 型別、Zod schema、發佈前檢查（web / api / worker 共用）
│  ├─ forms/        # Form schema、Zod 產生器、渲染元件
│  ├─ contracts/    # API request/response 的 Zod schema（web 與 api 共用）
│  ├─ db/           # Drizzle schema、migrations、repository
│  ├─ auth/         # Permission 清單、預設組合、授權檢查
│  ├─ email/        # EmailSender（SMTP / Resend）、React Email 範本（api 與 worker 共用）
│  └─ config/       # tsconfig / lint 共用設定
├─ deploy/
│  └─ compose.yaml
├─ CONTEXT.md
└─ docs/
```

依賴方向：`apps/*` → `packages/*`；`packages/dsl` 和 `packages/forms` 不依賴任何 app，也不依賴 `db`。

## 前端（apps/web）

- **SPA，不做 SSR**：內部工具不需要 SEO，畫布和表單設計器都是重互動的 client UI。
- **三個區域，同一個 app**：Designer 工作區（畫布、表單設計器、Credential）、Participant 入口（發起、我的待辦、我的申請、Request 歷程）、Administrator 後台（人員、Role、Manager、CSV 匯入、待 Reassign 清單）。依 Permission 決定顯示哪些路由。
- **流程畫布**：React Flow 只負責畫面。畫布狀態和 DSL 之間的轉換放在 `packages/dsl`，發佈前檢查也在那裡，所以前端即時顯示的錯誤和 API 拒絕發佈的理由一定一致。
- **表單**：設計器產生 form schema，渲染端從同一份 schema 產生 Zod，再經由 Standard Schema 交給 TanStack Form 驗證；明細表用 TanStack Form 的 array field 實作。欄位類型約 10–12 種，包括人員選擇器、附件、金額、明細表。

## API（apps/api）

- **NestJS v12 + nestjs-zod**：DTO 由 `packages/contracts` 的 Zod schema 產生（`createZodDto`），並以全域 `ZodValidationPipe` 驗證；`@nestjs/swagger` 產生 OpenAPI 給 Service Account 的外部整合使用。Contracts 仍然是純 Zod，前端不需要依賴任何 NestJS 的東西。
- **模組劃分**：大致依領域切成 `ProcessModule`、`RequestModule`、`TaskModule`、`OrgModule`（Participant、Role、Manager）、`CredentialModule`、`AuthModule`，外加一個包裝 Temporal client 的 `TemporalModule`。
- **HTTP adapter**：使用預設的 Express adapter，與 Better Auth 的 NestJS 整合相容性最好。Better Auth 的路由需要讀取原始 request body，所以要把它掛在 Nest 全域 body parser 之前。
- **兩類呼叫者**：
  - 瀏覽器：Better Auth 的 session cookie。
  - Service Account：`Authorization: Bearer <api key>`，只能發起被授權的 Process，可以帶 `on_behalf_of`。
- **授權檢查**：以 `@RequirePermission(...)` decorator 實作，只檢查 Permission（清單定義在 `packages/auth`），不檢查 Designer 或 Administrator 這類組合名稱；列出多個 Permission 時持有任一個即可。decorator 掛上方法層級的 `PermissionGuard`，所以一定在 Better Auth 的全域 AuthGuard 之後執行。Service Account 的 API key 驗證用另一個 Guard 處理。資料層級的存取（Initiator Role、Observer Role、Task 指派對象）在 repository 層檢查。
- **附件**：API 發出 presigned URL，瀏覽器直接上傳到 S3，不經過 API 轉送。

## 執行引擎（apps/worker + Temporal）

Worker 是一般的 Node.js 程式，不使用 NestJS。Temporal 的 workflow sandbox 與 Nest 的 DI 容器無法搭配，activities 直接使用 `packages/db` 等共用 package。

### 模型

- **每筆 Request 對應一個 Temporal workflow**，workflow ID 等於 Request ID。
- **只有一個通用的 interpreter workflow**：輸入是 `requestId` 與 `processVersionId`，讀取 Process Version 的 DSL 後逐一走過節點。Designer 發佈新版本時不需要部署任何程式碼。
- **Signals**：`taskCompleted`（核准 / Return / 填表完成）、`withdraw`、`cancel`、`reassign`。
- **Activities**：`createTask`、`evaluateCondition`、`sendEmail`、`httpRequest`、`sendReminder`、`escalateTask`、`completeRequest`。
- **Timers**：Reminder 和 Escalation 用 workflow 內的 durable timer 實作。
- **排程發起**：用 Temporal Schedule。
- **Return**：依規則從 Process 的開頭重新執行；Return 次數多時用 `continueAsNew`，避免 history 過大。

### 必須遵守的約束

1. **表單資料不進 Temporal**。Request 的表單資料只存在 Postgres。workflow 的 input、Signal 和 activity 回傳值只帶 ID 與決策結果（例如「走分支 B」、「核准」），不帶表單內容。這樣 Temporal history 和 Temporal UI 都不會出現薪資這類敏感資料。
2. **JSONata 只在 activity 中執行**。`evaluateCondition` 從 Postgres 讀取資料後計算，只回傳結果。因此表達式裡用到 `$now()` 等函式也不會破壞 determinism。
3. **通知信不含表單內容**。Resend 是外部服務，信件只放 Request 標題、Process 名稱，以及回到平台的連結，敏感資料一律要登入平台才看得到。Resend 的 API key 放在 api（Better Auth 的邀請信、重設密碼信）與 worker（流程通知）的環境變數，不是 Designer 管理的 Credential。
4. **Credential 只在 activity 內解密**。DSL 只存 Credential 名稱，秘密不會進入 Process Version 或 Temporal history；輪替 key 也不需要重新發佈 Process。
5. **Interpreter 的程式碼要做版本管理**。Request 可能持續數週，修改 workflow 程式碼時必須搭配 Worker Versioning 或 `patched()`。CI 必須對保存下來的 history 樣本執行 replay 測試。
6. **Process Version 的版本管理與 interpreter 的版本管理是兩回事**：前者是資料（DSL），後者是程式碼。

### Task 的一致性

- **Postgres 是 Task 收件匣的依據**：`createTask` activity 寫入 Task，UI 只從 Postgres 讀取。
- **先送出者勝出**：API 以樂觀鎖更新 Task（`WHERE status = 'open' AND version = ?`）。更新成功後才送出 `taskCompleted` Signal，後送出的人會收到「已由 X 處理」。
- **Signal 必須是冪等的**：Signal 帶 `taskId`，workflow 忽略重複或已經過時的 Signal，所以 API 可以安全重試。

## 資料（Postgres）

- **應用程式與 Temporal 分開**：`river`（應用程式）與 `temporal`、`temporal_visibility`（Temporal 的持久層與 visibility；兩者的 `schema_version` 資料表會衝突，所以各用一個 database）。可以放在同一個 Postgres instance，但 `river` 不能與 Temporal 共用 database。
- **Drizzle ORM + Drizzle Kit** 負責 schema 與 migrations。
- **主要資料表**：participants、roles、role_members、permission_grants、service_accounts、processes、process_versions（DSL 與 Form 的 JSONB 快照，不可修改）、requests、request_data（表單資料）、tasks、request_events（稽核歷程，只能新增）、credentials（加密儲存）、attachments（S3 object 的中繼資料）。
- **稽核**：所有狀態變化都會寫入 `request_events`，Request 歷程時間軸直接讀這張表，不查詢 Temporal。
- **Participant 只停用不刪除**，所以外鍵不會斷掉，歷程也永遠可以追溯。

## 認證與權限

| 項目 | 做法 |
|---|---|
| 登入 | Better Auth，email + 密碼 |
| Session | 存在 Postgres，用 httpOnly、Secure、SameSite=Lax 的 cookie；因為同一個網域，所以沒有 CORS 問題 |
| 帳號建立 | Administrator 建立或用 CSV 匯入（包含 Manager 欄位），員工收到邀請信後自行設定密碼 |
| MFA | 持有 `credential.manage`、`user.manage` 或 `process.publish` 的人必須啟用 TOTP，其他人可自行選擇 |
| Permission | `process.edit`、`process.publish`、`credential.manage`、`user.manage`、`role.manage`、`request.cancel`、`task.reassign`、`request.view_all` |
| 預設組合 | Designer = edit + publish；Administrator = user/role.manage + cancel + reassign + view_all；`credential.manage` 要單獨授予 |
| Service Account | 每個帳號有一把可輪替的 API key（只存 hash），並限定可發起的 Process |
| 停用帳號 | Session 立即失效；直接指派給該帳號的 Task 會進入「待 Reassign」清單 |

## 部署

在單一 VM 上用 Docker Compose 部署：

| Service | 說明 |
|---|---|
| `caddy` | TLS、反向代理；把 `/` 和 `/api` 放在同一個網域 |
| `web` | 靜態建置檔（可以直接由 Caddy 提供） |
| `api` | NestJS |
| `worker` | Temporal worker，可以開多個副本 |
| `temporal` | Temporal server（auto-setup 映像檔，持久層用 Postgres） |
| `temporal-ui` | 只開放給內網或 VPN |
| `postgres` | `river`、`temporal`、`temporal_visibility` 三個 database |
| `garage` | S3 相容的 object storage |

維運時要注意：

- **備份**：Postgres（兩個 database）以及 Garage 的資料 volume 都要定期備份，並演練還原。
- **Temporal 升級**：Temporal 的 schema migration 需要自己執行，升級前要先閱讀 release notes。
- **Worker 部署**：新版 worker 上線時要搭配 Worker Versioning，確保還在執行中的 Request 不受影響。

## 開發環境

- **Email**：寄信邏輯放在一個共用的 `EmailSender` 介面後面：先用 React Email 把信件渲染成 HTML，再交給 transport 寄出。`EMAIL_TRANSPORT=resend` 時用 Resend SDK；`EMAIL_TRANSPORT=smtp` 時用 nodemailer 寄到 Mailpit（本機與 CI，Web UI 在 `http://localhost:8025`）。nodemailer 只是開發用的 transport，production 一律走 Resend。

- **Bun 只負責安裝套件與執行 script**（`bun install`、`bun run`），所有 app 都由 Node.js 24 執行。原因是 Temporal TypeScript SDK 依賴 Node 的原生模組與 `vm` sandbox，官方並不支援 Bun runtime；NestJS 也以 Node 為主要目標。lockfile 是 `bun.lock`。

- `docker compose -f deploy/compose.yaml up postgres temporal temporal-ui garage mailpit`：啟動依賴服務，apps 在本機用 `bun run dev`（Turborepo）執行，各 app 本身仍由 Node.js 執行。
- **測試分層**：
  - `packages/dsl` 與 `packages/forms`：Vitest 純單元測試。
  - worker：`TestWorkflowEnvironment`（time skipping）測試 Reminder / Escalation，再加上 replay 測試。
  - api：Vitest 搭配真實的 Postgres（Testcontainers）。
  - 端對端：Playwright 走過「發起 → 審批 → Return → 重送 → 完成」的完整流程。
