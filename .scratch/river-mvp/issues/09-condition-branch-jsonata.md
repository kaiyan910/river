# 09: 條件分支（JSONata）

**What to build:** Designer 可以加入條件節點：每條出邊有一個 JSONata 表達式，另有一條預設出邊。Request 依表單資料走不同的分支，例如金額大於 10000 時加走總經理審批。表達式在 activity 中計算，只把選中的出邊回傳給 workflow。

**Blocked by:** 05（表單設計器與開始表單）

**Status:** ready-for-agent

- [ ] 新增 condition 節點；每條出邊可以設定 JSONata 表達式，並依序評估；必須有一條預設出邊
- [ ] 表達式可以用欄位的 key 讀取 Form 欄位的值
- [ ] DSL 檢查器新增規則：JSONata 語法錯誤、缺少預設出邊（Seam ②）
- [ ] `evaluateCondition` activity 從 Postgres 讀取資料並計算，只回傳出邊 ID；workflow 內不執行 JSONata
- [ ] Seam ①：金額低於和高於門檻時，Request 各自走不同的路徑；沒有任何條件成立時，走預設出邊
