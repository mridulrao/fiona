# Deployment (Docker)

This setup runs your app as **two services**:

1. `web`: `node server.js` (serves `index.html`, `/token`, `/widgets`)
2. `agent`: `pnpm run dev` (LiveKit worker)

## 1) Prepare env file

Create `.env.local` in the project root (or copy from `.env.example`) and fill in real values.

## 2) Start on server

```bash
docker compose up -d --build
```

## 3) Open the app

Visit:

```text
http://<your-server-ip>:3001
```

## Useful commands

```bash
# Tail logs
docker compose logs -f

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
