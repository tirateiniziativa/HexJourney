// Client WebSocket verso il Worker Cloudflare. Una connessione per sessione
// (`/session/:id/websocket`). Il GM crea la sessione via POST /session e si
// connette inviando `join` con la mappa; i player entrano col codice. Solo il GM
// emette modifiche. Auto-riconnessione: il `join` di rientro fa rinviare il
// `fullState` dal Durable Object (resync), senza re-inizializzare la mappa.

import {
  WORKER_HTTP_BASE,
  sessionWsUrl,
  type ClientToServerMessage,
  type ConnectionStatus,
  type Role,
  type ServerToClientMessage,
} from './protocol'
import type { FogState, HexTile, MapDocument } from '@/model/types'

export interface SyncHandlers {
  onStatus?: (status: ConnectionStatus) => void
  onMessage?: (msg: ServerToClientMessage) => void
  /** Chiamato a connessione avvenuta (sostituisce il vecchio `welcome`). */
  onSession?: (info: { sessionId: string; role: Role }) => void
}

export class SyncClient {
  private ws: WebSocket | null = null
  private handlers: SyncHandlers

  private sessionId: string | null = null
  private role: Role | null = null
  private name: string | undefined
  private initialMap: MapDocument | undefined
  private connected = false
  private firstConnect = true

  private shouldReconnect = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 800

  constructor(handlers: SyncHandlers) {
    this.handlers = handlers
  }

  /** GM: ottiene un codice dal Worker (POST /session) e si connette con la mappa. */
  async createSession(map: MapDocument): Promise<void> {
    try {
      const res = await fetch(`${WORKER_HTTP_BASE}/session`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { sessionId?: string }
      if (!data.sessionId) throw new Error('sessionId mancante')
      this.connectToSession({ sessionId: data.sessionId, role: 'gm', map })
    } catch {
      this.handlers.onStatus?.('error')
      this.handlers.onMessage?.({
        type: 'error',
        message: 'Impossibile creare la sessione (Worker non raggiungibile).',
      })
    }
  }

  joinSession(sessionId: string, role: Role, name?: string): void {
    this.connectToSession({ sessionId, role, name })
  }

  connectToSession(opts: {
    sessionId: string
    role: Role
    name?: string
    map?: MapDocument
  }): void {
    this.clearTimer()
    this.cleanupSocket()
    this.sessionId = opts.sessionId
    this.role = opts.role
    this.name = opts.name
    this.initialMap = opts.map
    this.firstConnect = true
    this.connected = false
    this.shouldReconnect = true
    this.open()
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.clearTimer()
    this.cleanupSocket()
    this.sessionId = null
    this.role = null
    this.connected = false
    this.handlers.onStatus?.('idle')
  }

  /** Solo il GM connesso può emettere modifiche. */
  canEmit(): boolean {
    return this.connected && this.role === 'gm'
  }

  emitPatch(tileKey: string, tile: HexTile): void {
    if (this.canEmit()) this.send({ type: 'patch', tileKey, tile })
  }
  emitFog(tileKey: string, fog: FogState): void {
    if (this.canEmit()) this.send({ type: 'fogUpdate', tileKey, fog })
  }
  emitFullState(map: MapDocument): void {
    if (this.canEmit()) this.send({ type: 'fullState', map })
  }

  // ---- interno ----

  private open(): void {
    if (!this.sessionId || !this.role) return
    this.cleanupSocket()
    this.handlers.onStatus?.(this.firstConnect ? 'connecting' : 'reconnecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(sessionWsUrl(this.sessionId))
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.reconnectDelay = 800
      this.connected = true
      // La mappa si invia SOLO al primo collegamento del GM: il DO conserva poi
      // lo stato, quindi alle riconnessioni si rientra senza `map` e il DO
      // rimanda il `fullState` corrente (resync).
      const join: ClientToServerMessage = {
        type: 'join',
        sessionId: this.sessionId!,
        role: this.role!,
        name: this.name,
        map: this.firstConnect ? this.initialMap : undefined,
      }
      this.send(join)
      this.firstConnect = false
      this.handlers.onSession?.({ sessionId: this.sessionId!, role: this.role! })
      this.handlers.onStatus?.('connected')
    }
    ws.onmessage = (ev) => {
      let msg: ServerToClientMessage
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
      } catch {
        return
      }
      this.handlers.onMessage?.(msg)
    }
    ws.onerror = () => {
      this.handlers.onStatus?.('error')
    }
    ws.onclose = () => {
      this.ws = null
      this.connected = false
      if (this.shouldReconnect) this.scheduleReconnect()
      else this.handlers.onStatus?.('idle')
    }
  }

  private send(msg: ClientToServerMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private scheduleReconnect(): void {
    this.clearTimer()
    this.handlers.onStatus?.('reconnecting')
    this.reconnectTimer = setTimeout(() => this.open(), this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 8000)
  }

  private clearTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private cleanupSocket(): void {
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onerror = null
      this.ws.onclose = null
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }
  }
}
