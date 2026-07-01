// Modello dati condiviso (client + worker). Unica fonte di verità per i tipi.
// Tutto è JSON puro e serializzabile: nessuna dipendenza da browser/Node.

export const CURRENT_SCHEMA_VERSION = 1

export type Orientation = 'pointy' | 'flat'

export type MapShape = 'rectangular' | 'hexagonal'

export type FogState = 'hidden' | 'explored' | 'visible'

export type Rotation = 0 | 60 | 120 | 180 | 240 | 300

/** Scala della mappa: determina quante miglia/km vale un esagono. */
export type MapScale = 'local' | 'regional' | 'kingdoms' | 'continents'

/** Mezzo di trasporto degli avventurieri (determina tempi e percorribilità). */
export type Vehicle = 'foot' | 'horse' | 'carriage' | 'caravan' | 'boat' | 'ship'

/** Stagione della campagna: pilota le probabilità base del meteo. */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

/** Tipi di meteo dinamico. */
export type WeatherType =
  | 'sunny'
  | 'cloudy'
  | 'rain'
  | 'storm'
  | 'snow'
  | 'blizzard'
  | 'fog'
  | 'heatwave'
  | 'sandstorm'
  | 'ashfall'
  | 'volcanicEruption'

/** Stato meteo corrente della campagna. Vive nello stato di esplorazione (non
 * nella geografia permanente): stagione + meteo attuale + inerzia (giorni
 * consecutivi) + meteo precedente. */
export interface WeatherState {
  current: WeatherType
  season: Season
  /** giorni consecutivi con lo stesso `current` (>= 1) */
  consecutiveDays: number
  /** meteo del giorno precedente (per log/undo) */
  previous?: WeatherType
  /** contatore dei roll/avanzamenti (per debug/log) */
  lastUpdatedTurn?: number
}

export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter']

export const WEATHER_TYPES: readonly WeatherType[] = [
  'sunny',
  'cloudy',
  'rain',
  'storm',
  'snow',
  'blizzard',
  'fog',
  'heatwave',
  'sandstorm',
  'ashfall',
  'volcanicEruption',
]

/** Indice di un lato dell'esagono (0..5), in senso orario dai corner di honeycomb. */
export type Edge = 0 | 1 | 2 | 3 | 4 | 5

/**
 * Percorso (strada/fiume) di un esagono: l'insieme dei lati "uscita".
 * - 2 uscite -> arco tra i due lati.
 * - 3 uscite -> incrocio con intersezione al centro.
 * Le uscite non possono essere adiacenti (quindi al massimo 3, alternate).
 */
export interface HexPath {
  /** id dell'overlay "lineare" dal catalogo, es. "river" | "road" */
  kind: string
  edges: Edge[]
}

export interface HexTile {
  /** id del terreno dal catalogo (stringa vuota = non dipinto) */
  terrain: string
  /** overlay-simbolo opzionale (rovine/villaggio/città...) */
  overlay?: string
  rotation: Rotation
  fog: FogState
  /** percorsi (strade/fiumi) come insiemi di lati-uscita per tipo */
  paths?: HexPath[]
  /** overlay neve: rende la casella bianca (solo terreni di terra) */
  snow?: boolean
  /** overlay terra vulcanica: vela rossastra (solo terreni di terra) */
  volcanic?: boolean
  /** overlay ghiaccio: vela su acqua (solo terreni d'acqua); blocca i mezzi
   * d'acqua ma permette il passaggio via terra a grande difficoltà */
  ice?: boolean
}

/** Due lati sono adiacenti se differiscono di 1 nel ciclo dei 6 lati. */
export function edgesAdjacent(a: Edge, b: Edge): boolean {
  return (a + 1) % 6 === b || (b + 1) % 6 === a
}

export interface MapDocument {
  schemaVersion: number
  id: string
  name: string
  orientation: Orientation
  shape?: MapShape // default "rectangular"
  hexSize: number
  width: number // numero di hex in larghezza
  height: number // numero di hex in altezza
  /** mappa "q,r" -> tassello. Gli hex senza voce usano il default. */
  tiles: Record<string, HexTile>
  /** posizione corrente dei giocatori (esagono), per la line-of-sight */
  playerPos?: { q: number; r: number }
  /** tempo di viaggio accumulato in giorni (frazionario); undefined = N/D */
  travelDays?: number
  /** distanza percorsa accumulata in km; undefined = N/D */
  travelDistanceKm?: number
  /** ore presenti in un giorno (per la stima del viaggio); default 24 */
  hoursPerDay?: number
  /** scala della mappa (miglia/km per esagono); default "regional" */
  scale?: MapScale
  /** mezzo di trasporto attivo per l'esplorazione; default "foot" */
  vehicle?: Vehicle
  /** stato meteo della campagna; default sunny/spring (vedi defaultWeatherState) */
  weather?: WeatherState
}

/** I terreni d'acqua (no overlay di terra, percorribili solo da mezzi d'acqua). */
export function isWaterTerrain(terrain: string): boolean {
  return terrain === 'water' || terrain === 'deepwater'
}

/** Altitudine di un terreno: Montagna/Vulcano +2, Collina/Mesa +1, altri 0. */
export function altitudeOf(terrain: string): number {
  if (terrain === 'mountain' || terrain === 'volcano') return 2
  if (terrain === 'hills' || terrain === 'mesa') return 1
  return 0
}

/** Documento leggero "solo esplorazione": stato di scoperta senza il mondo.
 * Oltre alla fog include la posizione dei giocatori e il tempo di viaggio. */
export interface ExplorationDocument {
  schemaVersion: number
  mapId: string
  fog: Record<string, FogState>
  playerPos?: { q: number; r: number }
  travelDays?: number
  travelDistanceKm?: number
  /** stato meteo (fa parte dello stato di esplorazione/campagna) */
  weather?: WeatherState
}

export const EMPTY_TERRAIN = ''

export const DEFAULT_TILE: Readonly<HexTile> = {
  terrain: EMPTY_TERRAIN,
  rotation: 0,
  fog: 'hidden',
}

/** Chiave canonica di un hex nello store dei tiles. */
export function keyOf(q: number, r: number): string {
  return `${q},${r}`
}

export function parseKey(key: string): { q: number; r: number } {
  const i = key.indexOf(',')
  return { q: Number(key.slice(0, i)), r: Number(key.slice(i + 1)) }
}

/** Tassello memorizzato oppure il default (immutabile). */
export function getTile(doc: MapDocument, key: string): HexTile {
  return doc.tiles[key] ?? (DEFAULT_TILE as HexTile)
}

export const ROTATIONS: readonly Rotation[] = [0, 60, 120, 180, 240, 300]

export function nextRotation(r: Rotation): Rotation {
  const i = ROTATIONS.indexOf(r)
  return ROTATIONS[(i + 1) % ROTATIONS.length]
}

// ---- Validatori difensivi (usati dal worker per i messaggi in ingresso) ----

const FOGS: ReadonlySet<string> = new Set<FogState>(['hidden', 'explored', 'visible'])
const ROTATION_SET: ReadonlySet<number> = new Set<number>(ROTATIONS)

export function isFogState(v: unknown): v is FogState {
  return typeof v === 'string' && FOGS.has(v)
}

/** Una tileKey valida ha forma "q,r" con q,r interi (anche negativi). */
export function isTileKey(v: unknown): v is string {
  return typeof v === 'string' && /^-?\d+,-?\d+$/.test(v)
}

function isPathArray(v: unknown): boolean {
  if (!Array.isArray(v)) return false
  return v.every((p) => {
    if (typeof p !== 'object' || p === null) return false
    const o = p as Record<string, unknown>
    return (
      typeof o.kind === 'string' &&
      Array.isArray(o.edges) &&
      o.edges.every((e) => Number.isInteger(e))
    )
  })
}

/** Validazione minima e difensiva di un HexTile in ingresso. */
export function isHexTile(v: unknown): v is HexTile {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  if (typeof t.terrain !== 'string') return false
  if (t.overlay !== undefined && typeof t.overlay !== 'string') return false
  if (typeof t.rotation !== 'number' || !ROTATION_SET.has(t.rotation)) return false
  if (!isFogState(t.fog)) return false
  if (t.paths !== undefined && !isPathArray(t.paths)) return false
  for (const flag of ['snow', 'volcanic', 'ice'] as const) {
    if (t[flag] !== undefined && typeof t[flag] !== 'boolean') return false
  }
  return true
}

// ---- Meteo: default, validatori e normalizzazione -------------------------

const SEASON_SET: ReadonlySet<string> = new Set<Season>(SEASONS)
const WEATHER_SET: ReadonlySet<string> = new Set<WeatherType>(WEATHER_TYPES)

export function isWeatherType(v: unknown): v is WeatherType {
  return typeof v === 'string' && WEATHER_SET.has(v)
}

export function isSeason(v: unknown): v is Season {
  return typeof v === 'string' && SEASON_SET.has(v)
}

export function isWeatherState(v: unknown): v is WeatherState {
  if (typeof v !== 'object' || v === null) return false
  const w = v as Record<string, unknown>
  return isWeatherType(w.current) && isSeason(w.season) && typeof w.consecutiveDays === 'number'
}

/** Stato meteo iniziale: ogni nuova mappa/sessione parte con sunny/spring. */
export function defaultWeatherState(): WeatherState {
  return { current: 'sunny', season: 'spring', consecutiveDays: 1, lastUpdatedTurn: 0 }
}

/** Ritorna sempre un WeatherState valido: normalizza input parziali e fornisce
 * il default per le mappe salvate prima del meteo (retro-compatibilità). */
export function ensureWeatherState(w: unknown): WeatherState {
  if (isWeatherState(w)) {
    const s = w as WeatherState
    return {
      current: s.current,
      season: s.season,
      consecutiveDays: Math.max(1, Math.floor(s.consecutiveDays) || 1),
      previous: isWeatherType(s.previous) ? s.previous : undefined,
      lastUpdatedTurn: typeof s.lastUpdatedTurn === 'number' ? s.lastUpdatedTurn : 0,
    }
  }
  return defaultWeatherState()
}

/** Validazione minima e difensiva di un MapDocument in ingresso. */
export function isMapDocument(v: unknown): v is MapDocument {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return (
    typeof m.schemaVersion === 'number' &&
    typeof m.id === 'string' &&
    typeof m.name === 'string' &&
    (m.orientation === 'pointy' || m.orientation === 'flat') &&
    typeof m.hexSize === 'number' &&
    typeof m.width === 'number' &&
    typeof m.height === 'number' &&
    typeof m.tiles === 'object' &&
    m.tiles !== null
  )
}
