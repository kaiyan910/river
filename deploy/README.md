# 本機開發環境

```sh
cp .env.example .env                          # 填入 BETTER_AUTH_SECRET 等值
docker compose -f deploy/compose.yaml up -d   # Postgres、Temporal、temporal-ui、Garage、Mailpit、Caddy
bun install
bun run db:migrate
bun run seed:admin                            # 依 .env 的 SEED_ADMIN_* 建立第一位 Administrator
bun run dev                                   # web、api、worker（都由 Node.js 24 執行）
```

| 網址 | 服務 |
|---|---|
| http://localhost:8000 | River（Caddy：`/api/*` → api:3000，其餘 → web:5173） |
| http://localhost:8080 | Temporal UI |
| http://localhost:8025 | Mailpit |

本機的 5432 port 已被占用時，用 `RIVER_POSTGRES_PORT=5440 docker compose ...` 並同步修改 `.env` 的 `DATABASE_URL`。

## Garage

第一次啟動後要指派單節點 layout，之後才能建立 bucket（附件功能會用到）：

```sh
garage() { docker compose -f deploy/compose.yaml exec garage /garage "$@"; }
garage layout assign -z dev -c 1G "$(garage node id -q | cut -d@ -f1)"
garage layout apply --version 1
```

接著建立附件用的 access key 與 bucket（key ID 與 secret 用 `.env` 的 `S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`；
key ID 是 `GK` 加 24 個 hex 字元，secret 用 `openssl rand -hex 32` 產生），再設定 bucket 的 CORS，
讓瀏覽器可以用 presigned URL 直接上傳、下載：

```sh
garage key import --yes -n river "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
garage bucket create river-attachments
garage bucket allow --read --write --owner river-attachments --key river
bun run setup:storage                         # 依 .env 的 BETTER_AUTH_URL 等設定 CORS
```
