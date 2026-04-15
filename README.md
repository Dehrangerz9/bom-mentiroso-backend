# Bom Mentiroso — Backend

Node.js + Express + Socket.IO backend for the Bom Mentiroso gameshow app.

## Local development

```bash
npm install
npm run dev        # ts-node-dev, restarts on changes — runs on port 2999
```

## Deploy

> **Important**: This server uses **WebSockets** (Socket.IO). Vercel serverless functions do **not** support persistent WebSocket connections. Use one of the platforms below instead.

### Railway (recommended)

1. Push the repo to GitHub.
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Select the repo. If it is a monorepo, set the **Root Directory** to `backend`.
4. Railway auto-detects Node.js. Verify the following in **Settings → Build & Deploy**:
   - **Build command**: `npm run build`
   - **Start command**: `npm start`
5. Add environment variables in **Variables**:

   | Name | Value |
   |---|---|
   | `PORT` | `2999` (Railway may override this with its own `PORT` — that is fine) |
   | `FRONTEND_URL` | `https://your-vercel-frontend-url.vercel.app` |

6. Railway provides a public URL (e.g. `https://bom-mentiroso-backend.up.railway.app`). Copy it.
7. Set `REACT_APP_BACKEND_URL` in the frontend Vercel project to that URL and redeploy.

### Render

1. Go to [render.com](https://render.com) → **New Web Service**.
2. Connect the GitHub repo. Set the **Root Directory** to `backend`.
3. Configure:
   - **Build command**: `npm install && npm run build`
   - **Start command**: `npm start`
   - **Instance type**: Free or Starter
4. Add environment variables:

   | Name | Value |
   |---|---|
   | `PORT` | `2999` |
   | `FRONTEND_URL` | `https://your-vercel-frontend-url.vercel.app` |

5. Click **Create Web Service**. Render provides a public URL — copy it to `REACT_APP_BACKEND_URL` in Vercel.

> **Free tier note on Render**: Free instances spin down after 15 minutes of inactivity and take ~30 s to wake up on the next request.

### Fly.io

```bash
npm install -g flyctl
flyctl auth login

# From the backend/ directory:
flyctl launch        # follow prompts, choose a region
flyctl secrets set FRONTEND_URL=https://your-vercel-frontend-url.vercel.app
flyctl deploy
```

---

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Port the server listens on | `2999` |
| `FRONTEND_URL` | Allowed CORS origin (your Vercel frontend URL) | `http://localhost:3000` |

These are read from a `.env` file locally (not committed). Set them as platform environment variables in production.

## Project structure

```
src/
  index.ts          # Express + Socket.IO server, all game logic
  types.ts          # TypeScript types (GameRoom, Player, etc.)
  mockData.ts       # categories list
  data/
    questions.json  # question deck (also served as /questions.json for the presenter deck viewer)
.env                # local development env (not committed)
.env.production     # template for production values
```

## Build

```bash
npm run build       # compiles TypeScript → dist/
npm start           # runs dist/index.js
```
