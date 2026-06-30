// Persistenza locale via Dexie (IndexedDB).
// Lo stato "vivo" sta in zustand; qui si salva/carica su disco locale.
// Salvando il MapDocument si salva SEMPRE anche lo stato di esplorazione
// (la fog vive dentro i tiles), così riaprendo l'app la fog è quella lasciata.

import Dexie, { type Table } from 'dexie'
import type { MapDocument } from '@/model/types'

export interface StoredMap {
  id: string
  name: string
  updatedAt: number
  schemaVersion: number
  doc: MapDocument
}

class HexplorerDB extends Dexie {
  maps!: Table<StoredMap, string>

  constructor() {
    super('hexplorer')
    this.version(1).stores({
      // chiave primaria id; indici per ordinare/cercare
      maps: 'id, name, updatedAt',
    })
  }
}

export const db = new HexplorerDB()

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** Salva (upsert) l'intera mappa, esplorazione inclusa. */
export async function saveMap(doc: MapDocument): Promise<void> {
  await db.maps.put({
    id: doc.id,
    name: doc.name,
    updatedAt: Date.now(),
    schemaVersion: doc.schemaVersion,
    doc: clone(doc),
  })
}

export async function loadMap(id: string): Promise<MapDocument | undefined> {
  const rec = await db.maps.get(id)
  return rec ? clone(rec.doc) : undefined
}

export async function listMaps(): Promise<StoredMap[]> {
  return db.maps.orderBy('updatedAt').reverse().toArray()
}

export async function deleteMap(id: string): Promise<void> {
  await db.maps.delete(id)
}

export async function duplicateMap(
  id: string,
  copySuffix = ' (copy)',
): Promise<MapDocument | undefined> {
  const rec = await db.maps.get(id)
  if (!rec) return undefined
  const copy = clone(rec.doc)
  copy.id = crypto.randomUUID()
  copy.name = `${rec.doc.name}${copySuffix}`
  await saveMap(copy)
  return copy
}

/**
 * Salvataggio rapido del solo stato di esplorazione: aggiorna fog, posizione
 * dei giocatori e tempo di viaggio del record salvato, senza toccare
 * terreni/overlay già su disco. Se la mappa non è ancora salvata, salva tutto.
 */
export async function quickSaveExploration(doc: MapDocument): Promise<void> {
  const rec = await db.maps.get(doc.id)
  if (!rec) {
    await saveMap(doc)
    return
  }
  const stored = clone(rec.doc)
  // applica la fog corrente sopra il mondo salvato
  for (const [key, tile] of Object.entries(doc.tiles)) {
    const existing = stored.tiles[key]
    if (existing) existing.fog = tile.fog
    else stored.tiles[key] = { terrain: '', rotation: 0, fog: tile.fog }
  }
  // azzera la fog degli hex non più presenti tra quelli correnti? no: l'autosave
  // completo gestisce la rimozione; qui aggiorniamo anche posizione e viaggio.
  stored.playerPos = doc.playerPos
  stored.travelDays = doc.travelDays
  await db.maps.put({
    id: stored.id,
    name: stored.name,
    updatedAt: Date.now(),
    schemaVersion: stored.schemaVersion,
    doc: stored,
  })
}
