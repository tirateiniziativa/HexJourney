// Durable Object autoritativo per una singola sessione di gioco.
// - Tiene il MapDocument autoritativo (in memoria + persistito in storage SQLite).
// - Usa la WebSocket Hibernation API: il DO può ibernarsi tra un messaggio e
//   l'altro mantenendo le connessioni; i metadati per-socket (ruolo/nome/id)
//   sopravvivono via serializeAttachment.
// - Autorità: solo il GM applica patch/fogUpdate/fullState; i player sono
//   ignorati con un messaggio di errore.

import { DurableObject } from 'cloudflare:workers'
import {
  DEFAULT_TILE,
  type ClientToServerMessage,
  type MapDocument,
  type PresencePlayer,
  type Role,
  type ServerToClientMessage,
} from '@hexjourney/shared'
import type { Env } from './types'
import { parseClientMessage } from './validation'

/** Metadati allegati a ciascun WebSocket (sopravvivono all'ibernazione). */
interface Attachment {
  id: string
  role: Role
  name: string
}

export class HexSession extends DurableObject<Env> {
  /** Cache in memoria del documento; la fonte persistita è in `ctx.storage`.
   * Si ricarica pigramente dopo un'ibernazione (memoria azzerata). */
  private map: MapDocument | undefined
  private loaded = false

  /** Upgrade WebSocket: accetta il socket lato server in modalità hibernation. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Atteso un upgrade WebSocket.', { status: 426 })
    }
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  // ---- Hibernation handlers -------------------------------------------------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message)
    const msg = parseClientMessage(text)
    if (!msg) {
      this.send(ws, { type: 'error', message: 'Messaggio non valido.' })
      return
    }
    await this.handle(ws, msg)
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    try {
      ws.close(code, reason)
    } catch {
      /* già chiuso */
    }
    this.broadcastPresence()
  }

  // ---- logica di sessione ---------------------------------------------------

  private async handle(ws: WebSocket, msg: ClientToServerMessage): Promise<void> {
    switch (msg.type) {
      case 'join': {
        const prev = this.attachment(ws)
        // Il GM che fornisce una mappa crea/sostituisce lo stato autoritativo.
        if (msg.role === 'gm' && msg.map) {
          await this.setMap(msg.map)
        }
        const map = await this.getMap()
        const attachment: Attachment = {
          id: prev?.id ?? crypto.randomUUID(),
          role: msg.role,
          name: msg.name ?? (msg.role === 'gm' ? 'DM' : 'Player'),
        }
        ws.serializeAttachment(attachment)

        if (map) {
          this.send(ws, { type: 'fullState', map })
        } else if (msg.role === 'player') {
          // Player entrato prima che il GM abbia inizializzato la mappa.
          this.send(ws, { type: 'error', message: 'La sessione non ha ancora una mappa.' })
        }
        this.broadcastPresence()
        break
      }

      case 'patch': {
        if (!this.requireGm(ws)) return
        const map = await this.getMap()
        if (!map) return
        map.tiles[msg.tileKey] = msg.tile
        await this.setMap(map)
        this.broadcast({ type: 'patch', tileKey: msg.tileKey, tile: msg.tile }, ws)
        break
      }

      case 'fogUpdate': {
        if (!this.requireGm(ws)) return
        const map = await this.getMap()
        if (!map) return
        const prev = map.tiles[msg.tileKey] ?? { ...DEFAULT_TILE }
        map.tiles[msg.tileKey] = { ...prev, fog: msg.fog }
        await this.setMap(map)
        this.broadcast({ type: 'fogUpdate', tileKey: msg.tileKey, fog: msg.fog }, ws)
        break
      }

      case 'fullState': {
        if (!this.requireGm(ws)) return
        await this.setMap(msg.map)
        this.broadcast({ type: 'fullState', map: msg.map }, ws)
        break
      }

      case 'requestFullState': {
        const map = await this.getMap()
        if (map) this.send(ws, { type: 'fullState', map })
        break
      }
    }
  }

  /** True se il socket è il GM; altrimenti rifiuta con un errore. */
  private requireGm(ws: WebSocket): boolean {
    if (this.attachment(ws)?.role === 'gm') return true
    this.send(ws, { type: 'error', message: 'Solo il DM può modificare la mappa.' })
    return false
  }

  private attachment(ws: WebSocket): Attachment | null {
    return (ws.deserializeAttachment() as Attachment | null) ?? null
  }

  // ---- stato (memoria + storage) -------------------------------------------

  private async getMap(): Promise<MapDocument | undefined> {
    if (!this.loaded) {
      this.map = await this.ctx.storage.get<MapDocument>('map')
      this.loaded = true
    }
    return this.map
  }

  private async setMap(map: MapDocument): Promise<void> {
    this.map = map
    this.loaded = true
    // Storage SQLite: valore singolo fino a ~2 MiB (basta per mappe ~100×100;
    // per mappe molto grandi servirebbe lo split per-tile — TODO).
    await this.ctx.storage.put('map', map)
  }

  // ---- invio messaggi -------------------------------------------------------

  private send(ws: WebSocket, msg: ServerToClientMessage): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      /* socket chiuso */
    }
  }

  private broadcast(msg: ServerToClientMessage, except?: WebSocket): void {
    const data = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue
      try {
        ws.send(data)
      } catch {
        /* socket chiuso */
      }
    }
  }

  private broadcastPresence(): void {
    const players: PresencePlayer[] = []
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws)
      if (att) players.push({ id: att.id, role: att.role, name: att.name })
    }
    this.broadcast({ type: 'presence', players })
  }
}
