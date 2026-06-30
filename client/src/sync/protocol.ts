// Tipi del protocollo realtime: ora vivono in `@hexjourney/shared/protocol`
// (condivisi col Worker). Qui restano solo le parti specifiche del client
// (stato di connessione, alias storici e configurazione URL del Worker).

import type { PresencePlayer } from '@hexjourney/shared/protocol'

export type {
  Role,
  PresencePlayer,
  ClientToServerMessage,
  ServerToClientMessage,
} from '@hexjourney/shared/protocol'

/** Alias storico usato dallo store (= PresencePlayer del protocollo). */
export type PlayerInfo = PresencePlayer

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

// URL del Worker. In sviluppo punta a `wrangler dev` (porta 8787); in produzione
// si imposta `VITE_WORKER_WS_URL=wss://<worker-domain>` (Cloudflare Pages).
const WS_RAW = (import.meta.env.VITE_WORKER_WS_URL as string | undefined)?.replace(/\/+$/, '')

/** Base WebSocket, es. `ws://localhost:8787`. */
export const WORKER_WS_BASE = WS_RAW || 'ws://localhost:8787'

/** Base HTTP per `POST /session` e `/health`, derivata da quella WS se non data. */
export const WORKER_HTTP_BASE =
  (import.meta.env.VITE_WORKER_BASE_URL as string | undefined)?.replace(/\/+$/, '') ||
  WORKER_WS_BASE.replace(/^ws/, 'http')

/** URL WebSocket della sessione `sessionId`. */
export function sessionWsUrl(sessionId: string): string {
  return `${WORKER_WS_BASE}/session/${encodeURIComponent(sessionId)}/websocket`
}
