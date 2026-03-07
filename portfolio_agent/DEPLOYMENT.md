# Deployment (Docker)

This setup runs your app as **three services**:

1. `web`: `node server.js` (serves `index.html`, `/token`, `/widgets`)
2. `agent`: `pnpm run dev` (LiveKit worker)
3. `caddy`: reverse proxy + automatic TLS certs (Let's Encrypt)

Notes for current compose:
- Services run with `network_mode: host` (Linux/EC2 host network).
- `agent` startup runs `pnpm run download-files` before `pnpm run dev`.

## 1) Prepare env file

Create `.env.local` in the project root (or copy from `.env.example`) and fill in real values.

Required for HTTPS:
- `DOMAIN` must point (DNS A/AAAA) to this server's public IP
- `ACME_EMAIL` must be a valid email

Server/network requirements:
- Inbound `80/tcp` and `443/tcp` open to the internet
- Outbound `443/tcp` allowed (for Let's Encrypt + APIs)
- In LiveKit Cloud, enable `Project settings -> Observability -> Insights`
- Supabase Postgres `DATABASE_URL` configured for Prisma

## 2) Start on server

```bash
docker compose up -d --build
```

## 3) Open the app

Visit:

```text
https://<your-domain>
```

Dashboard:

```text
https://<your-domain>/dashboard
```

Microphone access in browsers requires a secure context:
- Works on `https://...`
- Works on `http://localhost`
- Does not work on plain `http://<public-ip-or-domain>`

## Useful commands

```bash
# Tail logs
docker compose logs -f

# Caddy logs
docker compose logs -f caddy

# Restart
docker compose restart

# Stop
docker compose down
```

## Observability flags

Set in `.env.local` (or keep defaults from `.env.example`):

- `LK_AGENT_RECORD=true`: allows the worker to upload session traces/metrics to LiveKit Insights.
- `LK_LOG_SDK_METRICS=true`: prints SDK metrics (TTFT/TTFB/token/audio stats) to worker logs.
- `LK_TOOL_OBSERVABILITY=true`: emits structured logs for each tool invocation (start/end, duration, success/error).
- `LK_TOOL_OBSERVABILITY_PUBLISH=false`: optionally publishes tool telemetry as LiveKit data messages with type `TOOL_OBSERVABILITY`.
- `LK_DB_OBSERVABILITY_ENABLED=true`: sends agent/tool observability events to `/observability/events` for Supabase persistence.
- `DATABASE_URL`: DB URL (pooler URL is fine for runtime and `migrate deploy`).
- `DIRECT_URL`: optional; use only if you have reachable direct Postgres.
- `SHADOW_DATABASE_URL`: only needed for `prisma migrate dev` (not needed for `migrate deploy`).
- `OBSERVABILITY_INGEST_KEY` (optional): if set, ingest clients must send header `x-observability-key`.

## Prisma setup

For IPv4-only environments (Supabase pooler only), use deploy flow:

```bash
pnpm install
pnpm run prisma:generate
pnpm run prisma:migrate:deploy
```

Use `prisma migrate dev` only when direct DB + shadow DB are reachable.
Runtime uses Prisma 7 driver adapters (`@prisma/adapter-pg` + `pg`) with `DATABASE_URL`.

## Local (without Docker)

Run both processes in one terminal:

```bash
pnpm run start:local
```
