import type { HexSession } from './HexSession'

/** Binding del documento (vedi wrangler.jsonc). */
export interface Env {
  HEX_SESSIONS: DurableObjectNamespace<HexSession>
}
