// Percorso più breve tra due esagoni per la stima del tempo di viaggio.
// Costo di ingresso in un hex = giorni di attraversamento (crossingDays, che già
// include i modificatori di strada/fiume).
//
// Preferenza alle strade: se SIA partenza SIA destinazione sono su una strada o
// adiacenti a una strada, si minimizza prima il numero di hex fuori-strada
// (cioè si seguono le strade il più possibile), poi la durata. Altrimenti si usa
// la semplice durata minima.

import type { MapDocument } from '@/model/types'
import { keyOf, parseKey } from '@/model/types'
import { axialNeighbors, type Axial } from './coordinates'
import { mapCoords } from './layout'
import { crossingDays } from '@/data/travel'

export function isRoadHex(doc: MapDocument, key: string): boolean {
  return !!doc.tiles[key]?.paths?.some((p) => p.kind === 'road')
}

/** L'hex è su una strada o adiacente a una strada. */
export function connectsToRoad(doc: MapDocument, pos: Axial): boolean {
  if (isRoadHex(doc, keyOf(pos.q, pos.r))) return true
  return axialNeighbors(pos).some((n) => isRoadHex(doc, keyOf(n.q, n.r)))
}

class MinHeap {
  private a: { pri: number; key: string }[] = []
  get size() {
    return this.a.length
  }
  push(pri: number, key: string): void {
    const a = this.a
    a.push({ pri, key })
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].pri <= a[i].pri) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop(): { pri: number; key: string } | undefined {
    const a = this.a
    if (a.length === 0) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      const n = a.length
      for (;;) {
        const l = 2 * i + 1
        const r = 2 * i + 2
        let m = i
        if (l < n && a[l].pri < a[m].pri) m = l
        if (r < n && a[r].pri < a[m].pri) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

/** Percorso più breve da `from` a `to`: durata (giorni) e lista delle chiavi
 * attraversate (esclusa la partenza, inclusa la destinazione). null se irraggiungibile. */
export function shortestPath(
  doc: MapDocument,
  from: Axial,
  to: Axial,
): { days: number; path: string[] } | null {
  const inMap = new Set(mapCoords(doc).map((c) => keyOf(c.q, c.r)))
  const fromKey = keyOf(from.q, from.r)
  const toKey = keyOf(to.q, to.r)
  if (!inMap.has(fromKey) || !inMap.has(toKey) || fromKey === toKey) return null

  const prefer = connectsToRoad(doc, from) && connectsToRoad(doc, to)
  const BIG = 1e7 // domina la durata nella priorità lessicografica

  const bestPri = new Map<string, number>()
  const durAt = new Map<string, number>()
  const offAt = new Map<string, number>()
  const prev = new Map<string, string>()
  const heap = new MinHeap()
  bestPri.set(fromKey, 0)
  durAt.set(fromKey, 0)
  offAt.set(fromKey, 0)
  heap.push(0, fromKey)

  while (heap.size) {
    const { pri, key } = heap.pop()!
    if (pri > (bestPri.get(key) ?? Infinity)) continue
    if (key === toKey) break
    const { q, r } = parseKey(key)
    const curDur = durAt.get(key)!
    const curOff = offAt.get(key)!
    for (const n of axialNeighbors({ q, r })) {
      const nk = keyOf(n.q, n.r)
      if (!inMap.has(nk)) continue
      const stepDays = crossingDays(doc, nk)
      if (!isFinite(stepDays)) continue // impercorribile per il mezzo attivo
      const ndur = curDur + stepDays
      const noff = curOff + (isRoadHex(doc, nk) ? 0 : 1)
      const npri = prefer ? noff * BIG + ndur : ndur
      if (npri < (bestPri.get(nk) ?? Infinity)) {
        bestPri.set(nk, npri)
        durAt.set(nk, ndur)
        offAt.set(nk, noff)
        prev.set(nk, key)
        heap.push(npri, nk)
      }
    }
  }

  if (!durAt.has(toKey)) return null
  const path: string[] = []
  let cur: string | undefined = toKey
  while (cur && cur !== fromKey) {
    path.push(cur)
    cur = prev.get(cur)
  }
  path.reverse()
  return { days: durAt.get(toKey)!, path }
}
