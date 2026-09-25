# 05: 表單設計器與開始表單

**What to build:** Designer 可以用拖拉的方式設計 Form，並指定開始步驟和填表節點要用哪個 Form。Participant 發起 Request 時填寫開始表單，填表 Task 則填寫對應的 Form；審批人以唯讀方式看到表單資料。Form 資料只存在 Postgres，不會進入 Temporal。

**Blocked by:** 04（發起並核准最小的 Request）

**Status:** ready-for-agent

- [ ] 表單設計器（dnd-kit）支援以下欄位：單行文字、多行文字、數字、金額、日期、單選、多選、checkbox；可以設定必填和簡單的驗證規則
- [ ] Form 屬於 Process，並隨 Process Version 一起存成快照
- [ ] 渲染端從 Form schema 產生 Zod，交給 TanStack Form 驗證；API 端用同一份 schema 驗證，資料不合法時拒絕
- [ ] 新增 form（填表）節點類型；DSL 檢查器新增一條規則：填表節點必須指定 Form
- [ ] Form 資料依步驟存入 request_data；審批人在 Task 畫面以唯讀方式看到
- [ ] 安全測試（Seam ①）：跑完一筆 Request 後，Temporal history 的所有 payload 中都找不到任何表單欄位的值

## Comments

**2026-09-26 · Prototype：表單設計器、開始表單與唯讀顯示**

- 原型：branch `prototype/issue-05-form-designer`（commit `ca06a18`），掛在 `/designer/processes`，用 `?variant=A|B|C` 切換；資料是記憶體假資料，Form schema → Zod 與檢查規則是示意版。
- 問題：Form 在流程設計頁裡放在哪裡、表單設計器長什麼樣子、怎麼把 Form 指定給開始／填表節點；發起人填寫與審批人唯讀看到的樣子。
- 已決定：採用 C「欄位表格 + 即時預覽」，放在 issue 03 A 的 IDE 版面裡。
  - 編輯器上方的分頁是「流程｜<每份 Form 一個分頁>｜＋」；Form 有錯誤時分頁上顯示紅點；按「＋」新增 Form 並切到它的分頁。Form 屬於 Process，可以給多個節點用。
  - 流程分頁：左上節點面板多了「填表」（開始、填表、審批、結束；拖到畫布或點一下）。節點屬性面板：名稱、填表人／審批人、Form 下拉選單（開始節點可以選「不需要表單（只填標題）」，填表節點必選）、「打開這份 Form 的分頁 →」、「刪除節點」。
  - Form 分頁左半：
    - 上方是 Form 名稱（可直接改）、「刪除 Form」，以及「用在：」勾選開始／填表節點；節點已經用別的 Form 時標出「目前用 X」。
    - 欄位表格，一列一個欄位：拖拉手把、類型圖示、欄位名稱、欄位代碼、必填 checkbox、規則摘要 chip（例如「≤ 50 字」「≥ 1」「不早於今天」「4 個選項」）、刪除。名稱、代碼、必填直接在列上改。
    - 點規則摘要展開該列，設定類型相關的規則：字數上下限、格式（正規表示式 + 不符時的訊息）、數值上下限、日期不能早於今天、選項（一行一個）、多選最多幾項、說明文字。
    - 下方「＋ 新增欄位 ▾」選單選 8 種類型；新欄位加在最後並自動展開。欄位錯誤列在表格下方。
  - Form 分頁右半是一直開著的即時預覽，分頁「填寫｜審批人看到｜request_data｜驗證規則」：
    - 填寫：單欄表單，離開欄位時驗證該欄、送出時驗證全部，錯誤顯示在欄位下方，送出鈕旁顯示「有 N 個欄位需要修正」。
    - 審批人看到：`<dt>` 欄位名稱／`<dd>` 值的兩欄清單；金額顯示 `NT$ 12,500`、多選用「、」連接、checkbox 顯示是／否、空值顯示「—」。
    - request_data：通過驗證時顯示存進 Postgres 的 JSON，不通過時顯示 API 會回的錯誤。
    - 驗證規則：從 Form schema 產生的 Zod（瀏覽器與 API 共用）。
  - 版面只有單欄，不做半寬／整列。
  - 發起頁「申請內容」：標題 + 開始表單的欄位，同一個表單一起驗證。
  - 待辦頁「申請內容」依步驟分組：「開始表單 · 出差申請單 · 王小明填寫」「財務確認預支 · 預支款確認 · 林會計填寫」，每組是唯讀清單。輪到填表節點時，「輪到你」區塊換成該 Form 的填寫表單與「送出」。
  - 檢查規則：
    - Process：`FORM_NODE_NO_FORM`（填表節點必須指定 Form）、`FORM_NODE_NO_ASSIGNEE`、`NODE_FORM_MISSING`（指定的 Form 已被刪除）。
    - Form（只有被節點使用的 Form 會擋發佈）：`FORM_EMPTY`、`FIELD_NO_LABEL`、`FIELD_BAD_KEY`（小寫字母開頭，只能有英數與底線）、`FIELD_DUPLICATE_KEY`、`FIELD_NO_OPTIONS`、`FIELD_BAD_RANGE`（下限大於上限）、`FIELD_BAD_PATTERN`。
- 不採用：
  - A「流程｜表單分頁」：Form 清單 + 單欄 WYSIWYG 畫布 + 浮動欄位面板 + 屬性面板 + 預覽對話框。
  - B「節點上的表單 + 全螢幕建構器」：Form 跟著節點走、畫布節點顯示欄位摘要、兩欄格線半寬／整列、預覽在建構器內切換。
- 實作時要處理：
  - Ticket 寫「用拖拉的方式設計 Form」；C 只用 dnd-kit 拖拉排序欄位（另加鍵盤排序），新增欄位用選單，不從面板拖進來。
  - 新欄位的代碼預設是 `field_N`，中文名稱無法自動轉成代碼。改代碼會影響已存的 request_data，但 Form 跟著 Process Version 存成快照，只影響新版本。
  - 「用在」勾選一個已經用別的 Form 的節點會直接換掉；「刪除 Form」會把用它的節點清成未指定。正式版要先確認。
  - 原型的填寫用 React state + Zod，正式版照 ticket 用 TanStack Form。
  - 格式（正規表示式）會在 API 上執行，要防 ReDoS（限制長度或用安全的 regex 引擎）。
  - 「不能早於今天」在 API 端要用固定時區（Asia/Taipei）判斷。
  - 金額存成數字，最多兩位小數；數字欄位只接受整數。
  - 原型的檢查器沒有連線相關規則；正式版沿用 `@river/dsl` 既有的檢查，再加上上面的規則。
