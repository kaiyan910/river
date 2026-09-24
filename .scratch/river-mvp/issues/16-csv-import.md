# 16: CSV 匯入

**What to build:** Administrator 可以用 CSV 一次匯入全公司的 Participant，包括每個人的 Manager；匯入後會列出失敗的行和原因。

**Blocked by:** 08（指派給 Manager 與 Fallback Role）

**Status:** ready-for-agent

- [ ] CSV 欄位包括姓名、email、Manager 的 email；同一份檔案中的 Manager 參照可以互相對應，與行的順序無關
- [ ] 成功匯入的人都會收到邀請信
- [ ] 以下情況會列出行號和原因：重複的 email、Manager 不存在、Manager 關係形成循環、格式錯誤
- [ ] 有錯誤的行不會匯入，其他正確的行照常匯入（Seam ①）
