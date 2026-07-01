// Import/Export JSON. Tutti i formati sono JSON puro con schemaVersion
// esplicito; il formato su disco coincide con quello in memoria.
//
// Tre modalità di export:
//  1. Mappa completa: l'intero MapDocument (mondo + fog attuale).
//  2. Mappa pulita:   il MapDocument con la fog resettata a "hidden".
//  3. Solo esplorazione: { schemaVersion, mapId, fog: { "q,r": FogState } }.

import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_TILE,
  defaultRandomEventsState,
  defaultWeatherState,
  type ExplorationDocument,
  type FogState,
  type HexTile,
  type MapDocument,
} from '@/model/types'
import { lineOfSight } from '@/hex/los'

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'mappa'
  )
}

function isDefaultTile(t: HexTile): boolean {
  return (
    t.terrain === DEFAULT_TILE.terrain &&
    !t.overlay &&
    t.rotation === 0 &&
    t.fog === 'hidden' &&
    (!t.paths || t.paths.length === 0)
  )
}

// ---- Export ---------------------------------------------------------------

/** 1. Mappa completa: mondo + fog attuale. */
export function exportFullMap(doc: MapDocument): string {
  return JSON.stringify(doc, null, 2)
}

/** 2. Mappa pulita: mondo intatto, esplorazione azzerata (fog a "hidden",
 * viaggio a 0). La posizione iniziale dei giocatori è mantenuta e la sua
 * line-of-sight iniziale riapplicata, per ricominciare una campagna pronta a giocare. */
export function exportCleanMap(doc: MapDocument): string {
  const tiles: Record<string, HexTile> = {}
  for (const [key, tile] of Object.entries(doc.tiles)) {
    const reset: HexTile = { ...tile, fog: 'hidden' }
    if (!isDefaultTile(reset)) tiles[key] = reset // scarta i tasselli ridotti a default
  }
  let clean: MapDocument = {
    ...doc,
    tiles,
    travelDays: doc.playerPos ? 0 : undefined,
    travelDistanceKm: doc.playerPos ? 0 : undefined,
    // meteo ed eventi appartengono all'esplorazione: la mappa "pulita" riparte dai default
    weather: defaultWeatherState(),
    randomEvents: defaultRandomEventsState(),
  }
  if (clean.playerPos) {
    const los = lineOfSight(clean, clean.playerPos)
    const t2 = { ...clean.tiles }
    for (const k of los) t2[k] = { ...(t2[k] ?? DEFAULT_TILE), fog: 'visible' }
    clean = { ...clean, tiles: t2 }
  }
  return JSON.stringify(clean, null, 2)
}

/** 3. Solo esplorazione: stato di scoperta (fog non "hidden", posizione
 * giocatori e tempo di viaggio). */
export function buildExploration(doc: MapDocument): ExplorationDocument {
  const fog: Record<string, FogState> = {}
  for (const [key, tile] of Object.entries(doc.tiles)) {
    if (tile.fog !== 'hidden') fog[key] = tile.fog
  }
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    mapId: doc.id,
    fog,
    playerPos: doc.playerPos,
    travelDays: doc.travelDays,
    travelDistanceKm: doc.travelDistanceKm,
    weather: doc.weather,
    randomEvents: doc.randomEvents,
  }
}

export function exportExploration(doc: MapDocument): string {
  return JSON.stringify(buildExploration(doc), null, 2)
}

export function mapFileName(doc: MapDocument, suffix: string, ext = 'json'): string {
  return `${slugify(doc.name)}-${suffix}.${ext}`
}

// ---- Import ---------------------------------------------------------------

export type ImportResult =
  | { kind: 'map'; doc: MapDocument }
  | { kind: 'exploration'; exploration: ExplorationDocument }

/** Parsing + validazione minima della forma e dello schemaVersion. Gli errori
 * sono lanciati come CHIAVI i18n (es. 'io.errInvalidJson'): il chiamante le
 * traduce con t(). */
export function parseImport(text: string): ImportResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('io.errInvalidJson')
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error('io.errInvalidContent')
  }
  const obj = data as Record<string, unknown>

  if (typeof obj.schemaVersion !== 'number') {
    throw new Error('io.errNoSchema')
  }
  if (obj.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error('io.errSchemaTooNew')
  }

  // Solo esplorazione
  if ('fog' in obj && 'mapId' in obj) {
    if (typeof obj.mapId !== 'string' || typeof obj.fog !== 'object' || obj.fog === null) {
      throw new Error('io.errExplMalformed')
    }
    return { kind: 'exploration', exploration: obj as unknown as ExplorationDocument }
  }

  // Mappa completa
  if ('tiles' in obj && 'width' in obj && 'height' in obj) {
    if (
      typeof obj.id !== 'string' ||
      typeof obj.name !== 'string' ||
      typeof obj.width !== 'number' ||
      typeof obj.height !== 'number' ||
      typeof obj.hexSize !== 'number' ||
      typeof obj.tiles !== 'object' ||
      obj.tiles === null
    ) {
      throw new Error('io.errMapMalformed')
    }
    if (obj.orientation !== 'pointy' && obj.orientation !== 'flat') {
      throw new Error('io.errBadOrientation')
    }
    return { kind: 'map', doc: obj as unknown as MapDocument }
  }

  throw new Error('io.errUnknownFormat')
}

// ---- Download / upload ----------------------------------------------------

export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadDataUrl(filename: string, dataUrl: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Lettura file fallita.'))
    reader.readAsText(file)
  })
}
