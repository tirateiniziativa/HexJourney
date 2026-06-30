// Line-of-sight dei giocatori, in base al terreno dell'esagono dove si trovano
// e all'altitudine degli esagoni intermedi.
//
//  - Pianura / Acqua: esagono stesso + tutti gli adiacenti (distanza <= 1)
//  - Foresta / Deserto / Palude / Neve: solo l'esagono stesso
//  - Montagna: stesso + distanza 1; distanza 2 solo se tra i giocatori e
//    l'esagono c'è un intermedio con altitudine < 2
//  - Collina: stesso + distanza 1; distanza 2 solo se l'intermedio ha
//    altitudine < 1

import type { MapDocument } from '@/model/types'
import { altitudeOf, getTile, keyOf } from '@/model/types'
import { axialDistance, axialNeighbors, axialToCube, cubeRing, type Axial } from './coordinates'
import { mapCoords } from './layout'

type LosRule = { kind: 'self' } | { kind: 'adjacent' } | { kind: 'elevated'; threshold: number }

function losRule(terrain: string): LosRule {
  switch (terrain) {
    case 'forest':
    case 'desert':
    case 'swamp':
      return { kind: 'self' }
    case 'mountain':
    case 'volcano':
      return { kind: 'elevated', threshold: 2 }
    case 'hills':
    case 'mesa':
      return { kind: 'elevated', threshold: 1 }
    case 'plains':
    case 'water':
    case 'deepwater':
      return { kind: 'adjacent' }
    default:
      return { kind: 'adjacent' } // non dipinto / default
  }
}

/** Insieme delle chiavi "q,r" visibili dai giocatori in posizione `pos`.
 * `inMapSet` opzionale evita di ricalcolare le celle (utile lungo un percorso). */
export function lineOfSight(doc: MapDocument, pos: Axial, inMapSet?: Set<string>): Set<string> {
  const inMap = inMapSet ?? new Set(mapCoords(doc).map((c) => keyOf(c.q, c.r)))
  const result = new Set<string>()
  const posKey = keyOf(pos.q, pos.r)
  if (!inMap.has(posKey)) return result
  result.add(posKey)

  const rule = losRule(getTile(doc, posKey).terrain)
  if (rule.kind === 'self') return result

  const neighbors = axialNeighbors(pos)
  for (const n of neighbors) {
    const k = keyOf(n.q, n.r)
    if (inMap.has(k)) result.add(k)
  }
  if (rule.kind === 'adjacent') return result

  // elevated: distanza 2 visibile se un intermedio ha altitudine < soglia
  const threshold = rule.threshold
  for (const ct of cubeRing(axialToCube(pos), 2)) {
    const target: Axial = { q: ct.q, r: ct.r }
    const k = keyOf(target.q, target.r)
    if (!inMap.has(k)) continue
    const between = neighbors.filter(
      (b) => inMap.has(keyOf(b.q, b.r)) && axialDistance(b, target) === 1,
    )
    const open =
      between.length === 0 ||
      between.some((b) => altitudeOf(getTile(doc, keyOf(b.q, b.r)).terrain) < threshold)
    if (open) result.add(k)
  }
  return result
}

/** Esagono centrale della mappa (per la posizione iniziale dei giocatori). */
export function centerHex(doc: MapDocument): Axial | null {
  const coords = mapCoords(doc)
  if (coords.length === 0) return null
  let sq = 0
  let sr = 0
  for (const c of coords) {
    sq += c.q
    sr += c.r
  }
  const cq = sq / coords.length
  const cr = sr / coords.length
  let best = coords[0]
  let bestD = Infinity
  for (const c of coords) {
    const d = Math.abs(c.q - cq) + Math.abs(c.r - cr) + Math.abs(c.q + c.r - (cq + cr))
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}
