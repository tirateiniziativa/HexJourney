// Validazione difensiva dei messaggi client → server. Non ci si fida mai del
// client: ogni messaggio è verificato prima di essere applicato.

import {
  isFogState,
  isHexTile,
  isMapDocument,
  isTileKey,
  type ClientToServerMessage,
  type Role,
} from '@hexjourney/shared'

function isRole(v: unknown): v is Role {
  return v === 'gm' || v === 'player'
}

/** Parsa e valida un messaggio client. Ritorna il messaggio tipizzato o null. */
export function parseClientMessage(raw: string): ClientToServerMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const m = data as Record<string, unknown>

  switch (m.type) {
    case 'join': {
      if (!isRole(m.role) || typeof m.sessionId !== 'string') return null
      if (m.name !== undefined && typeof m.name !== 'string') return null
      const map = m.map === undefined ? undefined : isMapDocument(m.map) ? m.map : null
      if (map === null) return null
      return { type: 'join', sessionId: m.sessionId, role: m.role, name: m.name, map }
    }
    case 'patch':
      return isTileKey(m.tileKey) && isHexTile(m.tile)
        ? { type: 'patch', tileKey: m.tileKey, tile: m.tile }
        : null
    case 'fogUpdate':
      return isTileKey(m.tileKey) && isFogState(m.fog)
        ? { type: 'fogUpdate', tileKey: m.tileKey, fog: m.fog }
        : null
    case 'fullState':
      return isMapDocument(m.map) ? { type: 'fullState', map: m.map } : null
    case 'requestFullState':
      return { type: 'requestFullState' }
    default:
      return null
  }
}
