# 21: 排程發起

**What to build:** Designer 可以為 Process 設定排程，例如每月 1 號自動發起一筆 Request。排程設定中必須指定一位 Participant 作為發起人。

**Blocked by:** 04（發起並核准最小的 Request）

**Status:** resolved

- [x] Process 可以設定 cron 排程，並指定作為發起人的 Participant（spec 待決問題 #3 的建議預設）
- [x] 排程由 Temporal Schedule 實作；修改或刪除設定時，會同步更新 Temporal Schedule
- [x] 時間到時，以指定的 Participant 為發起人、使用目前的 Process Version 發起 Request
- [x] 指定的發起人已停用時，跳過這次發起，並通知 Administrator
- [x] Seam ① 測試時間到了會發起 Request

## Comments

**實作摘要（2026-09-26）**

- 設定存在新的 `process_schedules` 表（migration 0016，每個 Process 最多一列：cron、時區、發起人），和 Initiator Role 一樣設定在 Process 上、不屬於任何 Process Version，所以需要 `process.publish`。API：`PUT /api/processes/:id/schedule`（`{ cron, initiatorId }`）、`DELETE /api/processes/:id/schedule`，`GET /api/processes/:id` 多了 `schedule`（含發起人是否已停用）。
- 同步 Temporal Schedule：在同一個 transaction 裡先鎖住 Process、寫入設定，再建立（已存在時改成 update）或刪除 Temporal Schedule；Temporal 失敗時設定跟著 rollback。Schedule ID 是 `process-schedule-<processId>`，輸入只有 Process ID，發起人與版本在時間到時才從 Postgres 讀取，所以修改發起人、發佈新版本都不需要改 Schedule 的輸入。cron 一律以 `Asia/Taipei` 解讀；overlap 是 ALLOW_ALL、catchup window 1 天。
- 設定時的檢查：還沒發佈 → 409；cron 格式不是五個欄位 → 400；數值範圍不合法（Temporal client 解析失敗）→ 422；發起人不存在、已停用，或不在 Initiator Role 裡 → 422。
- 時間到時啟動 `scheduledStart` workflow：`startScheduledRequest` activity 以 workflow 產生的 Request ID（重試冪等）建立 Request、`request.started` 事件（comment「排程發起」）與開始表單資料，再以 child workflow（ABANDON）啟動 interpreter，workflow ID 等於 Request ID，之後的 Withdraw、Cancel 等 Signal 照常運作。標題是「<Process 名稱>（排程 YYYY-MM-DD）」。
- 跳過並通知 Administrator（持有 `user.manage` 的人，新的「排程發起已跳過」信件）的情況：發起人已停用；開始表單有必填欄位（排程沒有人填表，以空白表單送出，決定跳過而不是略過驗證）。設定剛被刪除時靜默跳過。執行時不再檢查 Initiator Role（設定時已檢查）。
- Seam ① 測試（`scheduled-start.test.ts`，6 個）：time skipping 的測試 server 不支援 Temporal Schedule，所以 harness 新增 `startTestApp({ temporal: 'local' })`，改用 Temporal CLI 的 dev server（第一次執行會下載 CLI）；「時間到了」以 `ScheduleHandle.trigger()` 觸發，並以 `describe()` 驗證 Schedule 的 cron、時區與輸入。
- Web：Designer 標題列新增排程摘要按鈕與「排程發起」對話框（常用時間、cron 輸入與中文說明、發起人選擇、刪除排程；發起人已停用時標示）。

**Review 修正（2026-09-26）**

- 跳過的原因只以代碼（`initiator_deactivated`、`initiator_not_allowed`、`no_version`、`required_fields`）進入 Temporal history；發起人姓名、欄位名稱在寄信的 activity 裡才從 Postgres 讀取。Seam ① 測試檢查 history 的 payload 不含這些內容。
- 時間到時除了檢查發起人沒有停用，也重新檢查他仍在 Initiator Role 裡；不在時一樣跳過並通知 Administrator。
- Replay 樣本 `scheduled-start`、`scheduled-start-skipped`（產生器直接啟動 `scheduledStart` workflow，因為 time skipping 的 server 不支援 Schedule）。

**Issue 沒有要求、由實作決定的事項（需要時請調整）**

- 開始表單有必填欄位時跳過並通知 Administrator：排程沒有人填表，只能以空白表單送出；選擇跳過而不是略過驗證、建立缺資料的 Request。
- cron 一律以 `Asia/Taipei` 解讀（和 Form 的日期同一個時區），畫面上沒有時區選項。
- Temporal Schedule 的 overlap policy 是 `ALLOW_ALL`（每次時間到都是獨立的一筆 Request，不因上一次還在執行而跳過）；catchup window 是 1 天（Temporal 無法使用期間錯過的時間，恢復後一天內的會補發，更久的不補）。
- 設定時 Temporal 成功、Postgres transaction 沒有提交時，會留下沒有設定的 Temporal Schedule；時間到時 worker 讀不到設定而靜默跳過，下一次設定會沿用它。

