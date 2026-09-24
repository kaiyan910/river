# 18: 附件欄位

**What to build:** Form 新增附件欄位，Participant 可以上傳收據、報價單等檔案。檔案透過 presigned URL 直接上傳到 S3 相容的 Garage；只有看得到該 Request 的人可以下載。

**Blocked by:** 05（表單設計器與開始表單）

**Status:** ready-for-agent

- [ ] 附件欄位可以設定允許的檔案類型、大小上限和數量
- [ ] API 發出 presigned 上傳 URL，瀏覽器直接上傳到 Garage；attachments 資料表記錄檔案的中繼資料
- [ ] 下載時同樣使用 presigned URL，並先檢查請求者看不看得到該 Request
- [ ] 附件內容與下載 URL 都不會進入 Temporal（Seam ①）
