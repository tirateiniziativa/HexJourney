import { create } from 'zustand'
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_TILE,
  defaultRandomEventsState,
  defaultWeatherState,
  ensureRandomEventsState,
  ensureWeatherState,
  keyOf,
  nextRotation,
  parseKey,
  type Edge,
  type ExplorationDocument,
  type FogState,
  type HexTile,
  isWaterTerrain,
  type MapDocument,
  type MapScale,
  type MapShape,
  type Orientation,
  type RandomEventsState,
  type RandomEventType,
  type Rotation,
  type Season,
  type Vehicle,
  type WeatherState,
  type WeatherType,
} from '@/model/types'
import { axialDistance, type Axial } from '@/hex/coordinates'
import { mapCoords } from '@/hex/layout'
import { centerHex, lineOfSight } from '@/hex/los'
import { shortestPath } from '@/hex/pathfind'
import { OVERLAYS, TERRAINS, overlayAllowedOn } from '@/data/catalog'
import { DEFAULT_SCALE, DEFAULT_VEHICLE, crossingDays, isBlocked, kmPerHex } from '@/data/travel'
import { applyRoll, rollWeather, setManualWeather, type WeatherRollResult } from '@/data/weather'
import {
  applyNoneRoll,
  confirmRandomEvent as applyConfirmEvent,
  replaceRandomEvent as applyReplaceEvent,
  rollRandomEvent,
  type PendingRandomEventResolution,
  type RandomEventRollResult,
} from '@/data/randomEvents'
import { emitFog, emitFullState, emitPatch } from '@/sync/bridge'
import type { ConnectionStatus, PlayerInfo, Role } from '@/sync/protocol'
import { DEFAULT_LANG, type Lang } from '@/i18n'

export type Mode = 'gm' | 'player'

/** Modalità laterale attiva: pennello (mondo), esplorazione (fog/giocatori) o pan. */
export type Tool = 'brush' | 'explore' | 'pan'

/** Cosa dipinge il pennello. */
export type BrushKind = 'terrain' | 'overlay' | 'fog' | 'players' | 'effect'

/** Effetti a tutta casella (overlay "vela"): neve, terra vulcanica, ghiaccio. */
export type EffectKind = 'snow' | 'volcanic' | 'ice'

interface PlayerUndoEntry {
  pos: { q: number; r: number } | null
  /** fog precedente degli hex modificati dallo spostamento */
  fog: Record<string, FogState>
  /** tempo di viaggio precedente (giorni) per ripristinarlo all'annulla */
  travel: number | undefined
  /** distanza percorsa precedente (km) per ripristinarla all'annulla */
  distance: number | undefined
  /** meteo precedente, per ripristinarlo all'annulla */
  weather: WeatherState | undefined
  /** stato Eventi Casuali precedente, per ripristinarlo all'annulla */
  randomEvents: RandomEventsState | undefined
}

export type DistanceUnit = 'km' | 'mi'

export interface NewMapOptions {
  name: string
  width: number
  height: number
  orientation: Orientation
  shape: MapShape
  hexSize?: number
  /** se true, posiziona i giocatori al centro e applica la LoS iniziale */
  playersAtCenter?: boolean
  /** terreno con cui inizializzare ogni casella (vuoto = casella non dipinta) */
  baseTerrain?: string
}

export const DEFAULT_HEX_SIZE = 32
export const MIN_DIM = 5
export const MAX_DIM = 200

interface MapState {
  doc: MapDocument | null
  mode: Mode
  tool: Tool
  brushKind: BrushKind
  selectedTerrain: string
  selectedOverlay: string
  selectedEffect: EffectKind
  selectedRotation: Rotation
  fogBrush: FogState
  hovered: Axial | null
  /** lingua dell'interfaccia (default: inglese) */
  lang: Lang
  /** unità di misura per la distanza (preferenza UI, default km) */
  distanceUnit: DistanceUnit
  /** stack per annullare gli spostamenti dei giocatori */
  playerUndo: PlayerUndoEntry[]
  /** spostamento non adiacente in attesa di conferma (popup) */
  pendingPlayerMove: { q: number; r: number } | null
  /** ultimo esito del roll meteo (transient, per il pannello probabilità) */
  weatherRoll: WeatherRollResult | null
  /** proposta di evento casuale in attesa di decisione del DM (SOLO client GM,
   * mai sincronizzata: i player non la vedono) */
  pendingRandomEvent: PendingRandomEventResolution | null
  /** ultimo roll di evento casuale (transient, per probabilità/motivi nella UI) */
  randomEventRoll: RandomEventRollResult | null

  // --- sessione realtime ---
  sessionId: string | null
  sessionRole: Role | null
  sessionStatus: ConnectionStatus
  sessionPlayers: PlayerInfo[]
  sessionError: string | null

  createMap: (opts: NewMapOptions) => void
  loadDoc: (doc: MapDocument) => void
  setMode: (mode: Mode) => void
  setTool: (tool: Tool) => void
  setSelectedTerrain: (id: string) => void
  setSelectedOverlay: (id: string) => void
  setSelectedRotation: (rotation: Rotation) => void
  rotateSelection: () => void
  setFogBrush: (fog: FogState) => void
  setPlayerTool: () => void
  /** Seleziona il pennello "effetto" (neve/terra vulcanica/ghiaccio). */
  setEffectTool: (effect: EffectKind) => void
  setHoursPerDay: (hours: number) => void
  setHovered: (hovered: Axial | null) => void
  /** Cambia la lingua dell'interfaccia. */
  setLang: (lang: Lang) => void
  /** Cambia l'unità di misura della distanza (preferenza UI). */
  setDistanceUnit: (unit: DistanceUnit) => void
  /** Cambia la scala della mappa (miglia/km per esagono). */
  setScale: (scale: MapScale) => void
  /** Cambia il mezzo di trasporto attivo. */
  setVehicle: (vehicle: Vehicle) => void
  /** Cambia la stagione della campagna (influenza le probabilità meteo). */
  setSeason: (season: Season) => void
  /** Override manuale del meteo attuale (DM): nessun roll, consecutiveDays=1. */
  setWeatherManual: (weather: WeatherType) => void
  /** Avanza di un giorno: lancia il roll meteo sul tile corrente e aggiorna lo stato. */
  advanceDay: () => void
  /** Attiva/disattiva gli Eventi Casuali. */
  setRandomEventsEnabled: (enabled: boolean) => void
  /** Genera manualmente un evento sul tile corrente (senza muoversi). */
  rollRandomEventNow: () => void
  /** Inserisce direttamente un evento scelto dal DM (trattato come generato),
   * senza estrazione né proposta. */
  setRandomEventManual: (event: RandomEventType) => void
  /** DM: conferma l'evento proposto (lo invia ai player, aggiorna i pesi). */
  confirmRandomEvent: () => void
  /** DM: scarta l'evento proposto (annullamento totale del roll). */
  discardRandomEvent: () => void
  /** DM: sostituisce con un evento scelto manualmente (trattato come generato). */
  replaceRandomEvent: (event: RandomEventType) => void
  /** Aggiunge/sottrae manualmente al tempo di viaggio (delta in giorni). */
  adjustTravelDays: (deltaDays: number) => void
  /** Imposta/rimuove un effetto a tutta casella sull'hex; on=false azzera tutti
   * gli effetti. Snow/volcanic solo su terra, ice solo su acqua. */
  setTileEffect: (q: number, r: number, effect: EffectKind, on: boolean) => void

  /** Sposta i giocatori sull'hex (q, r) e ricalcola la fog via line-of-sight. */
  movePlayers: (q: number, r: number) => void
  /** Richiesta di spostamento: diretto se prima posizione/adiacente, altrimenti
   * apre il popup di scelta (non adiacente). */
  requestMovePlayers: (q: number, r: number) => void
  /** Risolve lo spostamento non adiacente in attesa.
   * - 'shortest': somma il percorso più breve ed esplora il tragitto (LoS).
   * - 'noTravel': sposta senza aggiungere tempo e senza esplorazione automatica.
   * - 'manual': aggiunge `hours` ore, senza esplorazione automatica. */
  confirmPlayerMove: (mode: 'noTravel' | 'shortest' | 'manual', hours?: number) => void
  /** Chiude il popup senza spostare. */
  cancelPlayerMove: () => void
  /** Annulla l'ultimo spostamento dei giocatori. */
  undoPlayers: () => void
  /** Reset esplorazione: tutto nascosto, posizione e tempo di viaggio azzerati
   * (si riparte dall'inserimento iniziale della posizione). */
  resetExploration: () => void
  /** Azzera solo il tempo di viaggio (0 se i giocatori sono posizionati, N/D
   * altrimenti), mantenendo fog e posizione. */
  resetTravel: () => void
  /** Cambia il nome della mappa. */
  setMapName: (name: string) => void

  /** Dipinge il terreno sull'hex (q, r). Crea il tassello se assente. */
  setTerrainAt: (q: number, r: number, terrain: string) => void
  /** Imposta/rimuove (overlay vuoto = rimuovi) l'overlay sull'hex (q, r). */
  setOverlayAt: (q: number, r: number, overlay: string, rotation: Rotation) => void
  /** Imposta lo stato di fog sull'hex (q, r). */
  setFogAt: (q: number, r: number, fog: FogState) => void
  /** Imposta l'insieme dei lati-uscita di un tipo di percorso sull'hex
   * (lista vuota = rimuove il percorso di quel tipo). */
  setPath: (hexKey: string, kind: string, edges: Edge[]) => void
  /** Rivela tutta la mappa (fog = visible su ogni hex). */
  revealAll: () => void
  /** Nasconde tutta la mappa (fog = hidden ovunque). */
  hideAll: () => void

  /** Ridimensiona la mappa: gli hex fuori dai nuovi limiti vengono rimossi. */
  resizeMap: (width: number, height: number) => void
  /** Applica uno stato di sola esplorazione SOPRA la mappa corrente. */
  applyExploration: (exploration: ExplorationDocument) => void

  // --- applicazione di aggiornamenti remoti (niente echo verso il server) ---
  applyRemoteTile: (tileKey: string, tile: HexTile) => void
  applyRemoteFog: (tileKey: string, fog: FogState) => void

  // --- gestione stato sessione ---
  setSessionInfo: (sessionId: string, role: Role) => void
  setSessionStatus: (status: ConnectionStatus) => void
  setSessionPlayers: (players: PlayerInfo[]) => void
  setSessionError: (error: string | null) => void
  clearSession: () => void
}

/** Applica la line-of-sight della posizione `pos`: gli hex in LoS diventano
 * visibili, quelli prima visibili e ora fuori vista diventano esplorati, e gli
 * hex del percorso (`extraExplored`) diventano almeno esplorati.
 * Ritorna i nuovi tiles e la fog precedente degli hex modificati (per l'annulla). */
function computeFogForMove(
  doc: MapDocument,
  pos: Axial,
  extraExplored: string[] = [],
): { tiles: Record<string, HexTile>; changed: Record<string, FogState> } {
  const los = lineOfSight(doc, pos)
  const tiles = { ...doc.tiles }
  const changed: Record<string, FogState> = {}
  const record = (k: string) => {
    if (!(k in changed)) changed[k] = doc.tiles[k]?.fog ?? 'hidden'
  }
  // hex del percorso percorso -> almeno esplorati
  for (const k of extraExplored) {
    const t = tiles[k] ?? DEFAULT_TILE
    if (t.fog === 'hidden') {
      record(k)
      tiles[k] = { ...t, fog: 'explored' }
    }
  }
  // chi era visibile e ora è fuori LoS -> esplorato
  for (const [k, t] of Object.entries(doc.tiles)) {
    if (t.fog === 'visible' && !los.has(k)) {
      record(k)
      tiles[k] = { ...(tiles[k] ?? t), fog: 'explored' }
    }
  }
  // gli hex in LoS -> visibili
  for (const k of los) {
    const t = tiles[k] ?? DEFAULT_TILE
    if (t.fog !== 'visible') {
      record(k)
      tiles[k] = { ...t, fog: 'visible' }
    }
  }
  return { tiles, changed }
}

/** Esplora un intero tragitto applicando la LoS a ogni esagono percorso: la LoS
 * dell'ultimo hex resta visibile, tutto il resto visto lungo il cammino diventa
 * esplorato. */
function computeFogAlongPath(
  doc: MapDocument,
  pathHexes: Axial[],
): { tiles: Record<string, HexTile>; changed: Record<string, FogState> } {
  const inMap = new Set(mapCoords(doc).map((c) => keyOf(c.q, c.r)))
  const finalLoS = lineOfSight(doc, pathHexes[pathHexes.length - 1], inMap)
  const seen = new Set<string>()
  for (const h of pathHexes) for (const k of lineOfSight(doc, h, inMap)) seen.add(k)

  const tiles = { ...doc.tiles }
  const changed: Record<string, FogState> = {}
  const record = (k: string) => {
    if (!(k in changed)) changed[k] = doc.tiles[k]?.fog ?? 'hidden'
  }
  // chi era visibile e ora è fuori dalla LoS finale -> esplorato
  for (const [k, t] of Object.entries(doc.tiles)) {
    if (t.fog === 'visible' && !finalLoS.has(k)) {
      record(k)
      tiles[k] = { ...t, fog: 'explored' }
    }
  }
  // tutto ciò che si è visto lungo il cammino (non nella LoS finale) -> esplorato
  for (const k of seen) {
    if (finalLoS.has(k)) continue
    const t = tiles[k] ?? DEFAULT_TILE
    if (t.fog === 'hidden') {
      record(k)
      tiles[k] = { ...t, fog: 'explored' }
    }
  }
  // LoS finale -> visibile
  for (const k of finalLoS) {
    const t = tiles[k] ?? DEFAULT_TILE
    if (t.fog !== 'visible') {
      record(k)
      tiles[k] = { ...t, fog: 'visible' }
    }
  }
  return { tiles, changed }
}

/** Esegue un roll di evento casuale sul tile `key` (col meteo del doc passato) e
 * ne calcola l'esito: se disattivato non fa nulla; se "none" applica subito
 * l'esito allo stato persistente (nessuna proposta); altrimenti lascia lo stato
 * invariato e produce una proposta PENDING (solo lato GM). */
function resolveEventRoll(
  doc: MapDocument,
  key: string,
): { randomEvents: RandomEventsState; pending: PendingRandomEventResolution | null; roll: RandomEventRollResult | null } {
  const state = ensureRandomEventsState(doc.randomEvents)
  if (!state.enabled) return { randomEvents: state, pending: null, roll: null }
  const roll = rollRandomEvent({ map: doc, tileKey: key, weather: doc.weather, randomEvents: state })
  if (roll.proposedEvent === 'none') {
    return { randomEvents: applyNoneRoll(state), pending: null, roll }
  }
  return {
    randomEvents: state, // non applicato finché il DM non decide
    pending: {
      proposedEvent: roll.proposedEvent,
      preRollState: state,
      probabilities: roll.probabilities,
      reasonSummary: roll.reasonSummary,
    },
    roll,
  }
}

export const useMapStore = create<MapState>((set, get) => ({
  doc: null,
  mode: 'gm',
  tool: 'brush',
  brushKind: 'terrain',
  selectedTerrain: TERRAINS[0]?.id ?? 'plains',
  selectedOverlay: OVERLAYS[0]?.id ?? 'river',
  selectedEffect: 'snow',
  selectedRotation: 0,
  fogBrush: 'visible',
  hovered: null,
  lang: DEFAULT_LANG,
  distanceUnit: 'km',
  playerUndo: [],
  pendingPlayerMove: null,
  weatherRoll: null,
  pendingRandomEvent: null,
  randomEventRoll: null,

  sessionId: null,
  sessionRole: null,
  sessionStatus: 'idle',
  sessionPlayers: [],
  sessionError: null,

  createMap: (o) =>
    set(() => {
      const doc: MapDocument = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: crypto.randomUUID(),
        name: o.name.trim() || 'Untitled map',
        orientation: o.orientation,
        shape: o.shape,
        hexSize: o.hexSize ?? DEFAULT_HEX_SIZE,
        width: o.width,
        height: o.height,
        tiles: {},
        hoursPerDay: 24,
        scale: DEFAULT_SCALE,
        vehicle: DEFAULT_VEHICLE,
        weather: defaultWeatherState(),
        randomEvents: defaultRandomEventsState(),
      }
      // Terreno di base: inizializza ogni casella della mappa al terreno scelto
      // (es. "water" per una mappa marina). Vuoto = caselle non dipinte.
      const base = o.baseTerrain ?? ''
      if (base) {
        const tiles: Record<string, HexTile> = {}
        for (const { q, r } of mapCoords(doc)) {
          tiles[keyOf(q, r)] = { ...DEFAULT_TILE, terrain: base }
        }
        doc.tiles = tiles
      }
      if (o.playersAtCenter) {
        const center = centerHex(doc)
        if (center) {
          doc.playerPos = center
          doc.travelDays = 0 // posizione indicata per la prima volta
          doc.travelDistanceKm = 0
          const los = lineOfSight(doc, center)
          // mantiene il terreno di base, rivelando (fog visible) la LoS iniziale
          const tiles: Record<string, HexTile> = { ...doc.tiles }
          for (const k of los) {
            const prev = tiles[k] ?? DEFAULT_TILE
            tiles[k] = { ...prev, fog: 'visible' }
          }
          doc.tiles = tiles
        }
      }
      return { doc, playerUndo: [] }
    }),

  loadDoc: (doc) =>
    set({
      doc: {
        ...doc,
        weather: ensureWeatherState(doc.weather),
        randomEvents: ensureRandomEventsState(doc.randomEvents),
      },
      playerUndo: [],
      pendingPlayerMove: null,
      weatherRoll: null,
      pendingRandomEvent: null,
      randomEventRoll: null,
    }),
  setMode: (mode) => set({ mode }),
  setTool: (tool) =>
    set((s) => {
      if (tool === 'brush' && (s.brushKind === 'fog' || s.brushKind === 'players')) {
        return { tool, brushKind: 'terrain' }
      }
      if (
        tool === 'explore' &&
        (s.brushKind === 'terrain' || s.brushKind === 'overlay' || s.brushKind === 'effect')
      ) {
        // entrando in Esplorazione lo strumento di default è "Sposta giocatori"
        return { tool, brushKind: 'players' }
      }
      return { tool }
    }),
  setSelectedTerrain: (selectedTerrain) =>
    set({ selectedTerrain, brushKind: 'terrain', tool: 'brush' }),
  setSelectedOverlay: (selectedOverlay) =>
    set({ selectedOverlay, brushKind: 'overlay', tool: 'brush' }),
  setSelectedRotation: (selectedRotation) => set({ selectedRotation }),
  rotateSelection: () => set((s) => ({ selectedRotation: nextRotation(s.selectedRotation) })),
  setFogBrush: (fogBrush) => set({ fogBrush, brushKind: 'fog', tool: 'explore' }),
  setPlayerTool: () => set({ brushKind: 'players', tool: 'explore' }),
  setEffectTool: (selectedEffect) => set({ selectedEffect, brushKind: 'effect', tool: 'brush' }),
  setHoursPerDay: (hours) =>
    set((s) => {
      if (!s.doc) return {}
      const hoursPerDay = Math.max(6, Math.min(30, Math.round(hours)))
      const doc = { ...s.doc, hoursPerDay }
      emitFullState(doc)
      return { doc }
    }),
  setHovered: (hovered) => set({ hovered }),
  setLang: (lang) => set({ lang }),
  setDistanceUnit: (distanceUnit) => set({ distanceUnit }),

  setScale: (scale) =>
    set((s) => {
      if (!s.doc) return {}
      const doc = { ...s.doc, scale }
      emitFullState(doc)
      return { doc }
    }),

  setVehicle: (vehicle) =>
    set((s) => {
      if (!s.doc) return {}
      const doc = { ...s.doc, vehicle }
      emitFullState(doc)
      return { doc }
    }),

  setSeason: (season) =>
    set((s) => {
      if (!s.doc) return {}
      const weather = { ...ensureWeatherState(s.doc.weather), season }
      const doc = { ...s.doc, weather }
      emitFullState(doc)
      return { doc }
    }),

  setWeatherManual: (weather) =>
    set((s) => {
      if (!s.doc) return {}
      const next = setManualWeather(ensureWeatherState(s.doc.weather), weather)
      const doc = { ...s.doc, weather: next }
      emitFullState(doc)
      return { doc, weatherRoll: null }
    }),

  advanceDay: () =>
    set((s) => {
      if (!s.doc) return {}
      const center = s.doc.playerPos ?? centerHex(s.doc)
      if (!center) return {}
      const key = keyOf(center.q, center.r)
      const state = ensureWeatherState(s.doc.weather)
      const result = rollWeather({ map: s.doc, tileKey: key, season: state.season, currentWeather: state })
      const doc = { ...s.doc, weather: applyRoll(state, result.next) }
      emitFullState(doc)
      return { doc, weatherRoll: result }
    }),

  setRandomEventsEnabled: (enabled) =>
    set((s) => {
      if (!s.doc) return {}
      const randomEvents = { ...ensureRandomEventsState(s.doc.randomEvents), enabled }
      const doc = { ...s.doc, randomEvents }
      emitFullState(doc)
      // disattivando si annulla anche l'eventuale proposta pending
      return { doc, pendingRandomEvent: null, randomEventRoll: enabled ? s.randomEventRoll : null }
    }),

  rollRandomEventNow: () =>
    set((s) => {
      if (!s.doc) return {}
      if (!ensureRandomEventsState(s.doc.randomEvents).enabled) return {}
      const center = s.doc.playerPos ?? centerHex(s.doc)
      if (!center) return {}
      const ev = resolveEventRoll(s.doc, keyOf(center.q, center.r))
      const doc = { ...s.doc, randomEvents: ev.randomEvents }
      emitFullState(doc)
      return { doc, pendingRandomEvent: ev.pending, randomEventRoll: ev.roll ?? s.randomEventRoll }
    }),

  setRandomEventManual: (event) =>
    set((s) => {
      if (!s.doc) return {}
      const state = ensureRandomEventsState(s.doc.randomEvents)
      if (!state.enabled) return {}
      const tileKey = s.doc.playerPos ? keyOf(s.doc.playerPos.q, s.doc.playerPos.r) : undefined
      // trattato come evento avvenuto (aggiorna lastConfirmed/cooldown), niente proposta
      const randomEvents = applyReplaceEvent(state, event, tileKey)
      const doc = { ...s.doc, randomEvents }
      emitFullState(doc)
      return { doc, pendingRandomEvent: null }
    }),

  confirmRandomEvent: () =>
    set((s) => {
      const pending = s.pendingRandomEvent
      if (!s.doc || !pending) return {}
      const tileKey = s.doc.playerPos ? keyOf(s.doc.playerPos.q, s.doc.playerPos.r) : undefined
      const randomEvents = applyConfirmEvent(pending.preRollState, pending.proposedEvent, tileKey)
      const doc = { ...s.doc, randomEvents }
      emitFullState(doc) // l'evento confermato raggiunge i player via fullState
      return { doc, pendingRandomEvent: null }
    }),

  discardRandomEvent: () =>
    set((s) => {
      const pending = s.pendingRandomEvent
      if (!s.doc || !pending) return {}
      // annullamento totale del roll: torna allo stato pre-roll (già invariato)
      const doc = { ...s.doc, randomEvents: pending.preRollState }
      emitFullState(doc)
      return { doc, pendingRandomEvent: null }
    }),

  replaceRandomEvent: (event) =>
    set((s) => {
      const pending = s.pendingRandomEvent
      if (!s.doc || !pending) return {}
      const tileKey = s.doc.playerPos ? keyOf(s.doc.playerPos.q, s.doc.playerPos.r) : undefined
      const randomEvents = applyReplaceEvent(pending.preRollState, event, tileKey)
      const doc = { ...s.doc, randomEvents }
      emitFullState(doc)
      return { doc, pendingRandomEvent: null }
    }),

  adjustTravelDays: (deltaDays) =>
    set((s) => {
      if (!s.doc) return {}
      const prevTravel = s.doc.travelDays
      const prevDist = s.doc.travelDistanceKm
      const travelDays = Math.max(0, (prevTravel ?? 0) + deltaDays)
      const doc = { ...s.doc, travelDays }
      emitFullState(doc)
      return {
        doc,
        playerUndo: [
          ...s.playerUndo,
          {
            pos: s.doc.playerPos ?? null,
            fog: {},
            travel: prevTravel,
            distance: prevDist,
            weather: ensureWeatherState(s.doc.weather),
            randomEvents: ensureRandomEventsState(s.doc.randomEvents),
          },
        ],
      }
    }),

  setTileEffect: (q, r, effect, on) =>
    set((s) => {
      if (!s.doc) return {}
      const key = keyOf(q, r)
      const prev = s.doc.tiles[key] ?? DEFAULT_TILE
      const water = isWaterTerrain(prev.terrain)
      if (on) {
        // ghiaccio solo su acqua; neve/terra vulcanica solo su terra
        if (effect === 'ice' ? !water : water) return {}
      }
      // gli effetti sono mutuamente esclusivi: azzera tutti, poi imposta quello scelto
      const tile: HexTile = { ...prev, snow: undefined, volcanic: undefined, ice: undefined }
      if (on) tile[effect] = true
      emitPatch(key, tile)
      return { doc: { ...s.doc, tiles: { ...s.doc.tiles, [key]: tile } } }
    }),

  setTerrainAt: (q, r, terrain) =>
    set((s) => {
      if (!s.doc) return {}
      const key = keyOf(q, r)
      const prev = s.doc.tiles[key] ?? DEFAULT_TILE
      if (prev.terrain === terrain) return {} // no-op: evita churn durante il drag
      const tile = { ...prev, terrain }
      emitPatch(key, tile)
      const tiles = { ...s.doc.tiles, [key]: tile }
      return { doc: { ...s.doc, tiles } }
    }),

  setOverlayAt: (q, r, overlay, rotation) =>
    set((s) => {
      if (!s.doc) return {}
      const key = keyOf(q, r)
      const prev = s.doc.tiles[key] ?? DEFAULT_TILE
      const nextOverlay = overlay || undefined
      // l'overlay deve essere applicabile al terreno (terra/acqua)
      if (nextOverlay && !overlayAllowedOn(nextOverlay, isWaterTerrain(prev.terrain))) return {}
      if (prev.overlay === nextOverlay && prev.rotation === rotation) return {}
      const tile = { ...prev, overlay: nextOverlay, rotation }
      // se l'overlay viene rimosso, normalizza la rotazione
      if (!nextOverlay) tile.rotation = 0
      emitPatch(key, tile)
      const tiles = { ...s.doc.tiles, [key]: tile }
      return { doc: { ...s.doc, tiles } }
    }),

  setFogAt: (q, r, fog) =>
    set((s) => {
      if (!s.doc) return {}
      const key = keyOf(q, r)
      const prev = s.doc.tiles[key] ?? DEFAULT_TILE
      if (prev.fog === fog) return {}
      emitFog(key, fog)
      const tiles = { ...s.doc.tiles, [key]: { ...prev, fog } }
      return { doc: { ...s.doc, tiles } }
    }),

  setPath: (hexKey, kind, edges) =>
    set((s) => {
      if (!s.doc) return {}
      const prev = s.doc.tiles[hexKey] ?? DEFAULT_TILE
      const others = (prev.paths ?? []).filter((p) => p.kind !== kind)
      const sorted = [...edges].sort((a, b) => a - b)
      const paths = sorted.length ? [...others, { kind, edges: sorted }] : others
      const tile: HexTile = { ...prev, paths: paths.length ? paths : undefined }
      emitPatch(hexKey, tile)
      return { doc: { ...s.doc, tiles: { ...s.doc.tiles, [hexKey]: tile } } }
    }),

  revealAll: () =>
    set((s) => {
      if (!s.doc) return {}
      const tiles = { ...s.doc.tiles }
      for (const { q, r } of mapCoords(s.doc)) {
        const key = keyOf(q, r)
        tiles[key] = { ...(tiles[key] ?? DEFAULT_TILE), fog: 'visible' }
      }
      const doc = { ...s.doc, tiles }
      emitFullState(doc)
      return { doc }
    }),

  hideAll: () =>
    set((s) => {
      if (!s.doc) return {}
      // gli hex senza voce sono già "hidden" per default: basta normalizzare quelli esistenti
      const tiles = { ...s.doc.tiles }
      for (const key of Object.keys(tiles)) {
        if (tiles[key].fog !== 'hidden') tiles[key] = { ...tiles[key], fog: 'hidden' }
      }
      const doc = { ...s.doc, tiles }
      emitFullState(doc)
      return { doc }
    }),

  resizeMap: (width, height) =>
    set((s) => {
      if (!s.doc) return {}
      const resized: MapDocument = { ...s.doc, width, height }
      // i nuovi hex restano vuoti (default: terreno vuoto, fog hidden);
      // quelli fuori dai nuovi limiti vengono scartati.
      const validKeys = new Set(mapCoords(resized).map((c) => keyOf(c.q, c.r)))
      const tiles: Record<string, HexTile> = {}
      for (const [key, tile] of Object.entries(s.doc.tiles)) {
        if (validKeys.has(key)) tiles[key] = tile
      }
      const doc = { ...resized, tiles }
      emitFullState(doc)
      return { doc }
    }),

  applyExploration: (exploration) =>
    set((s) => {
      if (!s.doc) return {}
      // l'esplorazione è autoritativa per la fog: azzera tutto, poi applica.
      const tiles = { ...s.doc.tiles }
      for (const key of Object.keys(tiles)) {
        if (tiles[key].fog !== 'hidden') tiles[key] = { ...tiles[key], fog: 'hidden' }
      }
      for (const [key, fog] of Object.entries(exploration.fog)) {
        const prev = tiles[key] ?? DEFAULT_TILE
        tiles[key] = { ...prev, fog }
      }
      const doc = {
        ...s.doc,
        tiles,
        playerPos: exploration.playerPos ?? s.doc.playerPos,
        travelDays: exploration.travelDays ?? s.doc.travelDays,
        travelDistanceKm: exploration.travelDistanceKm ?? s.doc.travelDistanceKm,
        weather: exploration.weather
          ? ensureWeatherState(exploration.weather)
          : ensureWeatherState(s.doc.weather),
        randomEvents: exploration.randomEvents
          ? ensureRandomEventsState(exploration.randomEvents)
          : ensureRandomEventsState(s.doc.randomEvents),
      }
      emitFullState(doc)
      return {
        doc,
        playerUndo: [],
        pendingPlayerMove: null,
        weatherRoll: null,
        pendingRandomEvent: null,
        randomEventRoll: null,
      }
    }),

  movePlayers: (q, r) =>
    set((s) => {
      if (!s.doc) return {}
      const pos = { q, r }
      const prevPos = s.doc.playerPos ?? null
      const prevTravel = s.doc.travelDays
      const prevDist = s.doc.travelDistanceKm
      const prevWeather = ensureWeatherState(s.doc.weather)
      const prevRandom = ensureRandomEventsState(s.doc.randomEvents)
      const { tiles, changed } = computeFogForMove(s.doc, pos)
      const adjacent = !!prevPos && axialDistance(prevPos, pos) === 1

      // Costo del passo col meteo CORRENTE (si attraversa "ora"); mai Infinity
      // (il gate in requestMovePlayers esclude gli hex bloccati, ma restiamo difensivi).
      let travelDays: number
      let travelDistanceKm: number | undefined
      if (!prevPos) {
        travelDays = 0
        travelDistanceKm = 0
      } else if (adjacent) {
        const cross = crossingDays(s.doc, keyOf(q, r))
        travelDays = (prevTravel ?? 0) + (Number.isFinite(cross) ? cross : 0)
        travelDistanceKm = (prevDist ?? 0) + kmPerHex(s.doc)
      } else {
        travelDays = prevTravel ?? 0
        travelDistanceKm = prevDist
      }

      // Meteo + Eventi Casuali: un roll all'arrivo di ogni passo adiacente.
      let weather = prevWeather
      let weatherRoll: WeatherRollResult | null = s.weatherRoll
      let randomEvents = prevRandom
      let pendingRandomEvent = s.pendingRandomEvent
      let randomEventRoll = s.randomEventRoll
      if (adjacent) {
        weatherRoll = rollWeather({
          map: s.doc,
          tileKey: keyOf(q, r),
          season: prevWeather.season,
          currentWeather: prevWeather,
        })
        weather = applyRoll(prevWeather, weatherRoll.next)
        // gli eventi usano il meteo aggiornato sul tile d'arrivo
        const ev = resolveEventRoll({ ...s.doc, weather }, keyOf(q, r))
        randomEvents = ev.randomEvents
        pendingRandomEvent = ev.pending
        randomEventRoll = ev.roll ?? randomEventRoll
      }
      const doc = { ...s.doc, tiles, playerPos: pos, travelDays, travelDistanceKm, weather, randomEvents }
      emitFullState(doc)
      return {
        doc,
        weatherRoll,
        pendingRandomEvent,
        randomEventRoll,
        playerUndo: [
          ...s.playerUndo,
          {
            pos: prevPos,
            fog: changed,
            travel: prevTravel,
            distance: prevDist,
            weather: prevWeather,
            randomEvents: prevRandom,
          },
        ],
      }
    }),

  requestMovePlayers: (q, r) => {
    const s = get()
    if (!s.doc) return
    const prev = s.doc.playerPos
    // La scelta della posizione INIZIALE è sempre libera (nessuna restrizione).
    if (!prev) {
      s.movePlayers(q, r)
      return
    }
    // Le mosse successive rispettano i blocchi (mezzo/terreno o meteo): non ci si
    // può spostare dove il mezzo attuale non può andare, neppure col percorso rapido.
    if (isBlocked(s.doc, keyOf(q, r))) return
    const d = axialDistance(prev, { q, r })
    if (d === 0) return
    if (d === 1) {
      s.movePlayers(q, r) // adiacente
      return
    }
    set({ pendingPlayerMove: { q, r } }) // non adiacente -> popup
  },

  confirmPlayerMove: (mode, hours) =>
    set((s) => {
      if (!s.doc || !s.pendingPlayerMove) return {}
      const pos = s.pendingPlayerMove
      const prevPos = s.doc.playerPos ?? null
      const prevTravel = s.doc.travelDays
      const prevDist = s.doc.travelDistanceKm
      const prevWeather = ensureWeatherState(s.doc.weather)
      const prevRandom = ensureRandomEventsState(s.doc.randomEvents)
      let travelDays = prevTravel ?? 0
      let travelDistanceKm = prevDist
      let tiles = s.doc.tiles
      let changed: Record<string, FogState> = {}
      let weather = prevWeather
      let weatherRoll: WeatherRollResult | null = s.weatherRoll
      let randomEvents = prevRandom
      let pendingRandomEvent = s.pendingRandomEvent
      let randomEventRoll = s.randomEventRoll

      if (mode === 'shortest' && prevPos) {
        // esplora il tragitto (LoS lungo il percorso) e somma durata + distanza
        const sp = shortestPath(s.doc, prevPos, pos)
        const pathHexes: Axial[] = sp ? [prevPos, ...sp.path.map(parseKey)] : [pos]
        if (sp) {
          travelDays = (prevTravel ?? 0) + sp.days
          travelDistanceKm = (prevDist ?? 0) + sp.path.length * kmPerHex(s.doc)
        }
        const res = computeFogAlongPath(s.doc, pathHexes)
        tiles = res.tiles
        changed = res.changed
        // un roll meteo all'arrivo del tragitto
        weatherRoll = rollWeather({
          map: s.doc,
          tileKey: keyOf(pos.q, pos.r),
          season: prevWeather.season,
          currentWeather: prevWeather,
        })
        weather = applyRoll(prevWeather, weatherRoll.next)
        // ...e un roll di evento casuale sul tile d'arrivo
        const ev = resolveEventRoll({ ...s.doc, weather }, keyOf(pos.q, pos.r))
        randomEvents = ev.randomEvents
        pendingRandomEvent = ev.pending
        randomEventRoll = ev.roll ?? randomEventRoll
      } else if (mode === 'manual') {
        // sposta senza esplorazione automatica, aggiungendo le ore indicate
        const hpd = s.doc.hoursPerDay ?? 24
        travelDays = (prevTravel ?? 0) + Math.max(0, hours ?? 0) / hpd
      }
      // 'noTravel': nessun cambiamento di fog, tempo, distanza o meteo

      const doc = { ...s.doc, tiles, playerPos: pos, travelDays, travelDistanceKm, weather, randomEvents }
      emitFullState(doc)
      return {
        doc,
        weatherRoll,
        pendingRandomEvent,
        randomEventRoll,
        playerUndo: [
          ...s.playerUndo,
          {
            pos: prevPos,
            fog: changed,
            travel: prevTravel,
            distance: prevDist,
            weather: prevWeather,
            randomEvents: prevRandom,
          },
        ],
        pendingPlayerMove: null,
      }
    }),

  cancelPlayerMove: () => set({ pendingPlayerMove: null }),

  undoPlayers: () =>
    set((s) => {
      if (!s.doc || s.playerUndo.length === 0) return {}
      const last = s.playerUndo[s.playerUndo.length - 1]
      const tiles = { ...s.doc.tiles }
      for (const [k, fog] of Object.entries(last.fog)) {
        const t = tiles[k] ?? DEFAULT_TILE
        tiles[k] = { ...t, fog }
      }
      const doc: MapDocument = {
        ...s.doc,
        tiles,
        playerPos: last.pos ?? undefined,
        travelDays: last.travel,
        travelDistanceKm: last.distance,
        weather: last.weather ?? ensureWeatherState(s.doc.weather),
        randomEvents: last.randomEvents ?? ensureRandomEventsState(s.doc.randomEvents),
      }
      emitFullState(doc)
      return {
        doc,
        playerUndo: s.playerUndo.slice(0, -1),
        weatherRoll: null,
        pendingRandomEvent: null,
        randomEventRoll: null,
      }
    }),

  resetExploration: () =>
    set((s) => {
      if (!s.doc) return {}
      const tiles = { ...s.doc.tiles }
      for (const k of Object.keys(tiles)) {
        if (tiles[k].fog !== 'hidden') tiles[k] = { ...tiles[k], fog: 'hidden' }
      }
      const doc: MapDocument = {
        ...s.doc,
        tiles,
        playerPos: undefined,
        travelDays: undefined,
        travelDistanceKm: undefined,
        weather: defaultWeatherState(),
        randomEvents: defaultRandomEventsState(),
      }
      emitFullState(doc)
      return {
        doc,
        playerUndo: [],
        pendingPlayerMove: null,
        weatherRoll: null,
        pendingRandomEvent: null,
        randomEventRoll: null,
      }
    }),

  resetTravel: () =>
    set((s) => {
      if (!s.doc) return {}
      const zeroed = s.doc.playerPos ? 0 : undefined
      const doc: MapDocument = { ...s.doc, travelDays: zeroed, travelDistanceKm: zeroed }
      emitFullState(doc)
      return { doc, playerUndo: [] }
    }),

  setMapName: (name) =>
    set((s) => {
      if (!s.doc) return {}
      const doc = { ...s.doc, name }
      emitFullState(doc)
      return { doc }
    }),

  applyRemoteTile: (tileKey, tile) =>
    set((s) => {
      if (!s.doc) return {}
      return { doc: { ...s.doc, tiles: { ...s.doc.tiles, [tileKey]: tile } } }
    }),

  applyRemoteFog: (tileKey, fog) =>
    set((s) => {
      if (!s.doc) return {}
      const prev = s.doc.tiles[tileKey] ?? DEFAULT_TILE
      return { doc: { ...s.doc, tiles: { ...s.doc.tiles, [tileKey]: { ...prev, fog } } } }
    }),

  setSessionInfo: (sessionId, role) => set({ sessionId, sessionRole: role }),
  setSessionStatus: (sessionStatus) => set({ sessionStatus }),
  setSessionPlayers: (sessionPlayers) => set({ sessionPlayers }),
  setSessionError: (sessionError) => set({ sessionError }),
  clearSession: () =>
    set({
      sessionId: null,
      sessionRole: null,
      sessionStatus: 'idle',
      sessionPlayers: [],
      sessionError: null,
    }),
}))

if (import.meta.env.DEV) {
  ;(window as unknown as { __store?: typeof useMapStore }).__store = useMapStore
}
