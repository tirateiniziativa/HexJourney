// Catalogo tasselli data-driven. La palette UI legge da qui; "dipingere"
// scrive solo l'id nel tassello. I colori servono come fallback/placeholder
// (tile colorati generati a runtime) quando manca imageUrl.

import catalog from './tiles.json'

export type TileCategory = 'terrain' | 'overlay'

/** Tipo di overlay: lineare (strade/fiumi ad ancore), simbolo (POI) o effetto
 * a tutta casella (neve/terra vulcanica/ghiaccio). */
export type OverlayShape = 'line' | 'symbol' | 'effect'

/** Dove può essere applicato un overlay rispetto al terreno. */
export type OverlayTarget = 'land' | 'water' | 'both'

export interface TileDef {
  id: string
  name: string
  category: TileCategory
  color?: string
  imageUrl?: string
  shape?: OverlayShape
  /** per gli overlay: su quali terreni è applicabile */
  on?: OverlayTarget
  /** per i terreni: true se è acqua (percorribile solo da mezzi d'acqua) */
  water?: boolean
}

export const TERRAINS: TileDef[] = catalog.terrains as TileDef[]
export const OVERLAYS: TileDef[] = catalog.overlays as TileDef[]

const byId = new Map<string, TileDef>()
for (const def of [...TERRAINS, ...OVERLAYS]) byId.set(def.id, def)

export function getTileDef(id: string): TileDef | undefined {
  return byId.get(id)
}

/** L'overlay `id` è applicabile a un terreno d'acqua / di terra? */
export function overlayAllowedOn(id: string, water: boolean): boolean {
  const on = getTileDef(id)?.on ?? 'both'
  if (on === 'both') return true
  return on === (water ? 'water' : 'land')
}

/** Colore per gli hex non dipinti. */
export const EMPTY_COLOR = 0x2b2e3b
const FALLBACK_TERRAIN = 0x4a4f63
const FALLBACK_OVERLAY = 0xffffff

export function hexColorToNumber(s: string): number {
  return parseInt(s.replace('#', ''), 16)
}

export function terrainColor(id: string): number {
  if (!id) return EMPTY_COLOR
  const def = byId.get(id)
  return def?.color ? hexColorToNumber(def.color) : FALLBACK_TERRAIN
}

export function overlayColor(id: string): number {
  const def = byId.get(id)
  return def?.color ? hexColorToNumber(def.color) : FALLBACK_OVERLAY
}
