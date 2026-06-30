# CLAUDE.md — HexJourney

Guida operativa per lavorare su questo progetto. Leggila prima di modificare il codice.

## Cos'è

**HexJourney**: web app per costruire mappe esagonali per **hexcrawl** di D&D —
tasselli predeterminati, overlay, strade/fiumi, **fog of war**, **esplorazione**
con line-of-sight + tempo di viaggio, salvataggio locale, import/export JSON, e
**condivisione realtime GM↔giocatori**.

Root del progetto: `C:\HEXplorer` (NON è un repo git). **Monorepo npm workspaces**:
`client/` (SPA Vite → Cloudflare Pages), `worker/` (Cloudflare Worker + Durable
Object → Wrangler), `shared/` (`@hexjourney/shared`: tipi + protocollo condivisi).
Il vecchio backend Node/Fastify in `server/` è stato **rimosso** (migrazione a
Cloudflare; vedi `MIGRATION.md`).

## Convenzioni (importanti)

- **Rispondi all'utente in italiano.** L'utente dà i requisiti in italiano.
- **Stringhe UI internazionalizzate (i18n), lingua di default inglese.** Ogni
  testo mostrato passa da `t('chiave', params?)` (hook `useT` in `src/i18n/`); le
  tabelle di traduzione coprono 6 lingue (en/it/fr/de/es/pt). NON hardcodare testo
  in UI: aggiungi una chiave in `src/i18n/index.ts` (in tutte le lingue) e usala.
  **Commenti del codice in italiano; identificatori di codice in inglese.** La
  label del master mostrata è **"DM"** (l'enum interno resta `mode: 'gm'`).
- **Verifica ogni modifica osservabile davvero nel browser** prima di riferire:
  `npm run build` (tipi) → preview MCP (screenshot + `preview_console_logs level:error`).
  Non chiedere all'utente di provare a mano. Chiudi con un riepilogo conciso di cosa
  hai testato e l'esito.
- TS è in `strict` con `noUnusedLocals`/`noUnusedParameters`: rimuovi import e
  variabili inutilizzati o il build fallisce.

## Stack (versioni reali, "ultime stabili", niente deprecate)

Vite 6.4 · React 19.2 · TypeScript 5.6 · PixiJS 8.19 (**init asincrona** `await
app.init`, NON il costruttore v7) · honeycomb-grid 4.1 · zustand 5.0 · dexie 4.4.
Backend realtime: **Cloudflare Workers + Durable Objects** (WebSocket Hibernation
API) via **Wrangler 4** + `@cloudflare/workers-types`. Ambiente: Node 24.

## Comandi (dalla root)

```bash
npm install             # installa tutti i workspace (client/shared/worker)
npm run dev             # client (Vite :5173) + worker (wrangler dev :8787) insieme
npm run dev:client      # solo Vite -> http://localhost:5173
npm run dev:worker      # solo wrangler dev -> :8787 (/health, POST /session, /session/:id/websocket)
npm run build:client    # tsc -b && vite build (client -> client/dist/)
npm run preview:client  # anteprima del build del client
npm run typecheck       # typecheck client + worker
npm run deploy:worker   # wrangler deploy (in worker/)
```

URL del Worker per il client: `VITE_WORKER_WS_URL` (default `ws://localhost:8787`;
in prod `wss://<worker-domain>`), vedi `client/.env.example`. Build singoli per
workspace: `npm -w client run ...` / `npm -w worker run ...`. Dry-run del worker:
`npm -w worker run dry-run` (`wrangler deploy --dry-run`).

## Architettura

### Struttura

```
shared/        @hexjourney/shared (pacchetto workspace, FONTE dei tipi)
  model/map.ts   modello dati + helper + validatori (isHexTile/isMapDocument/…)
  protocol/messages.ts  protocollo discriminato (ClientToServer/ServerToClient)
client/        SPA Vite (workspace @hexjourney/client)
  src/
    hex/         coordinates (assiali storage, CUBICHE algoritmi), layout
                 (honeycomb v4), los, pathfind (Dijkstra + preferenza strade)
    model/types.ts  ri-esporta da @hexjourney/shared/model (punto import storico @/model/types)
    store/       mapStore.ts — zustand, UNICA fonte di stato locale (no localStorage)
    render/      PixiManager (motore), HexCanvas, rendererRef
    ui/          Toolbar (+ lingua + unità distanza), Palette, Legend, *Dialog/*Panel, StatusBar
    i18n/        index.ts (Lang, LANGS, DEFAULT_LANG='en', 6 lingue) + useT.ts
    persistence/ db (Dexie), io (export/import; errori = CHIAVI i18n), useAutosave
    sync/        protocol (config URL Worker + alias), SyncClient (WS per-sessione), bridge, useSync
    data/        tiles.json, catalog, travel (crossingDays/canEnter/formatTravel/…)
worker/        Cloudflare Worker (workspace @hexjourney/worker)
  src/index.ts        router (/health, POST /session, /session/:id/websocket → DO)
  src/HexSession.ts   Durable Object (Hibernation API, storage SQLite, autorità DM)
  src/validation.ts   parsing/validazione messaggi (usa i validatori di shared)
  src/types.ts        Env (binding HEX_SESSIONS)
  wrangler.jsonc      DO binding + new_sqlite_classes (piano gratuito)
```

### Modello dati (`src/model/types.ts`)

```ts
FogState = "hidden" | "explored" | "visible"
Edge = 0..5
HexPath = { kind: string; edges: Edge[] }        // 2 lati=arco, 3=incrocio; lati non adiacenti
HexTile = { terrain; overlay?; rotation; fog; paths?: HexPath[]; snow?; volcanic?; ice? }
MapScale = 'local' | 'regional' | 'kingdoms' | 'continents'
Vehicle  = 'foot' | 'horse' | 'carriage' | 'caravan' | 'boat' | 'ship'
MapDocument = {
  schemaVersion; id; name; orientation; shape?; hexSize; width; height;
  tiles: Record<"q,r", HexTile>;   // la fog vive QUI (esplorazione = stato di gioco)
  playerPos?: {q;r}; travelDays?: number; travelDistanceKm?: number;
  hoursPerDay?: number; scale?: MapScale; vehicle?: Vehicle;
}
ExplorationDocument = { schemaVersion; mapId; fog; playerPos?; travelDays?; travelDistanceKm? }
```
Terreni (10): plains, forest, mountain, hills, desert, **mesa**, swamp, **volcano**,
**water, deepwater** (`isWaterTerrain`). Overlay: lineari `river`/`road` (ancore); **effetti
a tutta casella** (`shape:'effect'`, veli su `HexTile.snow/volcanic/ice`,
mutuamente esclusivi): `snow` (bianco, terra), `volcanic` (rosso, terra), `ice`
(azzurro, acqua); simboli `ruins/village/city/fortress/cave/sanctuary/dungeon/oasis`
(terra) + `reef/shoal` (acqua). Ogni overlay ha `on` `'land'|'water'|'both'`
(`overlayAllowedOn`). Helper: `keyOf/parseKey`, `getTile`, `altitudeOf` (Montagna/
Vulcano+2, Collina/Mesa+1, altri 0), `edgesAdjacent`, `nextRotation`, `isWaterTerrain`.

### Decisioni chiave

- **i18n**: `store.lang` (default `'en'`, **senza persistenza** → al reload torna
  inglese) pilota `useT()`. I nomi di terreni/overlay si traducono per id
  (`t('terrain.<id>')` / `t('overlay.<id>')`); i `name` in `tiles.json` restano solo
  come fallback. `formatTravel` riceve le abbreviazioni giorno/ora tradotte
  (`unit.day`/`unit.hour`). I messaggi d'errore di `parseImport` sono CHIAVI i18n,
  tradotte dal chiamante. I messaggi `error` lato server NON sono tradotti per-client.
- **Coordinate**: assiali `(q,r)` per memorizzare (chiave `"q,r"`); cubiche per gli
  algoritmi (distanza, vicini, linee, `cubeRange`/`cubeRing`). La geometria pixel
  (centro/angoli/`pointToAxial`) è SOLO in `hex/layout.ts` via honeycomb, così
  rendering e hit-testing restano coerenti. Rettangolo = traverser `rectangle`;
  esagonale = disco cubico.
- **Rendering (PixiManager)**: `Container` *world* pannabile/zoomabile; layer dal
  basso: terreno, percorsi (Graphics), overlay-simbolo, fog, bordo giocatori
  (Graphics), ancore (Graphics), hover. **Culling viewport + pool sprite** (terreno/
  overlay/fog hanno pool dedicati): si disegnano solo gli hex visibili, niente
  redraw per-frame. Texture generate a runtime. **Opzione estetica A (motivi
  procedurali)**: NON più tile a colore piatto tinto — c'è **una texture per
  terreno** (`terrainTextures`) col colore base + un piccolo motivo vettoriale
  ("cotto" dentro, niente tint) disegnato da `drawTerrainMotif` (erba/alberi/
  picchi/onde/dune/canne/colline), più una texture `''` per l'hex vuoto. Anche gli
  **overlay-simbolo** (rovine/insediamento) hanno colore+motivo cotti via
  `drawOverlayMotif`: emblemi compatti e contornati che NON riempiono l'hex, così
  il terreno sotto resta leggibile. I motivi restano entro ~0.6·`hexSize` (validi
  pointy e flat). `exportPNG` rende l'intera mappa a fasi su un container temporaneo.
- **Fog / modalità**: stesso `MapDocument` per GM e Giocatore. GM vede tutto con
  velo leggero su hidden/explored; Giocatore: hidden coperto, explored attenuato,
  visible pieno (sola lettura). Pennello fog manuale + Rivela/Nascondi tutto.
- **Esplorazione (LoS)**: `playerPos` con bordo blu. LoS per terreno+altitudine
  (vedi `hex/los.ts`): Pianura/Acqua=dist1; Foresta/Deserto/Palude=solo sé;
  Montagna=dist1 + dist2 se intermedio altitudine<2; Collina=dist1 + dist2 se <1.
  (Neve ora è un overlay, non un terreno; Acqua profonda usa la regola di Acqua.)
  Spostando i giocatori: hex in LoS→visible, usciti dalla vista→explored.
  L'esplorazione automatica avviene SOLO per: passo adiacente, prima posizione, e
  "segui percorso più breve". "Sposta senza viaggio" e "ore manuali" muovono SENZA
  esplorare. **Non si può spostare i giocatori dove il mezzo attivo non può andare**
  (`requestMovePlayers` controlla `canEnter`).
- **Tempo/distanza di viaggio (motore CSV, `data/travel.ts`)**: i costi derivano dal
  CSV "hexcrawl percorrenze". `crossingDays(doc,key) = km_hex(scala) / km_giorno(mezzo,
  terreno) × moltiplicatore_terreno × ∏ mod_overlay`; `Infinity` se impercorribile.
  Scala (`SCALES`: local 3mi/4.8km, regional 6/9.7, kingdoms 15/24, continents 30/48;
  default regional) e mezzo (`VEHICLES`; default foot) stanno NEL doc. Moltiplicatori
  terreno e km/giorno costanti tra scale (solo km_hex cambia). Mod overlay: strada
  (0.85/0.7/0.65/0.8 per piede/cavallo/carrozza/carovana), fiume (terra 1.15; barca
  0.75; nave 0.9), neve (1.75/2.0/3.0/2.5; acqua 1.1), **terra vulcanica**
  (2.0/2.25/3.0/2.75), oasi 0.9 solo su deserto; **gap-fill**: reef 1.2 / shoal 1.15
  per i mezzi d'acqua. **Vulcano**: terreno, moltiplicatore 3.0, LoS come Montagna.
  **Mesa**: terreno, moltiplicatore 1.75, LoS come Collina.
  Percorribilità (`canEnter`/`canEnterTile`): mezzi terrestri non su acqua;
  carrozza/carovana in montagna+**vulcano** (e carrozza in palude) solo con Strada;
  mezzi d'acqua solo su acqua, MA la **barca risale i Fiume** su terra (nave no).
  **Ghiaccio** (`ice`): l'acqua ghiacciata blocca i mezzi d'acqua ma è valicabile
  dai mezzi terrestri a grande difficoltà (km/giorno-terreno × `ICE_LAND_MULT`=3.0). `travelDays`/`travelDistanceKm` accumulati (`undefined`=N/D); distanza in
  km, mostrata in km o mi (preferenza UI `store.distanceUnit`, selettore in alto a
  destra). Display tempo `Ng Nh Nm` (minuti) via `formatTravel`; distanza via
  `formatDistance`. Pulsanti **±¼ giorno** (`adjustTravelDays`). Spostamento non
  adiacente → popup (senza viaggio / ore manuali / percorso più breve); solo
  adiacente e percorso più breve sommano tempo+distanza. `pathfind` salta gli hex
  impercorribili e mantiene la preferenza-strade lessicografica. Undo/Reset
  tempo/Reset esplorazione coprono anche la distanza.
- **Strade/fiumi (overlay lineari)**: NON sono overlay-simbolo, sono **percorsi ad
  ancore** (`HexTile.paths`). Selezione guidata: clic su un'ancora (lato), si
  lavora su entrambi gli esagoni del lato; ancore utilizzabili (non adiacenti) col
  bordo giallo; 2 uscite=arco, 3=incrocio; selezionate gialle, usate blu. Un
  elemento si modifica/cancella solo riselezionandone le ancore.
- **Persistenza/export**: Dexie salva l'intero doc (autosave debounce 700ms,
  esplorazione inclusa). Export: mappa completa / mappa pulita (esplorazione
  azzerata, LoS iniziale riapplicata) / solo esplorazione (`{fog, playerPos,
  travelDays, travelDistanceKm}`) / PNG. Tutti JSON con `schemaVersion`; import
  speculare con controllo `mapId`. `scale`/`vehicle` sono campi opzionali del doc
  (retro-compatibili, preservati nel salvataggio e nel sync).
- **Realtime (Cloudflare Workers + Durable Objects)**: il Worker (`worker/src/
  index.ts`) instrada soltanto; `GET /session/:id/websocket` → DO
  `HEX_SESSIONS.idFromName(sessionId)`. Il **Durable Object `HexSession`** è
  autoritativo per la sessione: `MapDocument` in `ctx.storage` (SQLite) + cache in
  memoria; **WebSocket Hibernation API** (`acceptWebSocket`/`webSocketMessage`/
  `webSocketClose`, metadati ruolo/nome/id via `serializeAttachment`). Il DM emette
  `patch`/`fogUpdate` per singolo hex e `fullState` per le operazioni bulk
  (revealAll/hideAll, resize, move/undo, reset, name, hoursPerDay, scala, mezzo,
  ±¼ giorno). I player sono read-only: il DO rifiuta le loro modifiche con `error`.
  Il client (`client/src/sync/SyncClient.ts`): il DM fa `POST /session` per il
  codice e connette inviando la `map` nel `join`; niente più `welcome` (ruolo noto
  lato client, sessionId nell'URL); riconnessione via `join` che fa rinviare
  `fullState`.

### Protocollo realtime (`@hexjourney/shared/protocol`, discriminato per `type`)

| Messaggio | Direzione | Significato |
|---|---|---|
| `join { sessionId, role, name?, map? }` | client→server | ingresso; il DM con `map` inizializza il DO |
| `patch { tileKey, tile }` | client→server | singolo hex (solo DM) |
| `fogUpdate { tileKey, fog }` | client→server | fog di un hex (solo DM) |
| `fullState { map }` | bidir. | DM: operazioni bulk · server: snapshot a chi entra/resync |
| `requestFullState` | client→server | resync |
| `presence { players }` | server→client | presenti (id/role/name) |
| `error { message }` | server→client | errore (es. modifica da player) |

Routing HTTP del Worker: `GET /health` → `{ok:true}`; `POST /session` →
`{sessionId}` casuale; `GET /session/:id/websocket` → upgrade verso il DO.

## Workflow di sviluppo e insidie (alto valore)

- **Monorepo workspaces**: lancia gli script dalla **root** (`npm run build:client`,
  `npm run dev:client`, `npm -w worker run ...`). Il **cwd del tool Bash persiste**:
  un `cd .../worker` precedente cambia dove girano i comandi → usa
  `npm --prefix /c/HEXplorer ...` o resetta con un `cd /c/HEXplorer` a sé stante.
  Il preview MCP "web" (`.claude/launch.json`) ora lancia `npm run dev:client`.
- **Dev globals** (solo `import.meta.env.DEV`): `window.__pixi` (PixiManager: `.doc`,
  `.cellByKey`, `.relEdgeMids`, `.world`, `.anchorIndex`, getter
  `activeCount/poolCount/cellCount`) e `window.__store` (= useMapStore;
  `.getState()`). Usali per ispezionare e guidare i test.
- **Letture stale via preview_eval**: zustand `set` è sincrono ma `__pixi.doc` si
  aggiorna solo dopo il giro React→`setDoc` (effetto/rAF). Leggi lo stato in una
  **eval separata** successiva, o leggi `window.__store.getState().doc` (subito
  aggiornato). Stesso problema cliccando un bottone e cercandone uno appena comparso
  nello stesso eval (la UI si re-renderizza async): fai i passi in eval separate.
- **Guidare il canvas**: dispatcha `PointerEvent`/`WheelEvent` direttamente sul
  `.hex-canvas canvas` (bypassa i backdrop dei dialog). hex→client:
  `clientX = rect.left + cell.x*scale + world.x` (cell da `__pixi.cellByKey`, scale
  `__pixi.world.scale.x`). Le ancore si ricostruiscono al cull (rAF) dopo lo switch
  a Strada/Fiume → clicca le ancore in una eval separata.
- **Catturare i download**: override `URL.createObjectURL` per leggere l'ultimo Blob
  (`.text()`); il PNG usa `a.href` data-URL.
- **Realtime in locale**: `npm -w worker run dev` (wrangler dev, miniflare offline)
  espone il Worker su :8787; testabile con `curl /health`, `POST /session`, e WS
  pilotati da `preview_eval` (due socket gm/player). **Liberare la porta 8787**
  (PowerShell): `Get-NetTCPConnection -LocalPort 8787 -State Listen | ...
  Stop-Process -Id $_.OwningProcess -Force`. Validazione build worker senza deploy:
  `npm -w worker run dry-run`. Il preview a volte si ferma → rilancia `preview_start`.
- **Pixi v8**: `app.canvas` è tipizzato `ICanvas` (metodi DOM opzionali) → nel
  PixiManager c'è un getter `canvas` castato a `HTMLCanvasElement`. StrictMode monta
  due volte: `init` è async e `destroy` idempotente.
- Aggiungere campi al `MapDocument` è retro-compatibile (campi opzionali); il
  validatore `isMapDocument` in `shared/model` (usato dal worker) non li valida ma
  li preserva (il DO memorizza l'intero oggetto map).
