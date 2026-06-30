// Protocollo realtime condiviso (client + worker), discriminato per `type`.
// Unica fonte di verità: client e Durable Object importano da qui.

import type { FogState, HexTile, MapDocument } from '../model/map'

export type Role = 'gm' | 'player'

export interface PresencePlayer {
  id: string
  role: Role
  name?: string
}

// --- Client -> Server ---

/** Ingresso in sessione. Il GM può fornire `map` per creare/inizializzare lo
 * stato autoritativo; il player entra in sola lettura. */
export interface JoinMessage {
  type: 'join'
  sessionId: string
  role: Role
  name?: string
  map?: MapDocument
}

export interface PatchMessage {
  type: 'patch'
  tileKey: string
  tile: HexTile
}

export interface FogUpdateMessage {
  type: 'fogUpdate'
  tileKey: string
  fog: FogState
}

/** Stato pieno inviato dal GM per le operazioni bulk (revealAll, resize, move,
 * reset, rinomina, scala/mezzo, ±¼ giorno…). Mantiene la sincronizzazione che
 * il vecchio server otteneva via `fullState` client→server. */
export interface ClientFullStateMessage {
  type: 'fullState'
  map: MapDocument
}

export interface RequestFullStateMessage {
  type: 'requestFullState'
}

export type ClientToServerMessage =
  | JoinMessage
  | PatchMessage
  | FogUpdateMessage
  | ClientFullStateMessage
  | RequestFullStateMessage

// --- Server -> Client ---

export interface FullStateMessage {
  type: 'fullState'
  map: MapDocument
}

export interface PresenceMessage {
  type: 'presence'
  players: PresencePlayer[]
}

export interface ErrorMessage {
  type: 'error'
  message: string
}

export type ServerToClientMessage =
  | FullStateMessage
  | PatchMessage
  | FogUpdateMessage
  | PresenceMessage
  | ErrorMessage
