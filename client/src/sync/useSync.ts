import { useEffect } from 'react'
import { SyncClient } from './SyncClient'
import { setSyncClient } from './bridge'
import type { ServerToClientMessage } from './protocol'
import { useMapStore } from '@/store/mapStore'

function handleServerMessage(msg: ServerToClientMessage): void {
  const s = useMapStore.getState()
  switch (msg.type) {
    case 'fullState':
      s.loadDoc(msg.map)
      break
    case 'patch':
      s.applyRemoteTile(msg.tileKey, msg.tile)
      break
    case 'fogUpdate':
      s.applyRemoteFog(msg.tileKey, msg.fog)
      break
    case 'presence':
      s.setSessionPlayers(msg.players)
      break
    case 'error':
      s.setSessionError(msg.message)
      break
  }
}

/** Crea il SyncClient una volta e lo collega allo store + al bridge. */
export function useSyncSetup(): void {
  useEffect(() => {
    const client = new SyncClient({
      onStatus: (status) => useMapStore.getState().setSessionStatus(status),
      onSession: ({ sessionId, role }) => {
        const s = useMapStore.getState()
        s.setSessionInfo(sessionId, role)
        // il ruolo determina la modalità: player -> sola lettura.
        s.setMode(role)
        s.setSessionError(null)
      },
      onMessage: handleServerMessage,
    })
    setSyncClient(client)
    return () => {
      client.disconnect()
      setSyncClient(null)
    }
  }, [])
}
