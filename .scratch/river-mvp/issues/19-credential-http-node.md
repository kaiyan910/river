# 19: Credential 與 HTTP 節點

**What to build:** 持有 credential.manage 的人可以建立與輪替 Credential，秘密存下之後就不會再顯示。Designer 可以在流程中加入 HTTP 節點：用 JSONata 從 Request 資料組成 body，並以名稱引用 Credential；秘密只在 activity 內解密。

**Blocked by:** 09（條件分支（JSONata））

**Status:** ready-for-agent

- [ ] Credential 可以建立、輪替和刪除；秘密加密儲存，只能寫入，API 永遠不回傳秘密
- [ ] 新增 http 節點：method、URL、JSONata body、Credential 名稱（選填）；DSL 中只存 Credential 名稱
- [ ] `httpRequest` activity 在執行時才解密 Credential，並帶重試
- [ ] 重試全部失敗時：Request 暫停，並通知 Administrator；Administrator 可以重試或 Cancel（spec 待決問題 #1 的建議預設）
- [ ] Credential 輪替後，下一次呼叫就使用新的秘密，不需要重新發佈 Process
- [ ] Seam ①：stub server 收到正確的 body 和認證 header；Temporal history 中找不到秘密
