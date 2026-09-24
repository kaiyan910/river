# 17: 人員選擇器與明細表欄位

**What to build:** Form 新增兩種進階欄位：人員選擇器（例如選擇「專案負責人」）和明細表（例如報銷單的多行項目，每一行有自己的欄位）。JSONata 表達式可以讀取這兩種欄位的值，例如加總明細表的金額。

**Blocked by:** 05（表單設計器與開始表單）

**Status:** ready-for-agent

- [ ] 人員選擇器欄位：可以搜尋啟用中的 Participant，存下 Participant ID，並以唯讀方式顯示姓名
- [ ] 明細表欄位：Designer 定義表中的欄位；Participant 可以新增或刪除行（使用 TanStack Form 的 array field）；每一行分別驗證
- [ ] JSONata 可以讀取兩種欄位的值（Seam ①：用明細表金額的加總決定分支）
