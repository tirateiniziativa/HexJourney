# MIGRATION.md — HexJourney → Cloudflare (Pages + Workers + Durable Objects)

Nota tecnica interna alla migrazione. Obiettivo: deploy gratuito/semplice su
Cloudflare **mantenendo tutte le funzionalità esistenti**, migrando in modo
incrementale e senza riscrivere l'app.

## 1. Architettura attuale

**Frontend (root, Vite SPA)**
- Root del repo = app Vite + React 19 + TS 5.6 + PixiJS 8 + zustand 5 + dexie 4.
- `src/`: `model/` (tipi), `hex/` (coordinate/layout/los/pathfind), `store/`
  (zustand `mapStore`), `render/` (PixiManager/HexCanvas), `ui/`, `i18n/`,
  `persistence/` (Dexie + io), `data/` (catalog/travel), `sync/` (realtime client).
- Alias `@` → `src` (vite.config + tsconfig.app). Build: `tsc -b && vite build`.
- Connessione realtime: `src/sync/SyncClient.ts` apre **un unico** WebSocket a
  `DEFAULT_WS_URL` (`VITE_WS_URL` o `ws://localhost:8787/ws`). `bridge.ts`
  (singleton + emit helpers chiamati dallo store), `useSync.ts` (instrada i
  messaggi server → store).

**Backend (`server/`, Node + Fastify 5 + ws 8)**
- `server/src/index.ts`: Fastify (`GET /health`) + `WebSocketServer` su `/ws`.
  Instrada i messaggi in base al `sessionId` **dentro** il messaggio.
- `server/src/sessions.ts`: `SessionManager` in memoria — `Map<sessionId,
  Session{ id, map, clients: Map<clientId, Client> }>`. Genera codici a 6 char,
  `createSession/getSession/addClient/removeClient/presence/applyPatch/applyFog/
  applyFullState/broadcast/send`.
- `server/src/protocol.ts` + `server/src/model.ts`: protocollo e tipi
  **duplicati** rispetto al client, con validatori `isFogState/isHexTile/
  isMapDocument`.

**Modello dati** — `src/model/types.ts` (fonte) con copia parziale in
`server/src/model.ts`. `MapDocument`, `HexTile`, `FogState`, `Orientation`,
`HexPath`, `ExplorationDocument`, ecc.

**Protocollo realtime attuale**
- Client→Server: `create {map}` (il GM crea, **il server genera il codice**),
  `join {sessionId, role}`, `patch`, `fogUpdate`, `fullState`, `requestFullState`.
- Server→Client: `welcome {sessionId, role, clientId}`, `fullState`, `patch`,
  `fogUpdate`, `presence`, `error`.
- **Autorità**: il server applica `patch/fogUpdate/fullState` solo se
  `client.role === 'gm'`; i messaggi dei player sono ignorati. Riconnessione:
  il client ricorda `sessionId` e al riaprire invia `join` + `requestFullState`.

## 2. Architettura target (Cloudflare)

```
/
├── client/   SPA Vite/React (deploy su Cloudflare Pages, output dist/)
├── worker/   Cloudflare Worker (router) + Durable Object HexSession (Wrangler)
├── shared/   tipi + protocollo + hex condivisi (model/ protocol/ hex/)
├── package.json (workspaces, script root)
├── tsconfig.base.json
└── README.md
```

- **shared/** = unica fonte di tipi/protocollo, pacchetto workspace
  `@hexjourney/shared` risolto via node_modules (Vite, Wrangler/esbuild e tsc lo
  risolvono nativamente, senza path-alias per-tool).
- **worker/index.ts**: solo routing HTTP. `GET /health` → `{ ok: true }`;
  `GET /session/:id/websocket` → upgrade WS verso il **Durable Object**
  `HEX_SESSIONS.idFromName(sessionId)`; `POST /session` → genera un id casuale.
  Non tiene stato della mappa.
- **worker/HexSession.ts**: Durable Object autoritativo per-sessione. Tiene il
  `MapDocument` in `ctx.storage`, la lista connessioni, i ruoli; usa la
  **WebSocket Hibernation API** (`ctx.acceptWebSocket`, `webSocketMessage`,
  `webSocketClose`, `serializeAttachment` per ruolo/nome). Invia `fullState`
  all'ingresso + `presence`, applica `patch/fogUpdate` **solo dal GM**, fa
  broadcast, risponde a `requestFullState`.

**Protocollo target** (discriminato per `type`, in `shared/protocol`)
- Client→Server: `join {sessionId, role, name?, map?}` (il GM crea/inizializza
  fornendo `map`; non c'è più `create`), `patch`, `fogUpdate`, `requestFullState`.
- Server→Client: `fullState`, `patch`, `fogUpdate`, `presence`, `error`.
  (Il `welcome` sparisce: il client conosce già il proprio ruolo perché lo sceglie
  alla connessione; il `sessionId` è nell'URL.)

## 3. Punti da migrare

1. **shared/**: estrarre `model` + `protocol` (discriminato `type`) + eventuale
   `hex`, eliminando la duplicazione client/server. Rewire del frontend per
   importare da `@hexjourney/shared`.
2. **Protocollo**: `create {map}` → `join {sessionId, role, map?}`; rimuovere
   `welcome` (ruolo/sessione noti lato client/URL).
3. **Routing per-sessione**: dal singolo `/ws` con sessionId nel messaggio →
   `/session/:id/websocket` con sessionId nel **path** (Worker → DO per id).
4. **Durable Object** `HexSession` con Hibernation API + `ctx.storage` per la
   persistenza del `MapDocument`.
5. **Validazione** dei messaggi nel worker (porting di `isFogState/isHexTile/
   isMapDocument` + controllo `type`, `role`, `tileKey "q,r"`).
6. **Client `sync/`**: URL per-sessione (`VITE_WORKER_*`), `connectToSession({
   sessionId, role, name, map? })`, gestione ruolo lato client.
7. **UI sessione**: il GM sceglie/genera il `sessionId` (POST /session o random
   client-side) e invia la `MapDocument`; link player `/?session=…&role=player`.
8. **Monorepo**: spostare il frontend in `client/`, creare `worker/` e `shared/`,
   workspaces + script root; **rimuovere** `server/` (Fastify/ws).

## 4. Rischi principali

- **Hibernation API**: semantica diversa dal modello `ws` (handler
  `webSocketMessage/Close`, niente listener per-socket, attachment serializzati
  per ruolo/nome). Da testare con `wrangler dev` (miniflare).
- **Risoluzione `shared/`** tra Vite + Wrangler/esbuild + tsc: mitigata usando un
  pacchetto workspace `@hexjourney/shared` (risoluzione node, niente path-alias
  per-tool). esbuild bundla il TS del pacchetto.
- **Spostamento del frontend in `client/`**: alias `@`, `index.html`, asset
  `public/`, tsconfig e node_modules/workspaces da riallineare senza rompere il
  build.
- **Cambi di protocollo** (`create`→`join+map`, `welcome` rimosso): toccano client
  e DO insieme; vanno migrati in coppia.
- **Persistenza DO**: `ctx.storage` al posto della `Map` in memoria; il
  `MapDocument` può essere grande (100×100) → attenzione a dimensioni/serializzazione.
- **Test/deploy**: il realtime locale richiede `wrangler dev`; il deploy reale
  richiede account Cloudflare (`wrangler login`) per Pages + Workers — non
  verificabile in CI/sandbox, solo i typecheck/build lo sono.

## 5. Stato della migrazione (avanzamento per fase)

- [x] **Fase 1** — Analisi + questa nota.
- [x] **Fase 2** — `shared/` (`@hexjourney/shared`: model + protocol discriminato) e
  rewire del frontend (`client/src/model/types.ts` ri-esporta da shared).
- [x] **Fase 3** — Monorepo riorganizzato: frontend → `client/`, workspaces npm
  (`client`/`shared`/`worker`), `tsconfig.base.json`, script root. `build:client`
  e runtime verificati. `worker/` è ancora uno scheletro (Fasi 4–6).
- [x] **Fase 4** — Worker router (`/health`, `POST /session`, `/session/:id/websocket`)
  + `wrangler.jsonc` (DO binding `HEX_SESSIONS`, `new_sqlite_classes` → piano gratuito).
- [x] **Fase 5** — Durable Object `HexSession` (WebSocket **Hibernation API**:
  `acceptWebSocket`/`webSocketMessage`/`webSocketClose` + `serializeAttachment` per
  ruolo/nome/id; mappa in `ctx.storage` SQLite + cache in memoria; autorità GM).
- [x] **Fase 6** — Validazione messaggi (`worker/src/validation.ts` + validatori in
  `shared/model`). Verificato: typecheck worker, `wrangler deploy --dry-run` (binding
  OK), boot locale `wrangler dev` (`/health` → `{ok:true}`, `POST /session` → codice).
- [x] **Fase 7** — Client `sync/` riscritto: URL per-sessione, `createSession`
  (POST /session → connect GM con `map`), `joinSession`, niente `welcome`
  (handler `onSession`). Config `VITE_WORKER_WS_URL` + `client/.env.example`.
- [x] **Fase 8** — UI sessione: codice + **link giocatore** (`?session=…&role=player`),
  prefill del codice dalla query string e apertura automatica del pannello.
  Verificato con `wrangler dev` + client: `fullState`, broadcast patch GM→player,
  **patch player rifiutata** (autorità), `presence`, e `POST /session` CORS.
- [x] **Fase 9** — Rimosso `server/` (Fastify/ws). Nessuno script root rotto (gli
  script `server*` erano già stati tolti). `ws` resta nel lockfile solo come
  dipendenza transitiva di Wrangler.
- [x] **Fase 10–11** — Documentati i deploy (README §4): Pages (root `client/`,
  output `dist/`, env `VITE_WORKER_WS_URL=wss://<worker-domain>`) e Worker
  (`wrangler login` + `npm run deploy:worker`). Il deploy effettivo richiede
  l'account Cloudflare dell'utente.
- [x] **Fase 12** — README riscritto (architettura, sviluppo, build, deploy, test
  sessione, export/import, note tecniche). `CLAUDE.md` aggiornato.
- [x] **Fase 13** — Verifiche: `npm install` (workspaces), `npm run typecheck`
  (client+worker), `npm run build:client`, `wrangler --dry-run` (binding DO), e
  test realtime locale (fullState/broadcast/autorità/presence, CORS `POST /session`).

## 6. Criteri di accettazione — stato

- [x] Compila senza errori TypeScript (typecheck client + worker verdi).
- [x] Frontend deployabile su Cloudflare Pages (build `client/dist`).
- [x] Backend deployabile su Cloudflare Workers (dry-run OK; deploy con account).
- [x] Nessuna dipendenza runtime dal vecchio server Fastify/ws (rimosso).
- [x] Sessioni realtime via Durable Object (testate in locale).
- [x] DM autoritativo; player sola lettura (patch player rifiutata).
- [x] Stato mappa/fog persistente nel DO durante la sessione e oltre il riavvio
  (`ctx.storage` SQLite).
- [x] README sufficiente per partire da zero.

> Limiti noti: deploy reale su Cloudflare da fare con l'account dell'utente
> (`wrangler login`); mappa salvata come valore unico nel DO (~2 MiB, ok ~100×100,
> split per-tile come TODO per mappe enormi).
