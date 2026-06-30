// Geometria degli esagoni basata su honeycomb-grid v4 (defineHex / Grid).
// honeycomb fornisce centro/angoli in pixel e la conversione punto->hex; questo
// modulo è l'UNICA fonte di verità per la geometria, così rendering e
// hit-testing restano sempre coerenti.
//
// Gli algoritmi di gioco (distanza, vicini, linee, raggi) vivono invece in
// coordinates.ts su coordinate cubiche. Qui si usa honeycomb solo per i pixel
// e per enumerare le celle che compongono la mappa.

import { defineHex, Grid, rectangle, Orientation as HcOrientation } from 'honeycomb-grid'
import type { MapDocument, Orientation } from '@/model/types'
import { cubeRange, type Axial } from './coordinates'

export interface Point {
  x: number
  y: number
}

type HexClass = ReturnType<typeof defineHex>
type HexInstance = InstanceType<HexClass>

interface LayoutEntry {
  Hex: HexClass
  /** griglia vuota usata solo per point->hex (allowOutside) */
  probe: Grid<HexInstance>
  hexWidth: number
  hexHeight: number
}

const cache = new Map<string, LayoutEntry>()

function getLayout(orientation: Orientation, size: number): LayoutEntry {
  const key = `${orientation}:${size}`
  let entry = cache.get(key)
  if (!entry) {
    const Hex = defineHex({
      dimensions: size,
      orientation: orientation === 'pointy' ? HcOrientation.POINTY : HcOrientation.FLAT,
      origin: 'topLeft',
    })
    const probe = new Grid(Hex)
    const sample = new Hex({ q: 0, r: 0 })
    entry = { Hex, probe, hexWidth: sample.width, hexHeight: sample.height }
    cache.set(key, entry)
  }
  return entry
}

/** Dimensioni del bounding box di un singolo hex per l'orientamento/size dati. */
export function hexExtent(doc: MapDocument): { width: number; height: number } {
  const l = getLayout(doc.orientation, doc.hexSize)
  return { width: l.hexWidth, height: l.hexHeight }
}

/** Centro in pixel dell'hex (q, r). */
export function hexCenter(doc: MapDocument, q: number, r: number): Point {
  const { Hex } = getLayout(doc.orientation, doc.hexSize)
  const h = new Hex({ q, r })
  return { x: h.x, y: h.y }
}

/** I 6 angoli in pixel dell'hex (q, r), in coordinate assolute. */
export function hexCorners(doc: MapDocument, q: number, r: number): Point[] {
  const { Hex } = getLayout(doc.orientation, doc.hexSize)
  const h = new Hex({ q, r })
  return h.corners.map((c) => ({ x: c.x, y: c.y }))
}

/** Angoli relativi al centro dell'hex (utili per generare una texture). */
export function hexCornersRelative(doc: MapDocument): Point[] {
  const center = hexCenter(doc, 0, 0)
  return hexCorners(doc, 0, 0).map((c) => ({ x: c.x - center.x, y: c.y - center.y }))
}

/**
 * Punti medi dei 6 lati, relativi al centro dell'hex.
 * Il lato i è tra l'angolo i e l'angolo (i+1)%6 (le "ancore" dei percorsi).
 */
export function hexEdgeMidsRelative(doc: MapDocument): Point[] {
  const corners = hexCornersRelative(doc)
  const mids: Point[] = []
  for (let i = 0; i < 6; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % 6]
    mids.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  }
  return mids
}

/** Converte un punto pixel (world) nell'hex assiale che lo contiene. */
export function pointToAxial(doc: MapDocument, x: number, y: number): Axial {
  const { probe } = getLayout(doc.orientation, doc.hexSize)
  const h = probe.pointToHex({ x, y }, { allowOutside: true })
  return { q: h.q, r: h.r }
}

/**
 * Enumera le celle che compongono la mappa.
 * - rectangular: via il traverser rectangle di honeycomb (offset->assiale
 *   coerente, forma un rettangolo visivo).
 * - hexagonal: disco esagonale via coordinate cubiche (cubeRange).
 */
export function mapCoords(doc: MapDocument): Axial[] {
  if (doc.shape === 'hexagonal') {
    const radius = Math.max(0, Math.floor((Math.min(doc.width, doc.height) - 1) / 2))
    return cubeRange({ q: 0, r: 0, s: 0 }, radius).map((c) => ({ q: c.q, r: c.r }))
  }
  const { Hex } = getLayout(doc.orientation, doc.hexSize)
  const grid = new Grid(Hex, rectangle({ width: doc.width, height: doc.height }))
  const coords: Axial[] = []
  grid.forEach((h) => coords.push({ q: h.q, r: h.r }))
  return coords
}

export interface Cell extends Point {
  q: number
  r: number
  key: string
}

/** Celle con chiave e centro pixel precalcolati (per rendering e culling). */
export function mapCells(doc: MapDocument): Cell[] {
  const { Hex } = getLayout(doc.orientation, doc.hexSize)
  return mapCoords(doc).map(({ q, r }) => {
    const h = new Hex({ q, r })
    return { q, r, key: `${q},${r}`, x: h.x, y: h.y }
  })
}

/** Bounding box in pixel dell'intera mappa (per centrare la vista). */
export function mapPixelBounds(doc: MapDocument): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const { width: hw, height: hh } = hexExtent(doc)
  const cells = mapCells(doc)
  if (cells.length === 0) {
    return { minX: 0, minY: 0, maxX: hw, maxY: hh }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of cells) {
    if (c.x - hw / 2 < minX) minX = c.x - hw / 2
    if (c.y - hh / 2 < minY) minY = c.y - hh / 2
    if (c.x + hw / 2 > maxX) maxX = c.x + hw / 2
    if (c.y + hh / 2 > maxY) maxY = c.y + hh / 2
  }
  return { minX, minY, maxX, maxY }
}
