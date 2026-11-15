# Arabic News Aggregator (Egypt-first)

A "Nabd"-like Arabic mobile news aggregator. Monorepo with pnpm workspaces.

## Stack
- **apps/server** — Node.js + Hono + better-sqlite3 + fast-xml-parser. Fetches RSS feeds, caches in SQLite.
- **apps/mobile** — Expo + expo-router + TypeScript. Arabic RTL UI, calls server JSON API.

## Quick start

```bash
# Server (T1)
cd apps/server
npm install
node --experimental-specifier-resolution=node --loader ts-node/esm src/index.ts

# Test acceptance
curl http://localhost:3001/api/feed | python3 -m json.tool | head -40
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/feed?limit=50&offset=0` | Paginated article feed, newest first |
| `GET /api/sources` | List all sources |
| `GET /api/articles/:id` | Single article by id |

## Sources

| ID | Name | Type |
|---|---|---|
| youm7 | اليوم السابع | Direct RSS |
| aljazeera | الجزيرة | Direct RSS |
| bbc-arabic | بي بي سي عربي | Direct RSS |
| cnn-arabic | سي إن إن عربي | Direct RSS |
| skynews-arabia | سكاي نيوز عربية | Direct RSS |
| rt-arabic | آر تي عربي | Direct RSS |
| alarabiya | العربية | Google News RSS |
| ahram | الأهرام | Google News RSS |
| almasry | المصري اليوم | Google News RSS |
| masrawy | مصراوي | Google News RSS |
