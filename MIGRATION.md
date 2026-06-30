# MIGRATION.md — HexJourney → Cloudflare (Pages + Workers + Durable Objects)

Internal technical note for the migration. Goal: a free/simple deploy on Cloudflare
**keeping all existing functionality**, migrating incrementally and without
rewriting the app.

## 1. Current architecture

**Frontend (root, Vite SPA)**
- Repo root = Vite + React 19 + TS 5.6 + PixiJS 8 + zustand 5 + dexie 4 app.
- `src/`: `model/` (types), `hex/` (coordinates/layout/los/pathfind), `store/`
  (zustand `mapStore`), `render/` (PixiManager/HexCanvas), `ui/`, `i18n/`,
  `persistence/` (Dexie + io), `data/` (catalog/travel), `sync/` (realtime client).
- Alias `@` → `src` (vite.config + tsconfig.app). Build: `tsc -b && vite build`.
- Realtime connection: `src/sync/SyncClient.ts` opens **a single** WebSocket to
  `DEFAULT_WS_URL` (`VITE_WS_URL` or `ws://localhost:8787/ws`). `bridge.ts`
  (singleton + emit helpers called by the store), `useSync.ts` (routes server
  messages → store).

**Backend (`server/`, Node + Fastify 5 + ws 8)**
- `server/src/index.ts`: Fastify (`GET /health`) + `WebSocketServer` on `/ws`.
  Routes messages based on the `sessionId` **inside** the message.
- `server/src/sessions.ts`: in-memory `SessionManager` — `Map<sessionId,
  Session{ id, map, clients: Map<clientId, Client> }>`. Generates 6-char codes,
  `createSession/getSession/addClient/removeClient/presence/applyPatch/applyFog/
  applyFullState/broadcast/send`.
- `server/src/protocol.ts` + `server/src/model.ts`: protocol and types
  **duplicated** with respect to the client, with `isFogState/isHexTile/
  isMapDocument` validators.

**Data model** — `src/model/types.ts` (source) with a partial copy in
`server/src/model.ts`. `MapDocument`, `HexTile`, `FogState`, `Orientation`,
`HexPath`, `ExplorationDocument`, etc.

**Current realtime protocol**
- Client→Server: `create {map}` (the DM creates, **the server generates the code**),
  `join {sessionId, role}`, `patch`, `fogUpdate`, `fullState`, `requestFullState`.
- Server→Client: `welcome {sessionId, role, clientId}`, `fullState`, `patch`,
  `fogUpdate`, `presence`, `error`.
- **Authority**: the server applies `patch/fogUpdate/fullState` only if
  `client.role === 'gm'`; player messages are ignored. Reconnection: the client
  remembers `sessionId` and on reopening sends `join` + `requestFullState`.

## 2. Target architecture (Cloudflare)

```
/
├── client/   Vite/React SPA (deployed to Cloudflare Pages, output dist/)
├── worker/   Cloudflare Worker (router) + Durable Object HexSession (Wrangler)
├── shared/   shared types + protocol + hex (model/ protocol/ hex/)
├── package.json (workspaces, root scripts)
├── tsconfig.base.json
└── README.md
```

- **shared/** = single source of types/protocol, workspace package
  `@hexjourney/shared` resolved via node_modules (Vite, Wrangler/esbuild and tsc
  resolve it natively, without per-tool path aliases).
- **worker/index.ts**: HTTP routing only. `GET /health` → `{ ok: true }`;
  `GET /session/:id/websocket` → WS upgrade to the **Durable Object**
  `HEX_SESSIONS.idFromName(sessionId)`; `POST /session` → generates a random id.
  It holds no map state.
- **worker/HexSession.ts**: per-session authoritative Durable Object. Holds the
  `MapDocument` in `ctx.storage`, the connection list, the roles; uses the
  **WebSocket Hibernation API** (`ctx.acceptWebSocket`, `webSocketMessage`,
  `webSocketClose`, `serializeAttachment` for role/name). Sends `fullState` on
  entry + `presence`, applies `patch/fogUpdate` **only from the DM**, broadcasts,
  responds to `requestFullState`.

**Target protocol** (discriminated by `type`, in `shared/protocol`)
- Client→Server: `join {sessionId, role, name?, map?}` (the DM creates/initializes
  by providing `map`; there is no more `create`), `patch`, `fogUpdate`,
  `requestFullState`.
- Server→Client: `fullState`, `patch`, `fogUpdate`, `presence`, `error`.
  (The `welcome` goes away: the client already knows its own role because it picks
  it at connection time; the `sessionId` is in the URL.)

## 3. Points to migrate

1. **shared/**: extract `model` + `protocol` (discriminated `type`) + the optional
   `hex`, eliminating the client/server duplication. Rewire the frontend to import
   from `@hexjourney/shared`.
2. **Protocol**: `create {map}` → `join {sessionId, role, map?}`; remove `welcome`
   (role/session known client-side/URL).
3. **Per-session routing**: from the single `/ws` with the sessionId in the message
   → `/session/:id/websocket` with the sessionId in the **path** (Worker → DO by id).
4. **Durable Object** `HexSession` with the Hibernation API + `ctx.storage` for the
   persistence of the `MapDocument`.
5. **Validation** of the messages in the worker (porting of `isFogState/isHexTile/
   isMapDocument` + check of `type`, `role`, `tileKey "q,r"`).
6. **Client `sync/`**: per-session URL (`VITE_WORKER_*`), `connectToSession({
   sessionId, role, name, map? })`, client-side role handling.
7. **Session UI**: the DM picks/generates the `sessionId` (POST /session or
   client-side random) and sends the `MapDocument`; player link
   `/?session=…&role=player`.
8. **Monorepo**: move the frontend to `client/`, create `worker/` and `shared/`,
   workspaces + root scripts; **remove** `server/` (Fastify/ws).

## 4. Main risks

- **Hibernation API**: semantics different from the `ws` model (`webSocketMessage/
  Close` handlers, no per-socket listeners, attachments serialized for role/name).
  To be tested with `wrangler dev` (miniflare).
- **`shared/` resolution** across Vite + Wrangler/esbuild + tsc: mitigated by using
  a `@hexjourney/shared` workspace package (node resolution, no per-tool path
  aliases). esbuild bundles the package's TS.
- **Moving the frontend to `client/`**: the `@` alias, `index.html`, `public/`
  assets, tsconfig and node_modules/workspaces to realign without breaking the build.
- **Protocol changes** (`create`→`join+map`, `welcome` removed): they touch the
  client and the DO together; they must be migrated as a pair.
- **DO persistence**: `ctx.storage` instead of the in-memory `Map`; the
  `MapDocument` can be large (100×100) → mind the size/serialization.
- **Test/deploy**: local realtime requires `wrangler dev`; the real deploy requires
  a Cloudflare account (`wrangler login`) for Pages + Workers — not verifiable in
  CI/sandbox, only the typechecks/builds are.

## 5. Migration status (progress by phase)

- [x] **Phase 1** — Analysis + this note.
- [x] **Phase 2** — `shared/` (`@hexjourney/shared`: model + discriminated protocol)
  and frontend rewire (`client/src/model/types.ts` re-exports from shared).
- [x] **Phase 3** — Monorepo reorganized: frontend → `client/`, npm workspaces
  (`client`/`shared`/`worker`), `tsconfig.base.json`, root scripts. `build:client`
  and runtime verified. `worker/` is still a skeleton (Phases 4–6).
- [x] **Phase 4** — Worker router (`/health`, `POST /session`, `/session/:id/websocket`)
  + `wrangler.jsonc` (DO binding `HEX_SESSIONS`, `new_sqlite_classes` → free plan).
- [x] **Phase 5** — Durable Object `HexSession` (WebSocket **Hibernation API**:
  `acceptWebSocket`/`webSocketMessage`/`webSocketClose` + `serializeAttachment` for
  role/name/id; map in `ctx.storage` SQLite + in-memory cache; DM authority).
- [x] **Phase 6** — Message validation (`worker/src/validation.ts` + validators in
  `shared/model`). Verified: worker typecheck, `wrangler deploy --dry-run` (binding
  OK), local boot `wrangler dev` (`/health` → `{ok:true}`, `POST /session` → code).
- [x] **Phase 7** — Client `sync/` rewritten: per-session URL, `createSession`
  (POST /session → connect DM with `map`), `joinSession`, no `welcome` (`onSession`
  handler). Config `VITE_WORKER_WS_URL` + `client/.env.example`.
- [x] **Phase 8** — Session UI: code + **player link** (`?session=…&role=player`),
  prefill of the code from the query string and automatic opening of the panel.
  Verified with `wrangler dev` + client: `fullState`, DM→player patch broadcast,
  **player patch rejected** (authority), `presence`, and `POST /session` CORS.
- [x] **Phase 9** — Removed `server/` (Fastify/ws). No broken root script (the
  `server*` scripts had already been removed). `ws` stays in the lockfile only as a
  transitive dependency of Wrangler.
- [x] **Phase 10–11** — Documented the deploys (README §4): Pages (root `client/`,
  output `dist/`, env `VITE_WORKER_WS_URL=wss://<worker-domain>`) and Worker
  (`wrangler login` + `npm run deploy:worker`). The actual deploy requires the
  user's Cloudflare account.
- [x] **Phase 12** — README rewritten (architecture, development, build, deploy,
  session test, export/import, technical notes). `CLAUDE.md` updated.
- [x] **Phase 13** — Checks: `npm install` (workspaces), `npm run typecheck`
  (client+worker), `npm run build:client`, `wrangler --dry-run` (DO binding), and
  local realtime test (fullState/broadcast/authority/presence, CORS `POST /session`).

## 6. Acceptance criteria — status

- [x] Compiles without TypeScript errors (client + worker typecheck green).
- [x] Frontend deployable to Cloudflare Pages (build `client/dist`).
- [x] Backend deployable to Cloudflare Workers (dry-run OK; deploy with an account).
- [x] No runtime dependency on the old Fastify/ws server (removed).
- [x] Realtime sessions via Durable Object (tested locally).
- [x] DM authoritative; players read-only (player patch rejected).
- [x] Map/fog state persistent in the DO during the session and beyond a restart
  (`ctx.storage` SQLite).
- [x] README sufficient to start from scratch.

> Known limits: the real deploy to Cloudflare is to be done with the user's account
> (`wrangler login`); the map is stored as a single value in the DO (~2 MiB, fine
> for ~100×100, per-tile splitting as a TODO for huge maps).
