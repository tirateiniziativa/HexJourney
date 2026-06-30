// Motore tempi/distanze di viaggio, derivato dal CSV "hexcrawl percorrenze".
//
// Tempo di attraversamento di un esagono (in giorni):
//   giorni = km_hex(scala) / km_giorno(mezzo, terreno) × moltiplicatore_terreno
//            × ∏ modificatori_overlay
// La percorribilità dipende da (mezzo, terreno) con eccezioni:
//   - carrozza/carovana in montagna (e carrozza in palude) solo con Strada;
//   - mezzi d'acqua solo su acqua, MA la Barca può risalire un Fiume su terra;
//     la Nave no.
// I valori (km/giorno, moltiplicatori, modificatori) sono costanti tra le scale:
// solo km_hex cambia. Lacune del CSV colmate qui (vedi NOTE).

import {
  getTile,
  isWaterTerrain,
  type HexTile,
  type MapDocument,
  type MapScale,
  type Vehicle,
} from '@/model/types'

export const DEFAULT_SCALE: MapScale = 'regional'
export const DEFAULT_VEHICLE: Vehicle = 'foot'

export interface ScaleDef {
  id: MapScale
  miles: number
  km: number
  /** chiave i18n della descrizione "cosa rappresenta" */
  noteKey: string
}

export const SCALES: ScaleDef[] = [
  { id: 'local', miles: 3, km: 4.8, noteKey: 'scale.local.note' },
  { id: 'regional', miles: 6, km: 9.7, noteKey: 'scale.regional.note' },
  { id: 'kingdoms', miles: 15, km: 24, noteKey: 'scale.kingdoms.note' },
  { id: 'continents', miles: 30, km: 48, noteKey: 'scale.continents.note' },
]

export const VEHICLES: Vehicle[] = ['foot', 'horse', 'carriage', 'caravan', 'boat', 'ship']

const scaleById = new Map(SCALES.map((s) => [s.id, s]))

export function scaleOf(doc: MapDocument): ScaleDef {
  return scaleById.get(doc.scale ?? DEFAULT_SCALE) ?? SCALES[1]
}

/** Km rappresentati da un singolo esagono alla scala del documento. */
export function kmPerHex(doc: MapDocument): number {
  return scaleOf(doc).km
}

/** Moltiplicatore di difficoltà del terreno (terra), costante tra i mezzi terrestri. */
const TERRAIN_MULT: Record<string, number> = {
  plains: 1.0,
  forest: 1.5,
  mountain: 2.5,
  desert: 1.5,
  swamp: 2.0,
  hills: 1.25,
  mesa: 1.75,
  volcano: 3.0,
}

/** Difficoltà di attraversamento del ghiaccio via terra: molto alta. */
const ICE_LAND_MULT = 3.0

/** Km/giorno dei mezzi terrestri (indipendenti dal terreno). */
const LAND_KM_DAY: Record<string, number> = { foot: 24, horse: 40, carriage: 32, caravan: 24 }

/** Km/giorno dei mezzi d'acqua, per tipo di acqua. */
const WATER_KM_DAY: Record<string, Record<string, number>> = {
  boat: { water: 32, deepwater: 24 },
  ship: { water: 48, deepwater: 80 },
}

function isLandVehicle(v: Vehicle): boolean {
  return v === 'foot' || v === 'horse' || v === 'carriage' || v === 'caravan'
}

/** L'hex ha un percorso del tipo dato (almeno un arco disegnato). */
export function hasPath(tile: HexTile, kind: string): boolean {
  return !!tile.paths?.some((p) => p.kind === kind && (p.edges?.length ?? 0) >= 2)
}

// ---- modificatori overlay (moltiplicativi) -------------------------------

function roadMod(v: Vehicle): number {
  switch (v) {
    case 'foot':
      return 0.85
    case 'horse':
      return 0.7
    case 'carriage':
      return 0.65
    case 'caravan':
      return 0.8
    default:
      return 1.0 // mezzi d'acqua
  }
}

function riverMod(v: Vehicle): number {
  if (v === 'boat') return 0.75 // risale/segue il fiume velocemente
  if (v === 'ship') return 0.9
  return 1.15 // mezzi terrestri: il guado rallenta
}

function snowMod(v: Vehicle): number {
  switch (v) {
    case 'foot':
      return 1.75
    case 'horse':
      return 2.0
    case 'carriage':
      return 3.0
    case 'caravan':
      return 2.5
    default:
      return 1.1 // mezzi d'acqua
  }
}

/** Terra vulcanica: rallenta come la neve (terreno scosceso, ceneri, calore). */
function volcanicMod(v: Vehicle): number {
  switch (v) {
    case 'foot':
      return 2.0
    case 'horse':
      return 2.25
    case 'carriage':
      return 3.0
    case 'caravan':
      return 2.75
    default:
      return 1.0 // overlay solo di terra
  }
}

/** Modificatore di un overlay-simbolo. POI senza effetto = 1.0.
 * NOTE (lacune CSV colmate): Barriera corallina e Secca rallentano i mezzi
 * d'acqua (1.2 e 1.15); l'Oasi velocizza solo il deserto (0.9). */
function symbolMod(v: Vehicle, terrain: string, overlay: string): number {
  switch (overlay) {
    case 'oasis':
      return terrain === 'desert' ? 0.9 : 1.0
    case 'reef':
      return isLandVehicle(v) ? 1.0 : 1.2
    case 'shoal':
      return isLandVehicle(v) ? 1.0 : 1.15
    default:
      return 1.0
  }
}

// ---- percorribilità -------------------------------------------------------

/** Percorribilità pura per (mezzo, terreno, tassello). */
function canEnterTile(v: Vehicle, terrain: string, tile: HexTile): boolean {
  const water = isWaterTerrain(terrain)
  // ghiaccio: l'acqua ghiacciata blocca i mezzi d'acqua ma è valicabile via terra
  if (water && tile.ice) return isLandVehicle(v)
  if (isLandVehicle(v)) {
    if (water) return false // niente ponti/guadi modellati
    if (v === 'carriage' && (terrain === 'mountain' || terrain === 'volcano' || terrain === 'swamp')) {
      return hasPath(tile, 'road')
    }
    if (v === 'caravan' && (terrain === 'mountain' || terrain === 'volcano')) {
      return hasPath(tile, 'road')
    }
    return true
  }
  // mezzi d'acqua
  if (water) return true
  if (v === 'boat') return hasPath(tile, 'river') // la barca risale i fiumi
  return false // la nave non va su terra/fiume
}

/** Il mezzo del documento può entrare nell'esagono `key`? */
export function canEnter(doc: MapDocument, key: string): boolean {
  const tile = getTile(doc, key)
  const terrain = tile.terrain || 'plains' // hex vuoto = terra (pianura)
  return canEnterTile(doc.vehicle ?? DEFAULT_VEHICLE, terrain, tile)
}

// ---- tempo di attraversamento --------------------------------------------

/** Giorni base (senza overlay) per il mezzo/scala correnti su un terreno. */
function baseDays(doc: MapDocument, terrain: string): number {
  const v = doc.vehicle ?? DEFAULT_VEHICLE
  const km = kmPerHex(doc)
  if (isLandVehicle(v)) return (km / LAND_KM_DAY[v]) * (TERRAIN_MULT[terrain] ?? 1.0)
  if (isWaterTerrain(terrain)) return (km / WATER_KM_DAY[v][terrain]) * 1.0
  // barca su fiume di terra: si usa la velocità della barca su acqua
  return (km / WATER_KM_DAY.boat.water) * 1.0
}

/** Giorni per attraversare l'hex `key` col mezzo/scala correnti, overlay inclusi.
 * Ritorna Infinity se l'esagono è impercorribile per il mezzo attivo. */
export function crossingDays(doc: MapDocument, key: string): number {
  if (!canEnter(doc, key)) return Infinity
  const tile = getTile(doc, key)
  const terrain = tile.terrain || 'plains'
  const v = doc.vehicle ?? DEFAULT_VEHICLE
  let days: number
  if (isWaterTerrain(terrain) && tile.ice && isLandVehicle(v)) {
    // attraversamento del ghiaccio via terra: a grande difficoltà
    days = (kmPerHex(doc) / LAND_KM_DAY[v]) * ICE_LAND_MULT
  } else {
    days = baseDays(doc, terrain)
  }
  if (tile.snow) days *= snowMod(v)
  if (tile.volcanic) days *= volcanicMod(v)
  if (hasPath(tile, 'river')) days *= riverMod(v)
  if (hasPath(tile, 'road')) days *= roadMod(v)
  if (tile.overlay) days *= symbolMod(v, terrain, tile.overlay)
  return days
}

/** Tempo base di un terreno "nudo" (per la leggenda): Infinity se impercorribile. */
export function terrainCrossingDays(doc: MapDocument, terrain: string): number {
  const v = doc.vehicle ?? DEFAULT_VEHICLE
  const probe: HexTile = { terrain, rotation: 0, fog: 'hidden' }
  if (!canEnterTile(v, terrain, probe)) return Infinity
  return baseDays(doc, terrain)
}

// ---- formattazione --------------------------------------------------------

/** Formatta un totale in giorni come "Ng Nh Nm" (giorni/ore/minuti) data la
 * durata del giorno. Le abbreviazioni sono tradotte e passate dal chiamante. */
export function formatTravel(
  days: number,
  hoursPerDay: number,
  dayAbbr = 'd',
  hourAbbr = 'h',
  minAbbr = 'm',
): string {
  const minutesPerDay = hoursPerDay * 60
  const totalMinutes = Math.round(days * minutesPerDay)
  const d = Math.floor(totalMinutes / minutesPerDay)
  const rem = totalMinutes - d * minutesPerDay
  const h = Math.floor(rem / 60)
  const m = rem - h * 60
  return `${d}${dayAbbr} ${h}${hourAbbr} ${m}${minAbbr}`
}

const KM_PER_MILE = 1.609344

/** Formatta una distanza (memorizzata in km) nell'unità scelta. */
export function formatDistance(km: number, unit: 'km' | 'mi'): string {
  const value = unit === 'mi' ? km / KM_PER_MILE : km
  const rounded = Math.round(value * 10) / 10
  return `${rounded} ${unit}`
}
