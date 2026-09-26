# 12: 新版本與版本鎖定

**What to build:** Designer 可以從目前的 Process Version 建立新草稿並修改，再發佈成新的 Process Version。發佈之後，執行中的 Request 繼續用原本的版本跑完，新的 Request 使用新版本。

**Blocked by:** 04（發起並核准最小的 Request）

**Status:** resolved

- [x] Designer 可以從目前的 Process Version 建立新草稿；草稿的修改不影響目前版本
- [x] Process 頁面會列出所有 Process Version，並標示目前版本
- [x] Seam ①：v1 的 Request 停在審批節點時發佈 v2（在中間多加一個審批節點），v1 的 Request 仍照 v1 跑完；之後發起的 Request 使用 v2

## Comments

實作摘要（2026-09-26）：

- 版本鎖定在 issue 03／04 就已經成立：Request 發起時寫入目前版本的 `process_version_id`，workflow 只帶這個 ID，`loadProcessVersion` 依它讀 DSL。這次補上 Seam ① 測試證明，interpreter 沒有改動，所以不需要 `patched()`。
- API：
  - 新增 `POST /api/processes/:id/draft`（需要 `process.edit`）：從目前版本建立新草稿，複製目前版本的 DSL（含 Form），回 201 與整個 Process。
  - 已經有草稿時回 409，不覆蓋；還沒發佈過的 Process 沒有目前版本，也回 409；找不到回 404。
  - 以 row lock 和發佈序列化，避免同時建立與發佈互相覆蓋。
- 資料庫（migration `0010_process_versions_immutable`，custom SQL，schema 沒有變）：
  - `process_versions` 加上 trigger，擋下 UPDATE 與 DELETE，和 `request_events` 相同做法。「不可修改的快照」從程式約定變成資料庫保證。
- Web（流程設計頁）：
  - 已發佈、沒有草稿時，「草稿」分頁標示「（無）」，改為顯示目前版本的唯讀畫布，並說明草稿的修改不影響目前版本與進行中的 Request。上方按鈕「從 vN 建立草稿」呼叫新的 API，之後才能編輯、儲存、發佈。
  - 以前沒有草稿時可以直接在「草稿（同 vN）」上修改，儲存時才隱含建立草稿；改成明確建立，Draft 的狀態和 `CONTEXT.md` 一致。
  - 版本分頁（`vN`、鎖頭、「目前」）沿用 issue 03 的實作，列出所有 Process Version 並標示目前版本。
- 測試：
  - Seam ①：`apps/api/test/process-versioning.test.ts` 有 6 個測試，涵蓋：
    - 從目前版本建立的草稿與目前版本相同；修改草稿不影響目前版本與入口網站的流程預覽；
    - 已有草稿／還沒發佈過回 409；權限與 404；
    - 版本清單與目前版本；
    - v1 的 Request 停在主管審批時發佈 v2（多一個財務審批），v1 的 Request 核准後直接完成、不會出現財務審批；之後發起的 Request 鎖定 v2，要經過兩個審批；
    - 資料庫層不能 UPDATE／DELETE `process_versions`。
  - Seam ②：DSL 檢查器沒有變動，沒有新增測試。
- 已知限制與待決定：
  - 建立草稿後，即使內容和目前版本相同，清單也會顯示「有未發佈的草稿」；要捨棄才會回到「已發佈」。
  - 只能從目前版本建立草稿；從舊版本還原（回滾）不在這次範圍。
  - Trigger 也會擋下手動清理本機資料（例如 issue 04 留下的測試 Process）；需要時要先停用 trigger。
  - Web 的改動只跑過 typecheck 與 lint，沒有在瀏覽器手動走過。
