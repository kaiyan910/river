# 01: Walking skeleton

**What to build:** 建立整個專案的骨架，讓每一層都能端對端跑通，並準備好之後每張 ticket 都會用到的測試 seam。完成後，預先建立的 Administrator 可以登入，看到一個空白首頁。架構依照 `docs/TECH-STACK.md`：Bun workspaces + Turborepo、NestJS v12 api、Vite React web、Temporal worker；Postgres 分成 `river` 與 `temporal` 兩個 database。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `bun install` 和 `bun run dev` 可以同時啟動 web、api、worker 三個 app；所有 app 都由 Node.js 24 執行
- [x] Docker Compose 可以啟動 Postgres、Temporal、temporal-ui、Garage、Mailpit；Caddy 把 web 和 `/api` 放在同一個網域
- [x] Better Auth 以 email 密碼登入，session 存在 Postgres 並使用 httpOnly cookie；用 seed script 建立第一位 Administrator
- [x] 已登入的使用者可以看到空白首頁；未登入的使用者會被導到登入頁（未登入導向已在瀏覽器確認；登入後的首頁只經過 API 測試與建置驗證，尚待人工目視確認）
- [x] `apps/web` 的 `globals.css` 採用 `.scratch/river-mvp/design-tokens.css`；登入頁用分割式版面，首頁 scaffold 用 icon rail + 清單 + 詳情三欄（見本檔 Comments 的 prototype 決定）
- [x] Seam ① 的測試 harness 可以使用：真實的 Postgres（Testcontainers）、Temporal `TestWorkflowEnvironment` 和真實的 worker；至少有一個「登入後可以取得自己資料」的 API 測試通過
- [x] Seam ② 的 Vitest 設定已就緒（空的 DSL package 有一個測試）
- [x] 開工前先確認 `nestjs-zod` 與 Better Auth 的 NestJS 整合已支援 NestJS v12（spec 待決問題 #5），結果記錄在 PR 描述中（目前沒有 PR，結果記在 commit `36d8eb7` 的訊息與本檔 Comments）
- [x] CI 會跑 lint、typecheck 和上述測試（`.github/workflows/ci.yml`；repo 還沒有 remote，尚未在 GitHub Actions 上實際跑過）

## Comments

**2026-09-24 · Prototype：整體 design token + 登入 + 首頁 scaffold**

- 原型：`.scratch/river-mvp/prototypes/design-tokens-login-dashboard.prototype.html`（直接用瀏覽器開啟，`?variant=A|B|C|D|E`）
- 已決定（版面）：登入 / TOTP 用 A「清流」的分割式版面；登入後首頁用 C「控制台」的三欄版面（icon rail + 待辦 / 我的申請清單 + Request 詳情與歷程）。B「公文」不採用。
- 已決定（token）：整套用 A 的 token（藍色 primary、Inter + Noto Sans TC、14px、列高 44px、圓角 0.5rem），即原型的 variant D。不採用 C 的中性墨色 token（variant E）。
- 定案 token 已匯出到 `.scratch/river-mvp/design-tokens.css`（`:root` + `.dark`），建立 `apps/web` 時直接放進 `globals.css`。
- 附帶決定：新增 `--brand` / `--brand-foreground` token 給登入頁品牌色塊用，不再借用 `--sidebar-primary`。
- Token 命名沿用 shadcn/ui 的 CSS 變數，另加 `--status-open|approved|returned|closed|overdue`、`--font-heading`、`--font-mono`、`--text-base`、`--row-h`。定案後用原型 Tokens 面板的「複製 CSS」匯出到 `apps/web` 的 `globals.css`。

**2026-09-24 · 實作：NestJS v12 相容性（spec 待決問題 #5）與其他決定**

- `@thallesp/nestjs-better-auth` 2.8.0：peer 宣告支援 `@nestjs/common`/`core` `^12.0.0`，可直接使用。
- `nestjs-zod` 5.5.0（目前最新）：peer 只宣告 `@nestjs/common ^10 || ^11` 與 `@nestjs/swagger ^7.4.2 || ^8 || ^11`，還沒宣告 v12。在 NestJS 12.1 + `@nestjs/swagger` 12.0.2 上實測 `ZodValidationPipe`（400 / 201）、`createZodDto` 與 `cleanupOpenApiDoc` 產生的 OpenAPI schema 都正常，所以照常使用，bun 只會顯示 peer 警告。上游發佈 v12 支援後要升級。
- Temporal 用 `temporal` 與 `temporal_visibility` 兩個 database（auto-setup 兩份 schema 的 `schema_version` 資料表會衝突），都與 `river` 分開；已更新 TECH-STACK.md。
- worker 的 dev 用 `tsx watch`：`node --watch` 在 Temporal 的 workflow worker thread 裡會 crash（`RangeError: Invalid atomic access index`）。api 用 `node --watch` + `@swc-node/register`，因為 Nest 需要 decorator metadata。
- TypeScript 固定在 6.0（`@nestjs/swagger` 12 與 nestjs-better-auth 的 peer 還不支援 7）。Lint 用 Biome。

**2026-09-24 · 完成（branch `issue-01-walking-skeleton`，commit `36d8eb7`）**

- 測試：Seam ① 有 7 個 API 測試（`apps/api/test/`：登入後取得自己的資料、httpOnly / SameSite=Lax cookie、密碼錯誤、未登入回 401、不能自行註冊、health、api → Temporal → worker → Postgres）；Seam ② 有 1 個 DSL 測試。
- 本機開發步驟見 `deploy/README.md`。
- Code review 後已修正：api 不再直接依賴 worker app 的程式碼；導覽依個別 Permission 顯示；`provisionParticipant` 失敗時會刪除剛建立的 user。
- 留給後續 ticket：
  - Secure cookie 取決於 `BETTER_AUTH_URL` 是否為 https，正式環境要確認（22）。
  - `/api/docs`（Swagger UI）目前不需登入（20 做 External API 時再決定）。
  - `provisionParticipant` 是暫時的入口，改成 Administrator 建立帳號 + 邀請信時取代（02 / 16）。
  - `ParticipantsModule` 與 TECH-STACK 的 `OrgModule` 命名待統一（02）。
  - `nestjs-zod` 發佈正式支援 NestJS v12 的版本後升級。
