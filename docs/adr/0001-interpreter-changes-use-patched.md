# 修改 interpreter 用 `patched()`，不用 Worker Versioning

Request 可能執行很久（等審批、Return 後無限期等發起人重新送出、Escalation 的 timer），而 River 只有一個 worker 在 Docker Compose 上以「停掉舊的、啟動新的」方式部署。Worker Versioning（Worker Deployment 的 Pinned 版本）要求每個舊版 worker 一直執行到它的 Request 全部結束，對長時間執行的 Request 等於永遠要同時跑好幾個版本；所以會改變舊 history 指令順序的修改一律以 `patched()` 保護，再由 CI 的 replay 測試（Seam ③）確認沒有 nondeterminism。規則與流程見 [`docs/testing.md`](../testing.md)。

## Considered Options

- **Worker Versioning（Pinned）**：新 Request 走新版、舊 Request 留在舊版，程式碼裡不需要分支；但每個版本都要保留一組執行中的 worker，直到最後一筆 Request 結束。
- **Worker Versioning（Auto-Upgrade）**：舊 Request 會換到新版 worker 繼續執行，一樣需要 `patched()`，只多了部署的複雜度。
- **新的 workflow type（例如 `interpretProcessV2`）**：整個 interpreter 重寫、無法用 `patched()` 表達時使用；同一個 worker 同時註冊兩個 type，api 只用新的發起，舊的在沒有執行中的 Request 之後移除。

## Consequences

- 部署時不能讓新舊 worker 同時處理同一個 task queue：新版寫下的 patch marker 交給舊版重播會 nondeterminism。之後若要多個 worker replica 滾動更新，要重新評估 Worker Versioning。
