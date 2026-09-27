# 26: 外部 API 的 person 欄位接受 email

**What to build:** 外部系統透過外部 API 發起 Request 時，開始表單（包括明細表的欄）的 person 欄位可以用 email 指定 Participant，而不是 River 的 Participant ID；外部系統通常沒有 Participant ID（和 `on_behalf_of` 以 email 指定的理由相同）。

**Blocked by:** 25（外部 API 列出可以發起的 Process）

**Status:** needs-triage

- [ ] 外部 API 的 person 欄位接受 email（不分大小寫），存成對應的 Participant ID
- [ ] email 找不到或該 Participant 已停用時回 422，訊息指出是哪個欄位
- [ ] 平台 UI 的 person 欄位維持使用 Participant ID
- [ ] 外部合約與 OpenAPI 文件更新 person 欄位的說明
- [ ] Seam ① 涵蓋以上情況

## Comments

待決定：是否仍接受 Participant ID（兩者都收，或外部 API 只收 email）。
