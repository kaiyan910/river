# 20: Service Account 與外部 API

**What to build:** Administrator 可以建立 Service Account，限定它可以發起哪些 Process，並發放 API key。外部系統用這把 key 透過 API 發起 Request，可以用 `on_behalf_of` 代表某位 Participant；也可以查詢自己發起的 Request 的狀態。提供 OpenAPI 文件。

**Blocked by:** 08（指派給 Manager 與 Fallback Role）、13（可見範圍）

**Status:** ready-for-agent

- [ ] Administrator 可以建立 Service Account、設定可發起的 Process、發放和輪替 API key；key 只存 hash，只在發放時顯示一次
- [ ] 外部 API 用 Bearer key 驗證，只能發起授權範圍內的 Process
- [ ] 帶 `on_behalf_of` 時，該 Participant 就是發起人，指派給 Manager 的節點使用他的 Manager
- [ ] 沒有帶 `on_behalf_of` 時，發起人是 Service Account，指派給 Manager 的節點改走 Fallback Role
- [ ] 外部系統可以查詢自己發起的 Request 的狀態
- [ ] 用 @nestjs/swagger 產生外部 API 的 OpenAPI 文件
- [ ] Seam ① 涵蓋以上所有情況
