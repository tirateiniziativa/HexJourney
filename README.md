# ⬡ HexJourney

Costruttore di mappe esagonali per **hexcrawl** di D&D: tasselli predeterminati,
overlay (strade/fiumi ad ancore, simboli, effetti neve/vulcanica/ghiaccio),
**fog of war**, esplorazione con **line-of-sight** e tempi/distanze di viaggio
(scala mappa + mezzo di trasporto), salvataggio locale e import/export JSON, ed
**esplorazione condivisa in tempo reale** tra DM e giocatori.

Architettura **Cloudflare-ready**: frontend SPA su **Cloudflare Pages**, realtime
su **Cloudflare Workers + Durable Objects** (WebSocket Hibernation API). Niente
backend Node/Fastify da gestire.

Creato da **[TirateIniziativa](https://linktr.ee/TirateIniziativa)**.

---

## 1. Architettura

Monorepo (npm workspaces):

```
/
├── client/   SPA Vite + React 19 + TypeScript + PixiJS 8 + zustand 5 + dexie 4
│             → deploy su Cloudflare Pages (output client/dist/)
├── worker/   Cloudflare Worker (router) + Durable Object "HexSession"
│             → deploy con Wrangler
├── shared/   @hexjourney/shared: tipi e protocollo condivisi (model/ protocol/)
├── package.json (workspaces + script root)
├── tsconfig.base.json
└── README.md
```

- **client** — l'editor/visualizzatore. Stato vivo in **zustand**; persistenza
  locale in **IndexedDB (Dexie)**. Rendering con **PixiJS v8** (culling + pool
  sprite). I tipi del modello arrivano da `@hexjourney/shared`.
- **worker** — un Worker "router" che **non tiene stato**: instrada le richieste
  verso il Durable Object della sessione.
  - `GET /health` → `{ ok: true }`
  - `POST /session` → `{ sessionId }` (codice casuale a 6 caratteri)
  - `GET /session/:id/websocket` → upgrade WebSocket verso il DO `idFromName(id)`
- **Durable Object `HexSession`** — autoritativo per **una** sessione:
  - tiene il `MapDocument` (cache in memoria + persistenza in `ctx.storage`
    SQLite → idoneo al **piano gratuito**);
  - **WebSocket Hibernation API** (`acceptWebSocket`, `webSocketMessage`,
    `webSocketClose`); ruolo/nome/id per-socket via `serializeAttachment`;
  - **autorità DM**: applica `patch`/`fogUpdate`/`fullState` solo dal DM, fa
    broadcast a tutti, invia `fullState` all'ingresso e `presence` ai presenti;
  - valida ogni messaggio in ingresso (non si fida mai del client).
- **shared** — unica fonte di verità per `MapDocument`, `HexTile`, `FogState`,
  ecc. e per il **protocollo discriminato** (`type`). Consumato sia dal client
  (Vite) sia dal worker (Wrangler/esbuild) via risoluzione del workspace.

### Protocollo realtime (`@hexjourney/shared/protocol`)

Client → Server: `join { sessionId, role, name?, map? }` · `patch { tileKey, tile }`
· `fogUpdate { tileKey, fog }` · `fullState { map }` (operazioni bulk del DM) ·
`requestFullState`.

Server → Client: `fullState { map }` · `patch` · `fogUpdate` ·
`presence { players }` · `error { message }`.

Il DM crea/inizializza la sessione fornendo `map` nel `join`; il `sessionId` è
nell'URL (niente più `welcome`). Riconnessione: il `join` di rientro fa rinviare
`fullState` dal DO.

---

## 2. Sviluppo locale

### Requisiti
- Node.js 20+ (testato con Node 24), npm 9+.

### Installazione (dalla root)
```bash
npm install            # installa tutti i workspace (client, shared, worker)
```

### Avvio
```bash
npm run dev            # avvia INSIEME client (Vite) e worker (wrangler dev)
```
- Frontend: <http://localhost:5173>
- Worker:   <http://localhost:8787> (`/health`, `POST /session`, WebSocket su
  `/session/:id/websocket`)

Oppure separatamente:
```bash
npm run dev:client     # solo Vite (porta 5173)
npm run dev:worker     # solo wrangler dev (porta 8787)
```

Configura l'URL del worker per il client copiando l'esempio:
```bash
cp client/.env.example client/.env       # VITE_WORKER_WS_URL=ws://localhost:8787
```
Senza `.env`, il client usa di default `ws://localhost:8787`.

---

## 3. Build / typecheck
```bash
npm run build:client   # client/dist (tsc -b && vite build)
npm run typecheck      # typecheck client + worker
npm run preview:client # anteprima del build del client
```

---

## 4. Deploy su Cloudflare

Frontend e worker si deployano **separatamente**. Serve un account Cloudflare e
`wrangler` (incluso come dev dependency del worker).

### 4a. Worker (Cloudflare Workers + Durable Objects)
```bash
npx wrangler login                 # una volta
npm run deploy:worker              # = wrangler deploy (in worker/)
```
- Config in `worker/wrangler.jsonc` (binding `HEX_SESSIONS` + Durable Object
  `HexSession` con `new_sqlite_classes` → compatibile col piano gratuito).
- A fine deploy Wrangler stampa l'URL del worker, es.
  `https://tristora-hexcrawl-worker.<account>.workers.dev`.
- Verifica: `curl https://<worker-domain>/health` → `{"ok":true}`.

### 4b. Frontend (Cloudflare Pages)
Crea un progetto Pages collegato al repo con:
- **Root directory**: `client`
- **Build command**: `npm install && npm run build` (o, da monorepo,
  `npm install && npm -w client run build` dalla root)
- **Build output**: `dist`
- **Variabile d'ambiente**: `VITE_WORKER_WS_URL = wss://<worker-domain>`
  (il dominio del worker del punto 4a, con schema `wss`).

> Nota monorepo: se Pages è impostato con root `client/`, il `npm install` di
> Pages installa il workspace `client` e linka `@hexjourney/shared`. In
> alternativa, root del progetto = repo e build `npm -w client run build` con
> output `client/dist`.

### 4c. SEO e dominio
Il client include metadati SEO (`title`, `description`, keywords, Open Graph,
Twitter card, `robots`, `canonical`, fallback `<noscript>` indicizzabile),
`favicon.svg`, `site.webmanifest`, `robots.txt` e `sitemap.xml` (in
`client/public/`, serviti alla root). **Dopo aver scelto il dominio**, sostituisci
il placeholder `https://hexjourney.pages.dev` con quello reale in
`client/index.html` (`canonical`, `og:url`, `og:image`), `client/public/robots.txt`
e `client/public/sitemap.xml`. Per le anteprime social è consigliata anche una
`og:image` raster 1200×630 (ora punta al `favicon.svg`).

---

## 5. Test sessione DM ↔ giocatore (in locale)
1. `npm run dev` (client su :5173, worker su :8787).
2. Apri <http://localhost:5173> come **DM**, crea o carica una mappa.
3. **Sessione → Crea sessione**: il client chiama `POST /session`, ottiene un
   codice e si connette inviando la mappa. Copia il **link giocatore**.
4. In una seconda finestra/incognito apri il link `(/?session=CODICE&role=player)`
   oppure **Sessione → incolla il codice → Unisciti**.
5. Il giocatore entra in **sola lettura** e riceve la mappa con la fog applicata.
6. Dipingi hex / cambia fog come DM: il giocatore vede gli aggiornamenti in
   tempo reale. Le modifiche inviate da un giocatore vengono **rifiutate**.
7. Chiudi e riapri la scheda giocatore: alla riconnessione riceve di nuovo lo
   stato pieno (`requestFullState`/`join`).

---

## 6. Export / Import

Pulsante **Esporta/Importa**. Tutti i formati sono JSON con `schemaVersion`.
- **Mappa completa** — l'intero `MapDocument` (mondo + esplorazione).
- **Mappa pulita** — mondo con esplorazione azzerata (fog `hidden`, viaggio 0),
  LoS iniziale dei giocatori riapplicata.
- **Solo esplorazione** — `{ fog, playerPos, travelDays, travelDistanceKm }`.
- **Immagine (.png)** — l'intera mappa.

Import speculare; per la sola esplorazione si verifica che il `mapId` combaci.
La persistenza locale (Dexie) è **distinta** dalla sessione realtime: l'autosave
locale non passa dal worker, mentre lo stato condiviso vive nel Durable Object.

---

## 7. Note tecniche

- **Coordinate** (Red Blob Games): assiali `(q,r)` per memorizzare (chiave
  `"q,r"`), cubiche per gli algoritmi (distanza, vicini, linee, raggi). Geometria
  pixel via honeycomb-grid v4, unica fonte di verità (`client/src/hex/layout.ts`).
- **Fog dentro il `MapDocument`**: l'esplorazione è stato di gioco e vive nei
  `tiles` (campo `fog`), non separata dal mondo.
- **Autorità DM**: solo il DM modifica mondo e fog; il Durable Object ignora/
  rifiuta i messaggi di modifica dei giocatori.
- **Stato autoritativo nel Durable Object**: un DO per `sessionId`
  (`idFromName`); `ctx.storage` (SQLite) persiste il `MapDocument` durante la
  sessione e oltre il riavvio. Mappa salvata come valore singolo (limite
  ~2 MiB; per mappe molto grandi servirebbe lo split per-tile — TODO).
- **Persistenza locale Dexie distinta dalla sessione live**: il client salva in
  IndexedDB le proprie mappe; la sessione condivisa è indipendente.
- **Viaggio**: tempi/distanze derivati da scala mappa + mezzo (vedi `client/src/
  data/travel.ts`), con percorribilità per mezzo (es. barca sui fiumi, ghiaccio
  non navigabile) e display `Ng Nh Nm` + distanza in km/mi.
- **Stack**: Vite 6 · React 19 · TypeScript 5.6 (strict) · PixiJS 8 · honeycomb-
  grid 4 · zustand 5 · dexie 4 · Wrangler 4 · `@cloudflare/workers-types`.

Dettaglio della migrazione da Node/Fastify a Cloudflare: vedi
[`MIGRATION.md`](./MIGRATION.md).

---

## Crediti

HexJourney è creato da **TirateIniziativa**.

- 🔗 Tutti i link: <https://linktr.ee/TirateIniziativa>

Se usi l'app per le tue campagne, un saluto e un follow sono sempre graditi!
