# Arabic News Aggregator (Egypt-first)

A "Nabd"-like Arabic mobile news aggregator. Monorepo with pnpm workspaces.

## Stack
- **apps/server** — Node 22 + Hono + fast-xml-parser. Fetches RSS and Google News RSS feeds and stores articles in JSON files under `DATA_DIR` (no SQLite, no Supabase — see `docs/adr/0002`). Push goes to FCM HTTP v1 directly (`docs/adr/0003`).
- **apps/mobile** — Expo + expo-router + TypeScript. Arabic RTL UI, calls server JSON API.

## Quick start

```bash
pnpm install

# Server (dev, hot TS)
pnpm --filter @news/server dev        # http://localhost:3001

# Tests
pnpm --filter @news/server test       # vitest
pnpm --filter @news/mobile test       # node checks + jest component tests

curl http://localhost:3001/api/feed | python3 -m json.tool | head -40
```

Production runs on a GCP VM with Docker Compose + Caddy at
`https://news.nileorbit.com`; pushing to `main` deploys. The Android APK is built
only on GitHub Actions and published as a GitHub Release (`docs/adr/0004`).

## API

| Endpoint | Description |
|---|---|
| `GET /api/feed?limit=50&offset=0` | Paginated article feed, newest first |
| `GET /api/sources` | List all sources |
| `GET /api/articles/:id` | Single article by id |

## Sources

| ID | Name | Type |
|---|---|---|
| youm7 | اليوم السابع | Google News RSS |
| aljazeera | الجزيرة | Direct RSS |
| bbc-arabic | بي بي سي عربي | Direct RSS |
| cnn-arabic | سي إن إن عربي | Direct RSS |
| skynews-arabia | سكاي نيوز عربية | Direct RSS |
| rt-arabic | آر تي عربي | Direct RSS |
| alarabiya | العربية | Google News RSS |
| ahram | الأهرام | Google News RSS |
| almasry | المصري اليوم | Google News RSS |
| masrawy | مصراوي | Google News RSS |
