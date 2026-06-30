// Worker "router": non tiene stato della mappa, instrada soltanto verso il
// Durable Object corretto (uno per sessionId).
//   GET  /health                     -> { ok: true }
//   POST /session                    -> { sessionId } (codice casuale)
//   GET  /session/:id/websocket      -> upgrade WS verso il DO della sessione

import { HexSession } from './HexSession'
import type { Env } from './types'

// Il DO deve essere esportato dal modulo di ingresso (riferito in wrangler.jsonc).
export { HexSession }

// Alfabeto senza caratteri ambigui (niente 0/O/1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function genCode(len = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  let code = ''
  for (let i = 0; i < len; i++) code += ALPHABET[bytes[i] % ALPHABET.length]
  return code
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

const SESSION_WS = /^\/session\/([^/]+)\/websocket$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    if (path === '/health') {
      return json({ ok: true })
    }

    if (path === '/session' && request.method === 'POST') {
      return json({ sessionId: genCode() })
    }

    const match = SESSION_WS.exec(path)
    if (match) {
      const sessionId = decodeURIComponent(match[1])
      const id = env.HEX_SESSIONS.idFromName(sessionId)
      const stub = env.HEX_SESSIONS.get(id)
      return stub.fetch(request)
    }

    return new Response('Not found', { status: 404, headers: CORS })
  },
} satisfies ExportedHandler<Env>
