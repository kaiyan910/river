# 01: 手機版以 hamburger menu 顯示主要導覽

**What to build:** 寬度 `< md`（768px）時，AppShell 的主要導覽不再是橫向捲動的 icon 列，改成頂部列加上 hamburger 按鈕，點下去從左側滑出 drawer。`≥ md` 的 icon rail 不變。

**Blocked by:** 無

**Status:** resolved

- [x] 頂部列（`< md`）從左到右是 ☰、Logo、目前頁名，捲動時固定在頂部（sticky）
- [x] 目前頁名：拿目前路徑比對 `NAV_GROUPS` 各項和帳號安全的 `to`，取最長前綴相符的那一個的 label（例如 `/requests/visible` 對到「可查看的 Request」，`/account/security` 對到「帳號安全」）
- [x] Drawer 從左側滑出，寬約 280px，後面有半透明遮罩；`role="dialog"`、`aria-modal`，照現有 dialog 的做法自己寫，不新增依賴
- [x] 點遮罩、按 Esc、點任一個導覽項目後都會關閉；打開時 body 不捲動
- [x] 導覽項目沿用 `visibleNavGroups(me.permissions)`：每項顯示 icon 加文字，保留分組分隔線，並標示目前所在的頁面
- [x] Drawer 底部是帳號區：頭像、姓名、email，接著是「帳號安全」和「登出」
- [x] `totpPending` 時：☰ 右上角加小圓點，drawer 裡的「帳號安全」用 ShieldAlert 圖示和 `status-returned` 色；上方的黃色提醒橫幅不變
- [x] `≥ md` 時頂部列和 drawer 都不出現，icon rail 和現在一樣
- [x] 在瀏覽器的手機寬度和桌面寬度各手動確認一次

## 已決定

- 範圍只有 AppShell 的導覽。各頁自己的手機版面（例如流程設計頁清單疊在畫布上方）之後另開 issue。
- 斷點沿用 `md`，和現在 icon 列換成 icon rail 的地方一樣。
- 純 UI 版面：不動 `CONTEXT.md`，也不寫 ADR。

## Comments

實作摘要（2026-09-26）：

- `apps/web/src/routes/mobile-nav.tsx`：頂部列加上 drawer。換頁時（包含瀏覽器上一頁）用 `pathname` effect 關閉；打開時焦點移到 ✕、鎖住 body 捲動，關閉後焦點還給 ☰；關閉時整層設為 `inert`。
- `navigation.ts`：新增 `currentPageLabel(pathname)`，用最長前綴比對。
- `app-shell.tsx`：icon rail 改成只在 `md` 以上顯示，拿掉原本手機版的橫向 icon 列樣式。
- 瀏覽器確認：手機寬度下開啟、Esc、點遮罩、點項目換頁都會關閉，頁名跟著更新，焦點和 body 捲動都有還原；桌面寬度的 icon rail 不變。
- 已知：`totpPending` 的小圓點只有看過程式，沒有用未啟用 TOTP 的帳號實際看過。`/requests` 和 `/requests/visible` 會同時標為 active，這是原本就有的問題（桌面的 icon rail 也一樣），這次沒有處理。

追加修正（2026-09-26）：手機版外框原本是 `grid` 加 `min-h-screen`，多出來的高度被平均分給 header、清單、詳細區每一列，所以清單和 header 之間會空一段。改成手機版用 flex column，最後一個區塊（`*:last:flex-1`）撐滿剩下的高度；TOTP 提醒底下那層也照同樣方式改。`md` 以上仍然是 grid。13 個已登入頁面都確認過，第一個區塊都緊接在 header 下方。
