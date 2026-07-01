# CLAUDE.md — HexJourney

Operating guide for working on this project. Read it before changing the code.

## What it is

**HexJourney** (by **TirateIniziativa**): web app for building hexagonal maps for
D&D **hexcrawl** — predefined tiles, overlays, roads/rivers, **fog of war**,
**exploration** with line-of-sight + travel time, local saving, JSON import/export,
and **realtime GM↔players sharing**.

Project root: `C:\TirateIniziativa\HexJourney`. It **is** a git repo (branch `main`,
remote `origin` → `https://github.com/tirateiniziativa/HexJourney.git`). **npm
workspaces monorepo**: `client/` (Vite SPA → Cloudflare Pages), `worker/`
(Cloudflare Worker + Durable Object → Wrangler), `shared/` (`@hexjourney/shared`:
shared types + protocol). The old Node/Fastify backend in `server/` has been
**removed** (migration to Cloudflare; see `MIGRATION.md`).

## Conventions (important)

- **Reply to the user in Italian.** The user gives requirements in Italian.
- **Internationalized UI strings (i18n), default language English.** Every
  displayed text goes through `t('key', params?)` (the `useT` hook in `src/i18n/`);
  the translation tables cover 6 languages (en/it/fr/de/es/pt). Do NOT hardcode UI
  text: add a key in `src/i18n/index.ts` (in all languages) and use it.
  **Code comments in Italian; code identifiers in English.** The master's displayed
  label is **"DM"** (the internal enum stays `mode: 'gm'`).
- **Verify every change that is actually observable in the browser** before
  reporting: `npm run build` (types) → MCP preview (screenshot +
  `preview_console_logs level:error`). Don't ask the user to test by hand. Close
  with a concise summary of what you tested and the outcome.
- TS is in `strict` with `noUnusedLocals`/`noUnusedParameters`: remove unused
  imports and variables or the build fails.

## Stack (real versions, "latest stable", nothing deprecated)

Vite 6.4 · React 19.2 · TypeScript 5.6 · PixiJS 8.19 (**async init** `await
app.init`, NOT the v7 constructor) · honeycomb-grid 4.1 · zustand 5.0 · dexie 4.4.
Realtime backend: **Cloudflare Workers + Durable Objects** (WebSocket Hibernation
API) via **Wrangler 4** + `@cloudflare/workers-types`. Environment: Node 24.

## Commands (from the root)

```bash
npm install             # install all workspaces (client/shared/worker)
npm run dev             # client (Vite :5173) + worker (wrangler dev :8787) together
npm run dev:client      # Vite only -> http://localhost:5173
npm run dev:worker      # wrangler dev only -> :8787 (/health, POST /session, /session/:id/websocket)
npm run build:client    # tsc -b && vite build (client -> client/dist/)
npm run preview:client  # preview of the client build
npm run typecheck       # typecheck client + worker
npm run deploy:worker   # wrangler deploy (in worker/)
```

Worker URL for the client: `VITE_WORKER_WS_URL` (default `ws://localhost:8787`; in
prod `wss://<worker-domain>`), see `client/.env.example`. Per-workspace builds:
`npm -w client run ...` / `npm -w worker run ...`. Worker dry-run: `npm -w worker
run dry-run` (`wrangler deploy --dry-run`).

## Architecture

### Structure

```
shared/        @hexjourney/shared (workspace package, SOURCE of the types)
  model/map.ts   data model + helpers + validators (isHexTile/isMapDocument/…)
  protocol/messages.ts  discriminated protocol (ClientToServer/ServerToClient)
client/        Vite SPA (workspace @hexjourney/client)
  src/
    hex/         coordinates (axial storage, CUBE algorithms), layout
                 (honeycomb v4), los, pathfind (Dijkstra + road preference)
    model/types.ts  re-exports from @hexjourney/shared/model (legacy import point @/model/types)
    store/       mapStore.ts — zustand, the ONLY source of local state (no localStorage)
    render/      PixiManager (engine), HexCanvas, rendererRef
    ui/          Toolbar (+ language + distance unit), Palette, Legend, *Dialog/*Panel, StatusBar
    i18n/        index.ts (Lang, LANGS, DEFAULT_LANG='en', 6 languages) + useT.ts
    persistence/ db (Dexie), io (export/import; errors = i18n KEYS), useAutosave
    sync/        protocol (Worker URL config + alias), SyncClient (per-session WS), bridge, useSync
    data/        tiles.json, catalog, travel (crossingDays/canEnter/formatTravel/…)
worker/        Cloudflare Worker (workspace @hexjourney/worker)
  src/index.ts        router (/health, POST /session, /session/:id/websocket → DO)
  src/HexSession.ts   Durable Object (Hibernation API, SQLite storage, DM authority)
  src/validation.ts   message parsing/validation (uses the shared validators)
  src/types.ts        Env (HEX_SESSIONS binding)
  wrangler.jsonc      DO binding + new_sqlite_classes (free plan)
```

### Data model (`src/model/types.ts`)

```ts
FogState = "hidden" | "explored" | "visible"
Edge = 0..5
HexPath = { kind: string; edges: Edge[] }        // 2 sides=arc, 3=junction; non-adjacent sides
HexTile = { terrain; overlay?; rotation; fog; paths?: HexPath[]; snow?; volcanic?; ice? }
MapScale = 'local' | 'regional' | 'kingdoms' | 'continents'
Vehicle  = 'foot' | 'horse' | 'carriage' | 'caravan' | 'boat' | 'ship'
MapDocument = {
  schemaVersion; id; name; orientation; shape?; hexSize; width; height;
  tiles: Record<"q,r", HexTile>;   // fog lives HERE (exploration = game state)
  playerPos?: {q;r}; travelDays?: number; travelDistanceKm?: number;
  hoursPerDay?: number; scale?: MapScale; vehicle?: Vehicle;
}
ExplorationDocument = { schemaVersion; mapId; fog; playerPos?; travelDays?; travelDistanceKm? }
```
Terrains (10): plains, forest, mountain, hills, desert, **mesa**, swamp, **volcano**,
**water, deepwater** (`isWaterTerrain`). Overlays: linear `river`/`road` (anchors);
**whole-tile effects** (`shape:'effect'`, veils on `HexTile.snow/volcanic/ice`,
mutually exclusive): `snow` (white, land), `volcanic` (red, land), `ice` (light
blue, water); symbols `ruins/village/city/fortress/cave/sanctuary/dungeon/oasis`
(land) + `reef/shoal` (water). Every overlay has an `on` of `'land'|'water'|'both'`
(`overlayAllowedOn`). Helpers: `keyOf/parseKey`, `getTile`, `altitudeOf` (Mountain/
Volcano +2, Hills/Mesa +1, others 0), `edgesAdjacent`, `nextRotation`, `isWaterTerrain`.

### Key decisions

- **i18n**: `store.lang` (default `'en'`, **not persisted** → reverts to English on
  reload) drives `useT()`. Terrain/overlay names are translated by id
  (`t('terrain.<id>')` / `t('overlay.<id>')`); the `name` fields in `tiles.json`
  remain only as a fallback. `formatTravel` receives the translated day/hour
  abbreviations (`unit.day`/`unit.hour`). The error messages from `parseImport` are
  i18n KEYS, translated by the caller. Server-side `error` messages are NOT
  translated per-client.
- **Coordinates**: axial `(q,r)` for storage (key `"q,r"`); cube for the algorithms
  (distance, neighbors, lines, `cubeRange`/`cubeRing`). Pixel geometry
  (center/corners/`pointToAxial`) lives ONLY in `hex/layout.ts` via honeycomb, so
  rendering and hit-testing stay consistent. Rectangle = `rectangle` traverser;
  hexagonal = cube disc.
- **Rendering (PixiManager)**: a pannable/zoomable *world* `Container`; layers from
  the bottom: terrain, paths (Graphics), symbol-overlay, fog, players border
  (Graphics), anchors (Graphics), hover. **Viewport culling + sprite pool** (terrain/
  overlay/fog have dedicated pools): only the visible hexes are drawn, no per-frame
  redraw. Textures generated at runtime. **Aesthetic option A (procedural motifs)**:
  no more flat tinted-color tiles — there is **one texture per terrain**
  (`terrainTextures`) with the base color + a small vector motif (baked in, no tint)
  drawn by `drawTerrainMotif` (grass/trees/peaks/waves/dunes/reeds/hills), plus a
  `''` texture for the empty hex. The **symbol-overlays** (ruins/settlement) also
  have color+motif baked in via `drawOverlayMotif`: compact, outlined emblems that do
  NOT fill the hex, so the terrain underneath stays readable. The motifs stay within
  ~0.6·`hexSize` (valid for pointy and flat). `exportPNG` renders the whole map in
  phases onto a temporary container.
- **Fog / modes**: same `MapDocument` for GM and Player. The GM sees everything with
  a light veil over hidden/explored; the Player: hidden covered, explored dimmed,
  visible full (read-only). Manual fog brush + Reveal/Hide all.
- **Exploration (LoS)**: `playerPos` with a blue border. LoS by terrain+altitude
  (see `hex/los.ts`): Plains/Water=dist1; Forest/Desert/Swamp=self only;
  Mountain=dist1 + dist2 if the intermediate has altitude<2; Hills=dist1 + dist2 if
  <1. (Snow is now an overlay, not a terrain; Deepwater uses the Water rule.) When
  moving the players: hexes in LoS→visible, those that left the view→explored.
  Automatic exploration happens ONLY for: adjacent step, first position, and "follow
  shortest path". "Move without travel" and "manual hours" move WITHOUT exploring.
  **You cannot move the players where the active vehicle can't go**
  (`requestMovePlayers` checks `canEnter`).
- **Travel time/distance (CSV engine, `data/travel.ts`)**: the costs derive from the
  "hexcrawl percorrenze" CSV. `crossingDays(doc,key) = km_hex(scale) / km_day(vehicle,
  terrain) × terrain_multiplier × ∏ overlay_mod`; `Infinity` if impassable. Scale
  (`SCALES`: local 3mi/4.8km, regional 6/9.7, kingdoms 15/24, continents 30/48;
  default regional) and vehicle (`VEHICLES`; default foot) live IN the doc. Terrain
  multipliers and km/day are constant across scales (only km_hex changes). Overlay
  mods: road (0.85/0.7/0.65/0.8 for foot/horse/carriage/caravan), river (land 1.15;
  boat 0.75; ship 0.9), snow (1.75/2.0/3.0/2.5; water 1.1), **volcanic land**
  (2.0/2.25/3.0/2.75), oasis 0.9 on desert only; **gap-fill**: reef 1.2 / shoal 1.15
  for water vehicles. **Volcano**: terrain, multiplier 3.0, LoS like Mountain.
  **Mesa**: terrain, multiplier 1.75, LoS like Hills.
  Passability (`canEnter`/`canEnterTile`): land vehicles not on water;
  carriage/caravan on mountain+**volcano** (and carriage on swamp) only with a Road;
  water vehicles only on water, BUT the **boat goes up Rivers** on land (ship can't).
  **Ice** (`ice`): frozen water blocks water vehicles but is crossable by land
  vehicles at great difficulty (terrain km/day × `ICE_LAND_MULT`=3.0).
  `travelDays`/`travelDistanceKm` accumulate (`undefined`=N/A); distance in km, shown
  in km or mi (UI preference `store.distanceUnit`, selector at the top right). Time
  display `Nd Nh Nm` (minutes) via `formatTravel`; distance via `formatDistance`.
  **±¼ day** buttons (`adjustTravelDays`). Non-adjacent move → popup (without travel /
  manual hours / shortest path); only adjacent and shortest path add time+distance.
  `pathfind` skips impassable hexes and keeps the lexicographic road preference.
  Undo/Reset time/Reset exploration also cover distance.
- **Weather (dynamic)**: lives in `MapDocument.weather` (`WeatherState`, part of
  exploration/campaign state), default sunny/spring; old maps normalized via
  `ensureWeatherState`. Weighted pipeline in `data/weather.ts` (config in
  `data/weatherRules.ts`): season base → latitude (north/south, only kingdoms/
  continents) → terrain+6 neighbors → continuity (inertia) → normalize →
  `weightedRandom(rng)`. `rollWeather` returns probabilities + `reasonSummary`
  (i18n keys). A roll fires on Advance day and on adjacent/shortest-path moves; the
  DM can also set it manually (no roll). **Travel** is a single modifier pipeline
  (`computeTravel` → `TravelTimeResult`; `crossingDays` wraps it): base → overlay →
  weather base (terrain-aware) → weather+terrain combos → cap `WEATHER_TRAVEL_CAP`
  (×3, unless `blocksMovement`). Sunny/cloudy add no modifiers (backward-compatible).
  Realtime: synced via the **existing `fullState`** path (GM-authoritative), no new
  protocol messages. UI in `ui/WeatherPanel.tsx` (Exploration tab; read-only for
  players).
- **Roads/rivers (linear overlays)**: they are NOT symbol-overlays, they are
  **anchor-based paths** (`HexTile.paths`). Guided selection: click an anchor (a
  side), work on both hexes of that side; usable anchors (non-adjacent) have a yellow
  border; 2 exits=arc, 3=junction; selected yellow, used blue. An element is
  edited/deleted only by re-selecting its anchors.
- **Persistence/export**: Dexie saves the whole doc (autosave debounced 700ms,
  exploration included). Export: full map / clean map (exploration reset, initial LoS
  re-applied) / exploration only (`{fog, playerPos, travelDays, travelDistanceKm}`) /
  PNG. All JSON with `schemaVersion`; mirror import with `mapId` check.
  `scale`/`vehicle` are optional doc fields (backward-compatible, preserved in saving
  and in sync).
- **Realtime (Cloudflare Workers + Durable Objects)**: the Worker (`worker/src/
  index.ts`) only routes; `GET /session/:id/websocket` → DO
  `HEX_SESSIONS.idFromName(sessionId)`. The **Durable Object `HexSession`** is
  authoritative for the session: `MapDocument` in `ctx.storage` (SQLite) + in-memory
  cache; **WebSocket Hibernation API** (`acceptWebSocket`/`webSocketMessage`/
  `webSocketClose`, role/name/id metadata via `serializeAttachment`). The DM emits
  `patch`/`fogUpdate` per single hex and `fullState` for bulk operations
  (revealAll/hideAll, resize, move/undo, reset, name, hoursPerDay, scale, vehicle,
  ±¼ day). Players are read-only: the DO rejects their edits with `error`. The client
  (`client/src/sync/SyncClient.ts`): the DM does `POST /session` for the code and
  connects sending the `map` in the `join`; no more `welcome` (role known
  client-side, sessionId in the URL); reconnection via `join` which makes the server
  resend `fullState`.

### Realtime protocol (`@hexjourney/shared/protocol`, discriminated by `type`)

| Message | Direction | Meaning |
|---|---|---|
| `join { sessionId, role, name?, map? }` | client→server | entry; the DM with `map` initializes the DO |
| `patch { tileKey, tile }` | client→server | single hex (DM only) |
| `fogUpdate { tileKey, fog }` | client→server | fog of one hex (DM only) |
| `fullState { map }` | bidir. | DM: bulk operations · server: snapshot to whoever joins/resyncs |
| `requestFullState` | client→server | resync |
| `presence { players }` | server→client | present (id/role/name) |
| `error { message }` | server→client | error (e.g. an edit from a player) |

Worker HTTP routing: `GET /health` → `{ok:true}`; `POST /session` → random
`{sessionId}`; `GET /session/:id/websocket` → upgrade to the DO.

## Development workflow and pitfalls (high value)

- **Monorepo workspaces**: run the scripts from the **root** (`npm run build:client`,
  `npm run dev:client`, `npm -w worker run ...`). The **Bash tool's cwd persists**: a
  previous `cd .../worker` changes where commands run → use `npm --prefix
  /c/TirateIniziativa/HexJourney ...` or reset with a standalone `cd
  /c/TirateIniziativa/HexJourney`. The "web" MCP preview (`.claude/launch.json`) now
  launches `npm run dev:client`.
- **Dev globals** (only in `import.meta.env.DEV`): `window.__pixi` (PixiManager:
  `.doc`, `.cellByKey`, `.relEdgeMids`, `.world`, `.anchorIndex`, getters
  `activeCount/poolCount/cellCount`) and `window.__store` (= useMapStore;
  `.getState()`). Use them to inspect and drive the tests.
- **Stale reads via preview_eval**: zustand `set` is synchronous but `__pixi.doc`
  only updates after the React→`setDoc` round (effect/rAF). Read the state in a
  **separate, later eval**, or read `window.__store.getState().doc` (updated
  immediately). Same problem when clicking a button and looking in the same eval for
  one that just appeared (the UI re-renders async): do the steps in separate evals.
- **Driving the canvas**: dispatch `PointerEvent`/`WheelEvent` directly on the
  `.hex-canvas canvas` (bypasses the dialog backdrops). hex→client:
  `clientX = rect.left + cell.x*scale + world.x` (cell from `__pixi.cellByKey`, scale
  `__pixi.world.scale.x`). The anchors are rebuilt at cull (rAF) after switching to
  Road/River → click the anchors in a separate eval.
- **Capturing downloads**: override `URL.createObjectURL` to read the last Blob
  (`.text()`); the PNG uses `a.href` data-URL.
- **Realtime locally**: `npm -w worker run dev` (wrangler dev, miniflare offline)
  exposes the Worker on :8787; testable with `curl /health`, `POST /session`, and WS
  driven by `preview_eval` (two sockets gm/player). **Free port 8787** (PowerShell):
  `Get-NetTCPConnection -LocalPort 8787 -State Listen | ... Stop-Process -Id
  $_.OwningProcess -Force`. Worker build validation without deploy: `npm -w worker
  run dry-run`. The preview sometimes stops → relaunch `preview_start`.
- **Pixi v8**: `app.canvas` is typed `ICanvas` (DOM methods optional) → in the
  PixiManager there is a `canvas` getter cast to `HTMLCanvasElement`. StrictMode
  mounts twice: `init` is async and `destroy` idempotent.
- Adding fields to the `MapDocument` is backward-compatible (optional fields); the
  `isMapDocument` validator in `shared/model` (used by the worker) doesn't validate
  them but preserves them (the DO stores the whole map object).
