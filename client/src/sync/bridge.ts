// Ponte tra lo store zustand e il SyncClient attivo. Lo store, quando un GM
// connesso modifica un hex, chiama questi helper per propagare al server.
// Se non c'è un client (o non è un GM connesso), sono no-op.

import type { FogState, HexTile, MapDocument } from '@/model/types'
import type { SyncClient } from './SyncClient'

let client: SyncClient | null = null

export function setSyncClient(c: SyncClient | null): void {
  client = c
}

export function getSyncClient(): SyncClient | null {
  return client
}

export function emitPatch(tileKey: string, tile: HexTile): void {
  client?.emitPatch(tileKey, tile)
}

export function emitFog(tileKey: string, fog: FogState): void {
  client?.emitFog(tileKey, fog)
}

export function emitFullState(map: MapDocument): void {
  client?.emitFullState(map)
}
