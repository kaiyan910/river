# 04: 發起並核准最小的 Request

**What to build:** 這是第一條真正跑完的流程。Participant 在入口網站選一個已發佈的 Process 發起 Request；審批人在「我的待辦」看到 Task 並核准；Request 完成。發起人可以在「我的申請」看到狀態和時間軸。這張 ticket 會建立通用的 interpreter workflow，以及 Task 收件匣與稽核歷程。

**Blocked by:** 02（Participant、Role、Permission 管理）、03（Designer 發佈最小的 Process）

**Status:** resolved

- [x] Participant 可以在入口網站看到已發佈的 Process，並發起 Request（先只填一個標題欄位）
- [x] 每筆 Request 對應一個 Temporal workflow，workflow ID 等於 Request ID；輸入只有 Request ID 和 Process Version ID
- [x] Request 流轉到審批節點時，activity 在 Postgres 建立 Task，審批人可以在「我的待辦」看到
- [x] 審批人核准後：API 先更新 Task（使用樂觀鎖），再送出 `taskCompleted` Signal；workflow 走到 end，Request 變成 completed
- [x] Signal 是冪等的：重複送出同一個 taskId 不會產生任何影響（有測試）
- [x] 每個狀態變化都寫入只能新增的 request_events；「我的申請」列表和 Request 時間軸直接讀這張表
- [x] Seam ① 的 API 測試涵蓋從發起、核准到完成的完整流程

## Comments

**2026-09-25 · Prototype：入口網站、我的待辦、我的申請**

- 原型：branch `prototype/issue-04-portal-tasks-requests`（commit `210e1ec`），掛在 `/start`、`/tasks`、`/requests`，用 `?variant=A|B|C` 切換；資料是記憶體假資料，左下角可以切換發起人／審批人、模擬樂觀鎖衝突。
- 問題：發起 Request、「我的待辦」與 Task 核准、「我的申請」與時間軸應該長什麼樣子？
- 已決定：採用 A「清單 + 詳情」，三頁都沿用「控制台」的兩欄版面（左清單、右詳情），選取的項目放在網址 `?id=`。
  - 發起（`/start`）：左欄是可發起的 Process 清單（搜尋；列上顯示名稱、說明、`vN`）。右欄是 Process 名稱、說明、「Process Version N」，流程預覽（開始 → 審批：某人 → 結束），「申請內容」只有標題欄位；「送出申請」在標題空白時停用。送出後導到 `/requests?id=<新的 Request>`。
  - 我的待辦（`/tasks`）：左欄分頁「待處理｜已處理」並顯示數量，可搜尋編號、標題；列上顯示發起人頭像、標題、發起人 · Process · 節點名稱、收到時間。右欄：Request 標題列（編號 · Process vN、發起人與發起時間、狀態）、申請內容、「輪到你：<節點名稱>」核准區（選填意見 + 「核准」），下方是進度與時間軸。已處理的 Task 改顯示「X 已於 … 核准：『意見』」。
  - 樂觀鎖失敗時，在核准區原地顯示「已由 X 處理。」，並把畫面更新成已處理的狀態。
  - 我的申請（`/requests`）：左欄分頁「進行中｜已完成｜全部」並顯示數量，可搜尋；列上顯示標題、狀態與目前步驟（「主管審批 · 等待 陳主管」／「已完成」）、最後更新時間、編號。右欄：標題列、進度（開始 → 審批 → 結束，已完成／目前／處理中三種狀態）、申請內容、垂直時間軸。
  - 時間軸逐列讀 request_events：「X 發起申請」「流轉到『節點』，等待 X 處理」「X 在『節點』核准」（有意見時顯示在下方灰框）「申請完成」，右側是時間。
  - 「處理中」空檔：Request 是 running 但還沒有 open 的 Task（發起後 workflow 還沒建立 Task，或核准後還沒走到 end），清單顯示轉圈的「處理中」，時間軸最後多一列「處理中，下一步馬上出現…」。
- 不採用：B（流程卡片牆 + 對話框、待辦表格直接核准 + 抽屜、申請表格 + 整頁明細）、C（搜尋式發起、逐件處理待辦、卡片動態牆 + 對話式時間軸）。
- 實作時要處理：
  - 核准的選填意見 ticket 沒有列，但原型有，時間軸也要顯示（user story 48）；`taskCompleted` 的 request_event 要帶 comment。
  - 「處理中」需要畫面在 workflow 往前走之後更新（重新整理或 polling），否則會一直停在處理中。
  - `/start` 目前不在導覽列，只能從首頁的「發起」按鈕進入。
  - 首頁已經有「待辦／我的申請」兩個分頁的空清單，要決定是改讀同樣的資料，還是只保留捷徑。

**2026-09-25 · 實作結果**

- 資料表（migration `0003_requests`）：
  - `requests`：流水號 `number`，畫面顯示成 `R-000042`；另有鎖定的 Process Version、發起人、標題、狀態 `running`／`completed`。
  - `tasks`：ID 由 workflow 產生（`uuid4()`），activity 重試不會重複建立；另有節點、審批人、狀態、結果、意見，以及樂觀鎖用的 `version`。
  - `request_events`：`request.started`、`task.created`、`task.completed`（帶意見）、`request.completed`。資料庫 trigger 擋下 UPDATE 與 DELETE。每個事件都和它代表的狀態變化寫在同一個 transaction，只有狀態真的改變時才寫入。
- Worker：`interpretProcess` 從「開始」沿著第一條出邊走到「結束」。
  - 審批節點先建立 Task，等到這個 taskId 的 `taskCompleted` Signal 才往下走。重複的 Signal、或早就處理過的 Task 的 Signal 都不會有影響。
  - Activities：`loadProcessVersion`、`createTask`、`completeRequest`。
  - workflow／Signal 的名稱與 payload 放在沒有任何依賴的 `@river/contracts/workflow`。
- API（新的 `RequestModule`，只要是有效的 Participant 就能呼叫）：
  - `GET /api/processes/startable`：已發佈 Process 的目前版本與步驟預覽。
  - `POST /api/requests`：以目前版本發起。
  - `GET /api/requests/mine`
  - `GET /api/requests/:id`：只有發起人與經手的審批人看得到，其他人回 404。
  - `GET /api/tasks/mine?status=open|completed`
  - `POST /api/tasks/:id/complete`：body 是 `{ outcome: 'approved', version, comment? }`。樂觀鎖失敗時回 409：已處理時是「已由 X 處理。」，版本不同時要求重新整理。
- 「我的申請」：清單的最後更新時間與時間軸讀 `request_events`；狀態讀 `requests.status`，目前步驟讀 open 的 Task，兩者都和對應的事件在同一個 transaction 寫入。
- Web：`/start`、`/tasks`、`/requests` 依原型 A 實作，`/start` 加進導覽列。
  - 「處理中」期間，明細與清單每秒輪詢一次。分頁在背景時 TanStack Query 會暫停輪詢，回到分頁時重新讀取。
  - 首頁兩個分頁改讀同一份資料：待辦、進行中的申請。點一筆會到對應的頁面。
- 測試：`apps/api/test/requests.test.ts` 有 9 個測試，涵蓋發起、Task 出現在待辦、核准到完成、時間軸、先送出者勝出、版本衝突、非審批人、驗證、Signal 冪等。Signal 冪等的測試直接透過 Temporal client 重送 Signal。我也在本機瀏覽器走過一次完整流程。
- 已知限制、留給後續：
  - Signal 送出失敗時，API 回 500，Task 已經是 completed。同一人重試核准會收到 409，但 API 會先重送一次 Signal，Request 因此不會卡住。若要完全不依賴使用者重試，需要 outbox。
  - workflow 在發起的 transaction 提交前啟動：啟動失敗時不會留下 Request。反過來，如果提交失敗，會留下一個讀不到 Request 的 workflow，它的 activity 會一直重試。
  - 存取檢查（發起人／經手的審批人）目前寫在 API 的 `RequestReads`，還沒有集中到 `packages/db`；可見範圍在 13 一起處理。
  - 「我的待辦」不會自動輪詢，要重新整理或回到分頁才會出現新的 Task（寄信通知在 11）。
  - 本機開發資料庫多了一個測試用的 Process「請假（issue 04 測試）」和一筆 Request，可以刪掉。
