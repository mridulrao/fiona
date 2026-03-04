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

## 2) Start on server

```bash
docker compose up -d --build
```

## 3) Open the app

Visit:

```text
https://<your-domain>
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

## Local (without Docker)

Run both processes in one terminal:

```bash
pnpm run start:local
```
