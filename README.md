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
- **Full map** — the whole `MapDocument` (world + exploration + **weather**).
- **Clean map** — world with exploration reset (fog `hidden`, travel 0, **weather
  reset to sunny/spring**), players' initial LoS re-applied.
- **Exploration only** — `{ fog, playerPos, travelDays, travelDistanceKm, weather }`.
- **Image (.png)** — the whole map.

The weather is part of the exploration/campaign state (it lives in
`MapDocument.weather`), so it follows the same three export modes.

Mirror import; for exploration-only it checks that the `mapId` matches. Local
persistence (Dexie) is **distinct** from the realtime session: the local autosave
does not go through the worker, while the shared state lives in the Durable Object.

**Preset (built-in) maps** — the **Maps** panel lists ready-to-load maps that ship
with the app and are available to **every** user and session (e.g. *Tristora*).
They are static assets under `client/public/presets/` and registered in
`client/src/data/presets.ts`; loading one creates an independent working copy (fresh
id), which the DM can then edit, save locally, and share in a realtime session like
any other map.

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

## 8. Dynamic weather

The campaign has a dynamic weather system that also affects exploration/travel
times. It lives in `MapDocument.weather` (`WeatherState = { current, season,
consecutiveDays, previous?, lastUpdatedTurn? }`), so it is part of the
exploration/campaign state — not the permanent geography. Every new map/session
starts at **sunny / spring**; old maps without a `weather` field are normalised to
that default on load (`ensureWeatherState`).

**Weighted algorithm** (`client/src/data/weather.ts`, tunable data in
`client/src/data/weatherRules.ts`) — the next-day weather is chosen from a *weight*
pipeline, not hard-coded percentages:

1. `getBaseSeasonWeights(season)` — base weights per season.
2. `applyScaleLatitudeModifiers(...)` — **north/south** only on `kingdoms`/
   `continents` maps: the band is derived from the tile's `r`. Winter north →
   more snow/blizzard; winter south → more rain; summer south → more heatwave;
   summer north → less heatwave.
3. `applyTerrainModifiers(...)` — current tile **+ its 6 neighbours**: mountains/
   snow/adjacent-snow boost snow/blizzard; desert/adjacent boosts sunny/heatwave and
   **enables** sandstorm (and cuts rain/snow); volcano/volcanic **enables** ashfall
   and (only on the volcanic tile) rare eruption — adjacency enables ashfall but not
   eruption; swamp/water boost fog/rain; forest a little.
4. `applyContinuityModifiers(...)` — **inertia**: the current weather gets a bonus
   that decays with `consecutiveDays` and eventually drops below its base
   probability (e.g. rain ≈ 50 % → 40 % → 29 % → 19 % → 12 %). Per-type curves in
   `WEATHER_CONTINUITY` (sunny/ashfall persist; storm/blizzard/eruption are brief).
5. `normalizeWeights` → `weightedRandom(rng)` (rng is injectable for tests).

The DM can also set the weather **manually** (no roll; `consecutiveDays` resets to
1). A roll happens on **Advance day** and on each **adjacent move / shortest-path
move** (the travel cost then uses the updated weather). `rollWeather` returns the
`probabilities` and a `reasonSummary` (i18n keys), shown to the DM.

**Weather travel modifiers** — the travel-time engine is a single **modifier
pipeline** (`computeTravel` in `client/src/data/travel.ts`); `crossingDays` is a thin
wrapper over it, so pathfinding and time accrual automatically include weather.
Order of application:

1. base terrain time (terrain × vehicle × scale — unchanged);
2. overlay modifiers (road/river/snow/volcanic/symbol);
3. weather base modifier (terrain-aware: e.g. rain ×1.15, ×1.35 on swamp; storm
   ×1.75 in mountains; snow ×2.0 on snow overlay; sandstorm ×2.0 in desert, ×1.5
   near desert; ashfall ×1.75 near a volcano);
4. weather+terrain contextual modifiers (extra multiplier or block: rain+swamp,
   storm+mountain, snow+mountain, fog+forest/swamp, heatwave+desert,
   sandstorm+desert, ashfall+volcanic, **volcanicEruption+volcanic = blocked**);
5. cap: the product of the modifiers is capped at `WEATHER_TRAVEL_CAP` (×3.0) unless
   movement is blocked; a warning is surfaced when the cap bites;
6. final result as `TravelTimeResult { baseDays, finalDays, blocked, modifiers[],
   warnings[] }` — the DM panel shows base time, each modifier, the total and any
   block. With `sunny`/`cloudy` there are no weather modifiers, so times are
   identical to before the feature (backward-compatible).

Some weathers **block** movement outright (`blocksMovement`): blizzard on
mountain/water, sandstorm in desert, storm for small boats on water, eruption on the
volcanic tile.

**UI** (Exploration tab): season selector, current-weather selector (manual
override), consecutive-days readout, **Advance day** button, next-day forecast bars,
factor log, and a **Travel effects** panel for the party's current hex. Players see a
read-only version (current weather + effects); only the DM can change it.

**Realtime** — the weather is stored in the `MapDocument`, so it synchronises over
the **existing `fullState` channel** (GM-authoritative): when the DM changes the
season/weather, rolls, or advances a day, the Durable Object rebroadcasts the state
and players update. Players cannot change it (the DO rejects non-DM edits) — no extra
protocol messages were needed.

---

## 9. Random events

An optional, data-driven random-events system under the **Exploration** tab, built
like the weather (weighted pipeline + dynamic modifiers). It lives in
`MapDocument.randomEvents` (`RandomEventsState`), part of the exploration/campaign
state; disabled by default, and old maps are normalised on load.

**Categories & base weights** (weights, not isolated percentages):

| Event | Weight |
|---|---|
| extremelyPositive | 1 |
| veryPositive | 6 |
| positive | 13 |
| none | 60 |
| negative | 13 |
| veryNegative | 6 |
| extremelyNegative | 1 |

**Weighted pipeline** (`client/src/data/randomEvents.ts`, config in
`randomEventRules.ts`): base → terrain → overlay → weather → no-event momentum →
positive/negative cooldown → normalize → `weightedRandom(rng)`.

- **Terrain**: plains/desert raise `none` (fewer events); forest/mountain/mesa lower
  `none` and raise positive/negative (a little the "very" tiers, barely the
  "extremely" ones); hills/water/deepwater/swamp are neutral.
- **Overlay**: road/snow/ice lower events; river/volcanic(land)/shoal raise them.
  **coralReef conflict** (listed as both): resolved explicitly — reef **on water**
  raises events (navigation hazards), reef **on land** lowers them. Settlement
  overlays (ruins/village/city/fortress/cave/sanctuary/oasis/dungeon) **do not**
  trigger events by their mere presence (no modifier).
- **Weather**: sunny → slightly more `none`, fewer extremes; storm/blizzard/
  sandstorm/ashfall → much less `none`, more negative/very-negative;
  volcanicEruption → almost always negative, `none` collapses, positives ≈ 0. Full
  table in `WEATHER_EVENT_MODS`.
- **No-event momentum**: each event-less step lowers `none` progressively (with a
  floor, never 0) and slightly boosts event categories.
- **Cooldown**: a confirmed positive event sets `positiveCooldownSteps = 5`; the
  same polarity is ~0 on the next step and recovers over 5 steps (curve
  `5→0.0 … 0→1.0`). Same for negatives. On a `none` roll the cooldowns tick down by 1.

**DM ↔ player.** Only the DM enables events, generates/rolls, and confirms /
discards / manually replaces the proposal. On movement (adjacent or shortest-path)
or with **Generate event**, a roll happens on the destination tile:

- `none` → applied immediately (momentum/cooldown update), nothing shown to players;
- non-`none` → a **proposed event** shown to the DM only. **Confirm** applies it and
  reveals it to players; **Discard** is a full revert of the roll (pre-roll state
  restored, no cooldown/momentum change); **Choose this** treats a manually picked
  event as generated. The panel shows current probabilities, the factors that fired,
  and the last confirmed event.

**Security / realtime.** The **proposed** event and its snapshot live **only in the
DM's client** (transient state) and are never synced. Only the persistent state
(enabled / lastConfirmedEvent / lastConfirmedTile / steps / cooldowns) rides the
existing GM-authoritative `fullState` channel, so players receive **only confirmed
events** — never the pending one — with no extra protocol messages and no worker
changes. The **player view** shows whether events are active and, of the confirmed
events, **only the one attached to the party's current hex** (`lastConfirmedTile`):
moving onto a hex without a confirmed event shows none.

**Export/import.** `randomEvents` is exploration/campaign state: the full map and the
exploration-only export include it; the clean map resets it to defaults (disabled).

---

## Credits

HexJourney is created by **TirateIniziativa**.

- 🔗 All links: <https://linktr.ee/TirateIniziativa>

If you use the app for your campaigns, a hello and a follow are always appreciated!
