# ⬡ HexJourney

Hexagonal map builder for D&D **hexcrawl**: predefined tiles, overlays
(anchor-based roads/rivers, symbols, snow/volcanic/ice effects), **fog of war**,
exploration with **line-of-sight** and travel times/distances (map scale +
transport vehicle), local saving and JSON import/export, and **realtime shared
exploration** between the DM and the players.

**Cloudflare-ready** architecture: SPA frontend on **Cloudflare Pages**, realtime on
**Cloudflare Workers + Durable Objects** (WebSocket Hibernation API). No Node/Fastify
backend to manage.

Created by **[TirateIniziativa](https://linktr.ee/TirateIniziativa)**.

---

## 1. Architecture

Monorepo (npm workspaces):

```
/
├── client/   SPA Vite + React 19 + TypeScript + PixiJS 8 + zustand 5 + dexie 4
│             → deployed to Cloudflare Pages (output client/dist/)
├── worker/   Cloudflare Worker (router) + Durable Object "HexSession"
│             → deployed with Wrangler
├── shared/   @hexjourney/shared: shared types and protocol (model/ protocol/)
├── package.json (workspaces + root scripts)
├── tsconfig.base.json
└── README.md
```

- **client** — the editor/viewer. Live state in **zustand**; local persistence in
  **IndexedDB (Dexie)**. Rendering with **PixiJS v8** (culling + sprite pool). The
  model types come from `@hexjourney/shared`.
- **worker** — a "router" Worker that holds **no state**: it routes requests to the
  session's Durable Object.
  - `GET /health` → `{ ok: true }`
  - `POST /session` → `{ sessionId }` (random 6-character code)
  - `GET /session/:id/websocket` → WebSocket upgrade to the DO `idFromName(id)`
- **Durable Object `HexSession`** — authoritative for **one** session:
  - holds the `MapDocument` (in-memory cache + persistence in `ctx.storage`
    SQLite → eligible for the **free plan**);
  - **WebSocket Hibernation API** (`acceptWebSocket`, `webSocketMessage`,
    `webSocketClose`); per-socket role/name/id via `serializeAttachment`;
  - **DM authority**: applies `patch`/`fogUpdate`/`fullState` only from the DM,
    broadcasts to everyone, sends `fullState` on entry and `presence` to those
    present;
  - validates every incoming message (it never trusts the client).
- **shared** — single source of truth for `MapDocument`, `HexTile`, `FogState`,
  etc. and for the **discriminated protocol** (`type`). Consumed both by the client
  (Vite) and the worker (Wrangler/esbuild) via workspace resolution.

### Realtime protocol (`@hexjourney/shared/protocol`)

Client → Server: `join { sessionId, role, name?, map? }` · `patch { tileKey, tile }`
· `fogUpdate { tileKey, fog }` · `fullState { map }` (DM bulk operations) ·
`requestFullState`.

Server → Client: `fullState { map }` · `patch` · `fogUpdate` ·
`presence { players }` · `error { message }`.

The DM creates/initializes the session by providing `map` in the `join`; the
`sessionId` is in the URL (no more `welcome`). Reconnection: the re-entry `join`
makes the DO resend `fullState`.

---

## 2. Local development

### Requirements
- Node.js 20+ (tested with Node 24), npm 9+.

### Installation (from the root)
```bash
npm install            # install all workspaces (client, shared, worker)
```

### Start
```bash
npm run dev            # start client (Vite) and worker (wrangler dev) TOGETHER
```
- Frontend: <http://localhost:5173>
- Worker:   <http://localhost:8787> (`/health`, `POST /session`, WebSocket on
  `/session/:id/websocket`)

Or separately:
```bash
npm run dev:client     # Vite only (port 5173)
npm run dev:worker     # wrangler dev only (port 8787)
```

Configure the worker URL for the client by copying the example:
```bash
cp client/.env.example client/.env       # VITE_WORKER_WS_URL=ws://localhost:8787
```
Without `.env`, the client defaults to `ws://localhost:8787`.

---

## 3. Build / typecheck
```bash
npm run build:client   # client/dist (tsc -b && vite build)
npm run typecheck      # typecheck client + worker
npm run preview:client # preview of the client build
```

---

## 4. Deploy to Cloudflare

Frontend and worker are deployed **separately**. You need a Cloudflare account and
`wrangler` (included as a dev dependency of the worker).

### 4a. Worker (Cloudflare Workers + Durable Objects)
```bash
npx wrangler login                 # once
npm run deploy:worker              # = wrangler deploy (in worker/)
```
- Config in `worker/wrangler.jsonc` (binding `HEX_SESSIONS` + Durable Object
  `HexSession` with `new_sqlite_classes` → compatible with the free plan).
- At the end of the deploy Wrangler prints the worker URL, e.g.
  `https://tristora-hexcrawl-worker.<account>.workers.dev`.
- Verify: `curl https://<worker-domain>/health` → `{"ok":true}`.

### 4b. Frontend (Cloudflare Pages)
Create a Pages project linked to the repo with:
- **Root directory**: `client`
- **Build command**: `npm install && npm run build` (or, from the monorepo,
  `npm install && npm -w client run build` from the root)
- **Build output**: `dist`
- **Environment variable**: `VITE_WORKER_WS_URL = wss://<worker-domain>`
  (the worker domain from step 4a, with the `wss` scheme).

> Monorepo note: if Pages is set with root `client/`, the Pages `npm install`
> installs the `client` workspace and links `@hexjourney/shared`. Alternatively,
> set the project root = repo and the build to `npm -w client run build` with
> output `client/dist`.

### 4c. SEO and domain
The client includes SEO metadata (`title`, `description`, keywords, Open Graph,
Twitter card, `robots`, `canonical`, indexable `<noscript>` fallback),
`favicon.svg`, `site.webmanifest`, `robots.txt` and `sitemap.xml` (in
`client/public/`, served at the root). **After choosing the domain**, replace the
placeholder `https://hexjourney.pages.dev` with the real one in
`client/index.html` (`canonical`, `og:url`, `og:image`), `client/public/robots.txt`
and `client/public/sitemap.xml`. For social previews a raster `og:image` 1200×630 is
also recommended (it currently points to `favicon.svg`).

---

## 5. DM ↔ player session test (locally)
1. `npm run dev` (client on :5173, worker on :8787).
2. Open <http://localhost:5173> as the **DM**, create or load a map.
3. **Session → Create session**: the client calls `POST /session`, gets a code and
   connects sending the map. Copy the **player link**.
4. In a second window/incognito open the link `(/?session=CODE&role=player)` or
   **Session → paste the code → Join**.
5. The player enters in **read-only** mode and receives the map with the fog applied.
6. Paint hexes / change fog as the DM: the player sees the updates in real time.
   Changes sent by a player are **rejected**.
7. Close and reopen the player tab: on reconnection they receive the full state
   again (`requestFullState`/`join`).

---

## 6. Export / Import

**Export/Import** button. All formats are JSON with `schemaVersion`.
- **Full map** — the whole `MapDocument` (world + exploration).
- **Clean map** — world with exploration reset (fog `hidden`, travel 0), players'
  initial LoS re-applied.
- **Exploration only** — `{ fog, playerPos, travelDays, travelDistanceKm }`.
- **Image (.png)** — the whole map.

Mirror import; for exploration-only it checks that the `mapId` matches. Local
persistence (Dexie) is **distinct** from the realtime session: the local autosave
does not go through the worker, while the shared state lives in the Durable Object.

---

## 7. Technical notes

- **Coordinates** (Red Blob Games): axial `(q,r)` for storage (key `"q,r"`), cube
  for the algorithms (distance, neighbors, lines, ranges). Pixel geometry via
  honeycomb-grid v4, single source of truth (`client/src/hex/layout.ts`).
- **Fog inside the `MapDocument`**: exploration is game state and lives in the
  `tiles` (the `fog` field), not separate from the world.
- **DM authority**: only the DM modifies the world and the fog; the Durable Object
  ignores/rejects players' edit messages.
- **Authoritative state in the Durable Object**: one DO per `sessionId`
  (`idFromName`); `ctx.storage` (SQLite) persists the `MapDocument` during the
  session and beyond a restart. The map is stored as a single value (~2 MiB limit;
  very large maps would need per-tile splitting — TODO).
- **Local Dexie persistence distinct from the live session**: the client saves its
  own maps in IndexedDB; the shared session is independent.
- **Travel**: times/distances derived from map scale + vehicle (see `client/src/
  data/travel.ts`), with per-vehicle passability (e.g. boat on rivers, non-navigable
  ice) and `Nd Nh Nm` display + distance in km/mi.
- **Stack**: Vite 6 · React 19 · TypeScript 5.6 (strict) · PixiJS 8 · honeycomb-
  grid 4 · zustand 5 · dexie 4 · Wrangler 4 · `@cloudflare/workers-types`.

Details of the migration from Node/Fastify to Cloudflare: see
[`MIGRATION.md`](./MIGRATION.md).

---

## Credits

HexJourney is created by **TirateIniziativa**.

- 🔗 All links: <https://linktr.ee/TirateIniziativa>

If you use the app for your campaigns, a hello and a follow are always appreciated!
