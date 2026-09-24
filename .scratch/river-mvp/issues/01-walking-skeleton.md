# 01: Walking skeleton

**What to build:** 建立整個專案的骨架，讓每一層都能端對端跑通，並準備好之後每張 ticket 都會用到的測試 seam。完成後，預先建立的 Administrator 可以登入，看到一個空白首頁。架構依照 `docs/TECH-STACK.md`：Bun workspaces + Turborepo、NestJS v12 api、Vite React web、Temporal worker；Postgres 分成 `river` 與 `temporal` 兩個 database。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `bun install` 和 `bun run dev` 可以同時啟動 web、api、worker 三個 app；所有 app 都由 Node.js 24 執行
- [ ] Docker Compose 可以啟動 Postgres、Temporal、temporal-ui、Garage、Mailpit；Caddy 把 web 和 `/api` 放在同一個網域
- [ ] Better Auth 以 email 密碼登入，session 存在 Postgres 並使用 httpOnly cookie；用 seed script 建立第一位 Administrator
- [ ] 已登入的使用者可以看到空白首頁；未登入的使用者會被導到登入頁
- [ ] `apps/web` 的 `globals.css` 採用 `.scratch/river-mvp/design-tokens.css`；登入頁用分割式版面，首頁 scaffold 用 icon rail + 清單 + 詳情三欄（見本檔 Comments 的 prototype 決定）
- [ ] Seam ① 的測試 harness 可以使用：真實的 Postgres（Testcontainers）、Temporal `TestWorkflowEnvironment` 和真實的 worker；至少有一個「登入後可以取得自己資料」的 API 測試通過
- [ ] Seam ② 的 Vitest 設定已就緒（空的 DSL package 有一個測試）
- [ ] 開工前先確認 `nestjs-zod` 與 Better Auth 的 NestJS 整合已支援 NestJS v12（spec 待決問題 #5），結果記錄在 PR 描述中
- [ ] CI 會跑 lint、typecheck 和上述測試

## Comments

**2026-09-24 · Prototype：整體 design token + 登入 + 首頁 scaffold**

- 原型：`.scratch/river-mvp/prototypes/design-tokens-login-dashboard.prototype.html`（直接用瀏覽器開啟，`?variant=A|B|C|D|E`）
- 已決定（版面）：登入 / TOTP 用 A「清流」的分割式版面；登入後首頁用 C「控制台」的三欄版面（icon rail + 待辦 / 我的申請清單 + Request 詳情與歷程）。B「公文」不採用。
- 已決定（token）：整套用 A 的 token（藍色 primary、Inter + Noto Sans TC、14px、列高 44px、圓角 0.5rem），即原型的 variant D。不採用 C 的中性墨色 token（variant E）。
- 定案 token 已匯出到 `.scratch/river-mvp/design-tokens.css`（`:root` + `.dark`），建立 `apps/web` 時直接放進 `globals.css`。
- 附帶決定：新增 `--brand` / `--brand-foreground` token 給登入頁品牌色塊用，不再借用 `--sidebar-primary`。
- Token 命名沿用 shadcn/ui 的 CSS 變數，另加 `--status-open|approved|returned|closed|overdue`、`--font-heading`、`--font-mono`、`--text-base`、`--row-h`。定案後用原型 Tokens 面板的「複製 CSS」匯出到 `apps/web` 的 `globals.css`。
