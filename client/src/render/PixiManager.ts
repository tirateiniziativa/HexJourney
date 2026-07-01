// Motore di rendering PixiJS v8.
// - init ASINCRONA (await app.init), come richiesto dalla v8.
// - world Container pannabile/zoomabile, layer separati.
// - culling della viewport: si creano/aggiornano sprite SOLO per gli hex
//   visibili; gli sprite escono in un pool e vengono riusati (niente
//   ricostruzione dell'intera griglia, niente redraw per-frame).

import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Edge, HexPath, MapDocument } from '@/model/types'
import { edgesAdjacent, keyOf, parseKey } from '@/model/types'
import { axialLine } from '@/hex/coordinates'
import {
  hexCornersRelative,
  hexEdgeMidsRelative,
  hexExtent,
  mapCells,
  mapPixelBounds,
  pointToAxial,
  type Cell,
  type Point,
} from '@/hex/layout'
import { EMPTY_COLOR, OVERLAYS, TERRAINS, getTileDef, overlayColor, terrainColor } from '@/data/catalog'
import { isBlocked } from '@/data/travel'

export type RenderMode = 'gm' | 'player'

export interface PixiCallbacks {
  onHover?: (axial: { q: number; r: number } | null) => void
  /** chiamata per dipingere/agire su un hex (gestita dal consumer in base a modalità/tool) */
  onPaint?: (q: number, r: number) => void
  /** true se il tasto sinistro deve dipingere invece di fare pan */
  isPaintActive?: () => boolean
  /** true se siamo in modalità "ancore" (disegno strade/fiumi) */
  isAnchorMode?: () => boolean
  /** id dell'overlay lineare attivo (river/road) */
  pathKind?: () => string
  /** imposta l'insieme dei lati-uscita di un tipo sull'hex indicato */
  onSetPath?: (hexKey: string, kind: string, edges: number[]) => void
  /** true se il click sposta i giocatori invece di dipingere/fare pan */
  isPlayerMode?: () => boolean
  /** sposta i giocatori sull'hex (q, r) */
  onMovePlayers?: (q: number, r: number) => void
  /** true in modalità esplorazione: disegna i bordi rossi sugli hex bloccati */
  isExplorationMode?: () => boolean
}

const ANCHOR_CAP = 700

function isLineOverlay(id: string | undefined): boolean {
  return !!id && getTileDef(id)?.shape === 'line'
}

interface AnchorEntry {
  x: number
  y: number
  members: { hexKey: string; edge: number }[]
}

const FOG_COLOR = 0x05060b

/** Opacità del velo di fog in funzione di modalità e stato.
 * GM: veli sottili (vede tutto ma capisce cosa è coperto).
 * Giocatore: hidden coperto, explored attenuato, visible pieno. */
function fogAlpha(mode: RenderMode, fog: 'hidden' | 'explored' | 'visible'): number {
  if (mode === 'gm') {
    return fog === 'hidden' ? 0.42 : fog === 'explored' ? 0.2 : 0
  }
  return fog === 'hidden' ? 1 : fog === 'explored' ? 0.6 : 0
}

const MIN_SCALE = 0.03
const MAX_SCALE = 6

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export class PixiManager {
  private app = new Application()
  private world = new Container()
  private terrainLayer = new Container()
  private snowGfx = new Graphics()
  private pathGfx = new Graphics()
  private overlayLayer = new Container()
  private fogLayer = new Container()
  private playerGfx = new Graphics()
  private blockedGfx = new Graphics()
  private anchorGfx = new Graphics()
  private hoverGfx = new Graphics()
  private renderMode: RenderMode = 'gm'

  private relEdgeMids: Point[] = []
  private relCorners: Point[] = []
  // indice delle ancore visibili (per hit-testing): pkey -> entry
  private anchorIndex = new Map<string, AnchorEntry>()
  // selezione in corso (costruzione di un percorso)
  private selPkeys = new Set<string>()
  // esagoni "posseduti" dalla selezione (scrivibili): freschi o presi in carico
  private ownedHexes = new Set<string>()
  private usablePkeys = new Set<string>()
  private lastKind: string | null = null

  private callbacks: PixiCallbacks = {}
  private resizeObserver: ResizeObserver | null = null

  private destroyed = false
  private inited = false

  private doc: MapDocument | null = null
  private cells: Cell[] = []
  private cellByKey = new Map<string, Cell>()
  private hexTexture: Texture | null = null
  /** Una texture per terreno (colore + motivo "cotti" dentro): niente tint. */
  private terrainTextures = new Map<string, Texture>()
  private overlayTextures = new Map<string, Texture>()
  private fogTexture: Texture | null = null

  private spritePool: Sprite[] = []
  private active = new Map<string, Sprite>()
  private overlayPool: Sprite[] = []
  private overlayActive = new Map<string, Sprite>()
  private fogPool: Sprite[] = []
  private fogActive = new Map<string, Sprite>()

  private dragging = false
  private painting = false
  private lastPaintKey: string | null = null
  private lastPointer = { x: 0, y: 0 }
  // puntatori attivi (per il multi-touch): pointerId -> posizione locale
  private activePointers = new Map<number, { x: number; y: number }>()
  // stato del gesto pinch (2 dita): distanza e punto medio precedenti
  private pinch: { dist: number; midX: number; midY: number } | null = null
  private cullScheduled = false

  /** Il canvas è un HTMLCanvasElement reale (renderer DOM/WebGL). */
  private get canvas(): HTMLCanvasElement {
    return this.app.canvas as unknown as HTMLCanvasElement
  }

  async init(container: HTMLElement, callbacks: PixiCallbacks = {}): Promise<void> {
    this.callbacks = callbacks

    await this.app.init({
      background: '#13131a',
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      resizeTo: container,
      preference: 'webgl',
    })

    // L'effetto React (StrictMode) può smontare prima che init finisca.
    if (this.destroyed) {
      this.app.destroy({ removeView: true }, { children: true })
      return
    }

    container.appendChild(this.canvas)
    this.canvas.style.touchAction = 'none'

    this.world.addChild(this.terrainLayer)
    this.world.addChild(this.snowGfx)
    this.world.addChild(this.pathGfx)
    this.world.addChild(this.overlayLayer)
    this.world.addChild(this.fogLayer)
    this.world.addChild(this.blockedGfx)
    this.world.addChild(this.playerGfx)
    this.world.addChild(this.anchorGfx)
    this.world.addChild(this.hoverGfx)
    this.app.stage.addChild(this.world)

    this.attachEvents()
    this.resizeObserver = new ResizeObserver(() => this.scheduleCull())
    this.resizeObserver.observe(container)

    this.inited = true
    if (import.meta.env.DEV) {
      ;(window as unknown as { __pixi?: PixiManager }).__pixi = this
    }
    if (this.doc) this.applyDoc(this.doc, true)
  }

  /**
   * Esporta l'INTERA mappa (non solo la viewport) come PNG dataURL.
   * Disegna tutte le celle in un container temporaneo e usa l'extract di Pixi.
   * La fog riflette la modalità di rendering corrente (GM/Giocatore).
   */
  exportPNG(scale = 2): string | null {
    if (!this.doc || !this.hexTexture) return null
    const bounds = mapPixelBounds(this.doc)
    const temp = new Container()

    const bg = new Graphics()
    bg.rect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
    bg.fill({ color: 0x13131a, alpha: 1 })
    temp.addChild(bg)

    // 1) terreno (texture col colore + motivo già cotti)
    for (const cell of this.cells) {
      const base = new Sprite(this.terrainTextureFor(cell.key))
      base.anchor.set(0.5)
      base.position.set(cell.x, cell.y)
      temp.addChild(base)
    }

    // 1b) veli "effetto" (neve/vulcanica/ghiaccio)
    if (this.relCorners.length === 6) {
      const sg = new Graphics()
      const veil = (cell: Cell, color: number, alpha: number) => {
        const pts = this.relCorners.flatMap((p) => [cell.x + p.x * 0.99, cell.y + p.y * 0.99])
        sg.poly(pts)
        sg.fill({ color, alpha })
      }
      for (const cell of this.cells) {
        const t = this.doc.tiles[cell.key]
        if (!t) continue
        if (t.snow) veil(cell, 0xeef3f8, 0.62)
        else if (t.volcanic) veil(cell, 0x7a2a1e, 0.5)
        else if (t.ice) veil(cell, 0xd3e9f4, 0.6)
      }
      temp.addChild(sg)
    }

    // 2) percorsi (strade/fiumi)
    if (this.relEdgeMids.length === 6) {
      const pg = new Graphics()
      for (const cell of this.cells) {
        const tile = this.doc.tiles[cell.key]
        if (!tile?.paths?.length) continue
        this.drawHexPaths(pg, cell.x, cell.y, tile.paths)
      }
      temp.addChild(pg)
    }

    // 3) overlay-simbolo (rovine/insediamento)
    for (const cell of this.cells) {
      const tile = this.doc.tiles[cell.key]
      if (!tile?.overlay || isLineOverlay(tile.overlay)) continue
      const tex = this.overlayTextures.get(tile.overlay)
      if (!tex) continue
      const ov = new Sprite(tex)
      ov.anchor.set(0.5)
      ov.position.set(cell.x, cell.y)
      ov.rotation = (tile.rotation * Math.PI) / 180
      temp.addChild(ov)
    }

    // 4) fog (sopra a tutto)
    for (const cell of this.cells) {
      const tile = this.doc.tiles[cell.key]
      const alpha = fogAlpha(this.renderMode, tile?.fog ?? 'hidden')
      if (alpha > 0 && this.fogTexture) {
        const fg = new Sprite(this.fogTexture)
        fg.anchor.set(0.5)
        fg.position.set(cell.x, cell.y)
        fg.tint = FOG_COLOR
        fg.alpha = alpha
        temp.addChild(fg)
      }
    }

    const canvas = this.app.renderer.extract.canvas({
      target: temp,
      resolution: scale,
    }) as unknown as HTMLCanvasElement
    const url = canvas.toDataURL('image/png')
    temp.destroy({ children: true }) // non distrugge le texture condivise
    return url
  }

  /** Solo per debug/verifica: quanti sprite sono attualmente attivi (culling). */
  get activeCount(): number {
    return this.active.size
  }
  get poolCount(): number {
    return this.spritePool.length
  }
  get cellCount(): number {
    return this.cells.length
  }

  /** Imposta/aggiorna il documento mappa. Distingue cambi strutturali (ricostruisce)
   * dai soli cambi di contenuto (ri-colora gli sprite attivi). */
  setDoc(doc: MapDocument): void {
    const structural =
      !this.doc ||
      this.doc.id !== doc.id ||
      this.doc.width !== doc.width ||
      this.doc.height !== doc.height ||
      this.doc.orientation !== doc.orientation ||
      this.doc.shape !== doc.shape ||
      this.doc.hexSize !== doc.hexSize
    this.doc = doc
    if (!this.inited) return
    this.applyDoc(doc, structural)
  }

  /** Cambia la modalità di rendering (GM/Giocatore): aggiorna i veli di fog. */
  setRenderMode(mode: RenderMode): void {
    if (this.renderMode === mode) return
    this.renderMode = mode
    this.scheduleCull()
  }

  /** Forza un nuovo ciclo di culling/redraw (es. al cambio di strumento). */
  requestRedraw(): void {
    this.scheduleCull()
  }

  private applyDoc(doc: MapDocument, structural: boolean): void {
    if (structural) {
      this.cells = mapCells(doc)
      this.cellByKey = new Map(this.cells.map((c) => [c.key, c]))
      this.relEdgeMids = hexEdgeMidsRelative(doc)
      this.relCorners = hexCornersRelative(doc)
      this.clearSelection()
      this.rebuildHexTexture(doc)
      this.rebuildTerrainTextures(doc)
      this.rebuildOverlayTextures(doc)
      this.rebuildFogTexture(doc)
      this.clearSprites()
      this.drawHoverShape(doc)
      this.fitToView(doc)
    }
    this.scheduleCull()
  }

  private rebuildHexTexture(doc: MapDocument): void {
    this.hexTexture?.destroy(true)
    const corners = hexCornersRelative(doc)
    const pts = corners.flatMap((p) => [p.x, p.y])
    const g = new Graphics()
    g.poly(pts)
    g.fill({ color: 0xffffff, alpha: 1 })
    g.stroke({ width: 2, color: 0x0d0f16, alpha: 0.45, alignment: 0.5 })
    this.hexTexture = this.app.renderer.generateTexture({
      target: g,
      resolution: 3,
      antialias: true,
    })
    g.destroy()
  }

  /** Una texture per terreno: esagono col colore base + un piccolo motivo
   * vettoriale (erba, alberi, picchi, onde, dune, canne, colline) "cotto" dentro.
   * Niente tint a runtime: lo sprite usa direttamente la texture giusta. */
  private rebuildTerrainTextures(doc: MapDocument): void {
    for (const tex of this.terrainTextures.values()) tex.destroy(true)
    this.terrainTextures.clear()
    const corners = hexCornersRelative(doc)
    const pts = corners.flatMap((p) => [p.x, p.y])
    const s = doc.hexSize
    const make = (fill: number, id?: string): Texture => {
      const g = new Graphics()
      g.poly(pts)
      g.fill({ color: fill, alpha: 1 })
      g.stroke({ width: 2, color: 0x0d0f16, alpha: 0.45, alignment: 0.5 })
      if (id) this.drawTerrainMotif(g, id, s)
      const tex = this.app.renderer.generateTexture({ target: g, resolution: 3, antialias: true })
      g.destroy()
      return tex
    }
    this.terrainTextures.set('', make(EMPTY_COLOR)) // hex vuoto
    for (const def of TERRAINS) this.terrainTextures.set(def.id, make(terrainColor(def.id), def.id))
  }

  /** Disegna il motivo procedurale di un terreno, centrato su (0,0) e contenuto
   * entro ~0.6·s così resta dentro l'esagono sia pointy sia flat. */
  private drawTerrainMotif(g: Graphics, id: string, s: number): void {
    switch (id) {
      case 'plains': {
        const tufts: Array<[number, number]> = [
          [-0.30, 0.40], [0.0, 0.5], [0.30, 0.38], [-0.13, 0.18], [0.16, 0.24],
        ]
        for (const [fx, fy] of tufts) {
          const x = fx * s
          const y = fy * s
          const h = 0.22 * s
          g.moveTo(x, y)
          g.lineTo(x - h * 0.35, y - h)
          g.moveTo(x, y)
          g.lineTo(x, y - h * 1.15)
          g.moveTo(x, y)
          g.lineTo(x + h * 0.35, y - h)
        }
        g.stroke({ width: Math.max(1, s * 0.05), color: 0x55652f, alpha: 0.95, cap: 'round' })
        break
      }
      case 'forest': {
        const trees: Array<[number, number, number]> = [
          [-0.30, -0.05, 1], [0.04, 0.02, 1.05], [0.34, -0.12, 0.88],
        ]
        for (const [fx, apex, sc] of trees) {
          const x = fx * s
          const baseY = apex * s + 0.45 * s * sc
          const tw = 0.07 * s * sc
          g.rect(x - tw / 2, baseY - 0.04 * s, tw, 0.22 * s * sc)
        }
        g.fill({ color: 0x4a3524 })
        for (const [fx, apex, sc] of trees) {
          const x = fx * s
          const ay = apex * s
          const cw = 0.24 * s * sc
          const baseY = ay + 0.46 * s * sc
          g.poly([x, ay, x - cw, baseY, x + cw, baseY])
        }
        g.fill({ color: 0x2f5630 })
        break
      }
      case 'mountain': {
        g.poly([-0.05 * s, -0.6 * s, -0.48 * s, 0.42 * s, 0.3 * s, 0.42 * s])
        g.poly([0.34 * s, -0.3 * s, 0.06 * s, 0.42 * s, 0.55 * s, 0.42 * s])
        g.fill({ color: 0x6f6253 })
        g.poly([-0.05 * s, -0.6 * s, -0.16 * s, -0.34 * s, 0.06 * s, -0.34 * s])
        g.poly([0.34 * s, -0.3 * s, 0.25 * s, -0.1 * s, 0.43 * s, -0.1 * s])
        g.fill({ color: 0xeef1f4 })
        break
      }
      case 'water': {
        for (const wy of [-0.22, 0.0, 0.22]) {
          const y = wy * s
          const x0 = -0.48 * s
          const seg = 0.24 * s
          g.moveTo(x0, y)
          g.quadraticCurveTo(x0 + seg * 0.5, y - 0.1 * s, x0 + seg, y)
          g.quadraticCurveTo(x0 + seg * 1.5, y + 0.1 * s, x0 + seg * 2, y)
          g.quadraticCurveTo(x0 + seg * 2.5, y - 0.1 * s, x0 + seg * 3, y)
          g.quadraticCurveTo(x0 + seg * 3.5, y + 0.1 * s, x0 + seg * 4, y)
        }
        g.stroke({ width: Math.max(1, s * 0.06), color: 0x9cc4e8, alpha: 0.9, cap: 'round' })
        break
      }
      case 'deepwater': {
        // acqua profonda: poche onde rade e più chiare sul fondo scuro
        for (const wy of [-0.16, 0.16]) {
          const y = wy * s
          const x0 = -0.42 * s
          const seg = 0.28 * s
          g.moveTo(x0, y)
          g.quadraticCurveTo(x0 + seg * 0.5, y - 0.09 * s, x0 + seg, y)
          g.quadraticCurveTo(x0 + seg * 1.5, y + 0.09 * s, x0 + seg * 3, y)
        }
        g.stroke({ width: Math.max(1, s * 0.06), color: 0x6f9ac8, alpha: 0.85, cap: 'round' })
        break
      }
      case 'desert': {
        const dune = (y: number, col: number) => {
          const x0 = -0.42 * s
          const seg = 0.28 * s
          g.moveTo(x0, y)
          g.quadraticCurveTo(x0 + seg * 0.5, y - 0.12 * s, x0 + seg, y)
          g.quadraticCurveTo(x0 + seg * 1.5, y + 0.12 * s, x0 + seg * 3, y)
          g.stroke({ width: Math.max(1, s * 0.06), color: col, alpha: 0.95, cap: 'round' })
        }
        dune(0.06 * s, 0xbf9f5f)
        dune(0.26 * s, 0xcbb074)
        g.circle(-0.18 * s, -0.22 * s, Math.max(1, s * 0.05))
        g.circle(0.14 * s, -0.14 * s, Math.max(1, s * 0.05))
        g.fill({ color: 0xb89a5e })
        break
      }
      case 'swamp': {
        g.ellipse(0, 0.3 * s, 0.4 * s, 0.13 * s)
        g.fill({ color: 0x45583c })
        const reeds: Array<[number, number]> = [
          [-0.22, 0.3], [-0.07, 0.32], [0.08, 0.3], [0.22, 0.31],
        ]
        for (const [fx, fy] of reeds) {
          const x = fx * s
          const y = fy * s
          g.moveTo(x, y)
          g.quadraticCurveTo(x + 0.04 * s, y - 0.3 * s, x - 0.02 * s, y - 0.55 * s)
        }
        g.stroke({ width: Math.max(1, s * 0.045), color: 0x33422a, alpha: 0.95, cap: 'round' })
        g.circle(-0.14 * s, 0.16 * s, Math.max(1, s * 0.04))
        g.circle(0.12 * s, 0.12 * s, Math.max(1, s * 0.04))
        g.fill({ color: 0x7c8c64 })
        break
      }
      case 'volcano': {
        // cono scuro con cratere rosso e colate di lava
        g.poly([-0.05 * s, -0.58 * s, -0.46 * s, 0.42 * s, 0.36 * s, 0.42 * s])
        g.fill({ color: 0x4a2b26 })
        g.poly([-0.05 * s, -0.58 * s, -0.46 * s, 0.42 * s, 0.36 * s, 0.42 * s])
        g.stroke({ width: Math.max(1, s * 0.04), color: 0x2a1714, alpha: 0.9 })
        // cratere incandescente
        g.poly([-0.05 * s, -0.58 * s, -0.17 * s, -0.4 * s, 0.07 * s, -0.4 * s])
        g.fill({ color: 0xff7a2a })
        // colate di lava
        g.moveTo(-0.05 * s, -0.5 * s)
        g.quadraticCurveTo(-0.16 * s, -0.1 * s, -0.1 * s, 0.34 * s)
        g.moveTo(0.0 * s, -0.48 * s)
        g.quadraticCurveTo(0.12 * s, 0.0 * s, 0.06 * s, 0.36 * s)
        g.stroke({ width: Math.max(1, s * 0.05), color: 0xe24a1f, alpha: 0.95, cap: 'round' })
        break
      }
      case 'hills': {
        g.moveTo(-0.42 * s, 0.4 * s)
        g.quadraticCurveTo(0, -0.2 * s, 0.42 * s, 0.4 * s)
        g.lineTo(-0.42 * s, 0.4 * s)
        g.fill({ color: 0x8c8449 })
        g.moveTo(-0.3 * s, 0.4 * s)
        g.quadraticCurveTo(0, -0.02 * s, 0.3 * s, 0.4 * s)
        g.lineTo(-0.3 * s, 0.4 * s)
        g.fill({ color: 0x9a9252 })
        g.moveTo(-0.2 * s, 0.26 * s)
        g.quadraticCurveTo(0, 0.04 * s, 0.2 * s, 0.26 * s)
        g.stroke({ width: Math.max(1, s * 0.045), color: 0xbcb56e, alpha: 0.9, cap: 'round' })
        break
      }
      case 'mesa': {
        // altopiano a cima piatta con pareti scoscese e strati rocciosi
        g.poly([-0.2 * s, -0.3 * s, 0.2 * s, -0.3 * s, 0.32 * s, 0.4 * s, -0.32 * s, 0.4 * s])
        g.fill({ color: 0x8a5230 })
        g.poly([-0.2 * s, -0.3 * s, 0.2 * s, -0.3 * s, 0.32 * s, 0.4 * s, -0.32 * s, 0.4 * s])
        g.stroke({ width: Math.max(1, s * 0.04), color: 0x5e3620, alpha: 0.9 })
        // piccolo butte affiancato
        g.poly([0.22 * s, 0.02 * s, 0.4 * s, 0.02 * s, 0.46 * s, 0.4 * s, 0.16 * s, 0.4 * s])
        g.fill({ color: 0x9a5e38 })
        g.poly([0.22 * s, 0.02 * s, 0.4 * s, 0.02 * s, 0.46 * s, 0.4 * s, 0.16 * s, 0.4 * s])
        g.stroke({ width: Math.max(1, s * 0.03), color: 0x5e3620, alpha: 0.85 })
        // strati orizzontali sulla parete principale
        for (const sy of [-0.08, 0.14]) {
          g.moveTo(-0.26 * s, sy * s)
          g.lineTo(0.24 * s, sy * s)
        }
        g.stroke({ width: Math.max(1, s * 0.03), color: 0x5e3620, alpha: 0.7, cap: 'round' })
        // bordo superiore chiaro
        g.moveTo(-0.2 * s, -0.3 * s)
        g.lineTo(0.2 * s, -0.3 * s)
        g.stroke({ width: Math.max(1, s * 0.04), color: 0xcf9a66, alpha: 0.9, cap: 'round' })
        break
      }
    }
  }

  /** Genera una texture (colore cotto dentro) per ogni overlay-simbolo. */
  private rebuildOverlayTextures(doc: MapDocument): void {
    for (const tex of this.overlayTextures.values()) tex.destroy(true)
    this.overlayTextures.clear()
    const s = doc.hexSize
    for (const def of OVERLAYS) {
      const shape = def.shape ?? 'symbol'
      if (shape === 'line' || shape === 'effect') continue // lineari=percorsi; effetti=vela
      const g = new Graphics()
      this.drawOverlayMotif(g, def.id, s)
      const tex = this.app.renderer.generateTexture({ target: g, resolution: 3, antialias: true })
      this.overlayTextures.set(def.id, tex)
      g.destroy()
    }
  }

  /** Motivo procedurale di un overlay-simbolo. Emblema compatto e contornato:
   * non riempie l'hex, così il terreno sottostante resta leggibile. */
  private drawOverlayMotif(g: Graphics, id: string, s: number): void {
    switch (id) {
      case 'ruins': {
        const stone = 0xd2ccbb
        const edge = 0x5f5a4c
        const cols: Array<[number, number]> = [
          [-0.28, 0.52], [-0.02, 0.66], [0.26, 0.44],
        ]
        const baseY = 0.34 * s
        const cw = 0.13 * s
        for (const [fx, h] of cols) g.rect(fx * s - cw / 2, baseY - h * s, cw, h * s)
        g.rect(-0.34 * s, baseY, 0.5 * s, 0.1 * s) // architrave caduto
        g.fill({ color: stone })
        for (const [fx, h] of cols) g.rect(fx * s - cw / 2, baseY - h * s, cw, h * s)
        g.rect(-0.34 * s, baseY, 0.5 * s, 0.1 * s)
        g.stroke({ width: Math.max(1, s * 0.05), color: edge, alpha: 0.9 })
        break
      }
      case 'village':
      case 'city': {
        const W = Math.max(1, s * 0.045)
        const roof = id === 'city' ? 0xd98c3a : 0xe6b422
        const roofEdge = id === 'city' ? 0x7a4a18 : 0x8a6a14
        const house = (ox: number, sc: number) => {
          const x = ox * s
          const wW = 0.28 * s * sc
          const wH = 0.28 * s * sc
          const top = 0.04 * s
          g.rect(x - wW / 2, top, wW, wH)
          g.fill({ color: 0xae7a44 })
          g.rect(x - wW / 2, top, wW, wH)
          g.stroke({ width: W, color: 0x4a3424, alpha: 0.9 })
          const rW = 0.38 * s * sc
          g.poly([x, top - 0.24 * s * sc, x - rW / 2, top, x + rW / 2, top])
          g.fill({ color: roof })
          g.poly([x, top - 0.24 * s * sc, x - rW / 2, top, x + rW / 2, top])
          g.stroke({ width: W, color: roofEdge, alpha: 0.9 })
        }
        if (id === 'village') {
          house(-0.18, 1)
          house(0.2, 0.8)
        } else {
          // città: una torre più alta + due case
          const tx = -0.28 * s
          const tw = 0.2 * s
          const ty = 0.42 * s
          const th = 0.56 * s
          g.rect(tx - tw / 2, ty - th, tw, th)
          g.fill({ color: 0x9c6b3b })
          g.rect(tx - tw / 2, ty - th, tw, th)
          g.stroke({ width: W, color: 0x3a2a1a, alpha: 0.9 })
          for (const i of [-1, 0, 1]) g.rect(tx + i * tw * 0.34 - tw * 0.12, ty - th - 0.06 * s, tw * 0.24, 0.07 * s)
          g.fill({ color: roof })
          house(0.16, 0.78)
          house(0.36, 0.6)
        }
        break
      }
      case 'fortress': {
        const W = Math.max(1, s * 0.05)
        const wall = 0x9aa0aa
        const edge = 0x4c5158
        const by = 0.4 * s
        const wW = 0.6 * s
        const wH = 0.34 * s
        g.rect(-wW / 2, by - wH, wW, wH)
        g.fill({ color: wall })
        // merli
        for (const i of [-2, -1, 0, 1, 2]) g.rect(i * 0.12 * s - 0.05 * s, by - wH - 0.08 * s, 0.1 * s, 0.09 * s)
        g.fill({ color: wall })
        g.rect(-wW / 2, by - wH, wW, wH)
        g.stroke({ width: W, color: edge, alpha: 0.9 })
        // portone
        g.rect(-0.07 * s, by - 0.16 * s, 0.14 * s, 0.16 * s)
        g.fill({ color: 0x33363b })
        break
      }
      case 'cave': {
        const W = Math.max(1, s * 0.05)
        // collinetta scura con bocca nera
        g.moveTo(-0.42 * s, 0.4 * s)
        g.quadraticCurveTo(0, -0.4 * s, 0.42 * s, 0.4 * s)
        g.lineTo(-0.42 * s, 0.4 * s)
        g.fill({ color: 0x6b5b4a })
        g.moveTo(-0.42 * s, 0.4 * s)
        g.quadraticCurveTo(0, -0.4 * s, 0.42 * s, 0.4 * s)
        g.stroke({ width: W, color: 0x3a312a, alpha: 0.9 })
        g.ellipse(0, 0.3 * s, 0.16 * s, 0.2 * s)
        g.fill({ color: 0x16120e })
        break
      }
      case 'sanctuary': {
        const W = Math.max(1, s * 0.045)
        const col = 0xe7dcf2
        const edge = 0x6e4f8a
        const top = -0.02 * s
        const baseY = 0.38 * s
        // due colonne
        for (const cx of [-0.18 * s, 0.18 * s]) g.rect(cx - 0.05 * s, top, 0.1 * s, baseY - top)
        g.fill({ color: col })
        // frontone
        g.poly([0, -0.42 * s, -0.34 * s, top, 0.34 * s, top])
        g.fill({ color: 0xc9a3e0 })
        g.poly([0, -0.42 * s, -0.34 * s, top, 0.34 * s, top])
        g.stroke({ width: W, color: edge, alpha: 0.9 })
        for (const cx of [-0.18 * s, 0.18 * s]) g.rect(cx - 0.05 * s, top, 0.1 * s, baseY - top)
        g.stroke({ width: W, color: edge, alpha: 0.9 })
        break
      }
      case 'dungeon': {
        const W = Math.max(1, s * 0.05)
        const by = 0.4 * s
        const w = 0.4 * s
        const h = 0.5 * s
        // arco scuro (portale)
        g.moveTo(-w / 2, by)
        g.lineTo(-w / 2, by - h * 0.55)
        g.quadraticCurveTo(0, by - h, w / 2, by - h * 0.55)
        g.lineTo(w / 2, by)
        g.lineTo(-w / 2, by)
        g.fill({ color: 0x2a1414 })
        g.moveTo(-w / 2, by)
        g.lineTo(-w / 2, by - h * 0.55)
        g.quadraticCurveTo(0, by - h, w / 2, by - h * 0.55)
        g.lineTo(w / 2, by)
        g.stroke({ width: W, color: 0xb0504b, alpha: 0.95 })
        // sbarre
        for (const bx of [-0.1 * s, 0.1 * s]) {
          g.moveTo(bx, by)
          g.lineTo(bx, by - h * 0.62)
        }
        g.stroke({ width: Math.max(1, s * 0.03), color: 0xb0504b, alpha: 0.8 })
        break
      }
      case 'oasis': {
        const W = Math.max(1, s * 0.04)
        // specchio d'acqua
        g.ellipse(0.04 * s, 0.32 * s, 0.34 * s, 0.12 * s)
        g.fill({ color: 0x3a8fd0 })
        // palma: tronco + fronde
        g.moveTo(-0.16 * s, 0.3 * s)
        g.quadraticCurveTo(-0.2 * s, 0, -0.12 * s, -0.34 * s)
        g.stroke({ width: Math.max(1, s * 0.05), color: 0x7a5128, alpha: 1 })
        const top = { x: -0.12 * s, y: -0.34 * s }
        for (const [dx, dy] of [[-0.26, -0.06], [-0.16, -0.22], [0.06, -0.24], [0.22, -0.08]]) {
          g.moveTo(top.x, top.y)
          g.quadraticCurveTo(top.x + dx * s * 0.6, top.y + dy * s * 0.4, top.x + dx * s, top.y + dy * s + 0.06 * s)
        }
        g.stroke({ width: W, color: 0x2f8f5a, alpha: 0.95 })
        break
      }
      case 'reef': {
        const W = Math.max(1, s * 0.06)
        // rami di corallo dal fondo
        for (const ox of [-0.24, 0.0, 0.22]) {
          const x = ox * s
          g.moveTo(x, 0.4 * s)
          g.quadraticCurveTo(x - 0.06 * s, 0.05 * s, x + 0.02 * s, -0.18 * s)
          g.moveTo(x, 0.2 * s)
          g.lineTo(x + 0.1 * s, 0.02 * s)
        }
        g.stroke({ width: W, color: 0xe0788f, alpha: 0.95, cap: 'round' })
        break
      }
      case 'shoal': {
        // banco di sabbia: trattini orizzontali + puntini
        for (const [y, w] of [[0.28, 0.5], [0.14, 0.34], [0.0, 0.2]]) {
          g.moveTo((-w / 2) * s, y * s)
          g.lineTo((w / 2) * s, y * s)
        }
        g.stroke({ width: Math.max(1, s * 0.06), color: 0xd8c98f, alpha: 0.95, cap: 'round' })
        g.circle(-0.1 * s, -0.16 * s, Math.max(1, s * 0.05))
        g.circle(0.14 * s, -0.12 * s, Math.max(1, s * 0.05))
        g.fill({ color: 0xcdbf8a })
        break
      }
      default: {
        // overlay futuri senza motivo dedicato: punto generico col colore base
        g.circle(0, 0, 0.4 * s)
        g.fill({ color: overlayColor(id) })
      }
    }
  }

  /** Disegna i veli "effetto" sugli hex visibili: neve (bianco), terra vulcanica
   * (rosso scuro), ghiaccio (azzurro chiaro). Un esagono semitrasparente sopra il
   * terreno che ne reinterpreta il colore lasciando intravedere il motivo. */
  private drawEffects(visible: Set<string>): void {
    const g = this.snowGfx
    g.clear()
    if (!this.doc || this.relCorners.length !== 6) return
    const veil = (key: string, color: number, alpha: number) => {
      const c = this.cellByKey.get(key)
      if (!c) return
      const pts = this.relCorners.flatMap((p) => [c.x + p.x * 0.99, c.y + p.y * 0.99])
      g.poly(pts)
      g.fill({ color, alpha })
    }
    for (const key of visible) {
      const t = this.doc.tiles[key]
      if (!t) continue
      if (t.snow) veil(key, 0xeef3f8, 0.62)
      else if (t.volcanic) veil(key, 0x7a2a1e, 0.5)
      else if (t.ice) veil(key, 0xd3e9f4, 0.6)
    }
  }

  /** Esagono pieno per il velo di fog, leggermente gonfiato per evitare giunzioni. */
  private rebuildFogTexture(doc: MapDocument): void {
    this.fogTexture?.destroy(true)
    const corners = hexCornersRelative(doc)
    const pts = corners.flatMap((p) => [p.x * 1.05, p.y * 1.05])
    const g = new Graphics()
    g.poly(pts)
    g.fill({ color: 0xffffff, alpha: 1 })
    this.fogTexture = this.app.renderer.generateTexture({
      target: g,
      resolution: 2,
      antialias: true,
    })
    g.destroy()
  }

  private acquireFog(): Sprite {
    const sp = this.fogPool.pop() ?? new Sprite()
    sp.texture = this.fogTexture!
    sp.anchor.set(0.5)
    sp.tint = FOG_COLOR
    sp.visible = true
    this.fogLayer.addChild(sp)
    return sp
  }

  private releaseFog(sp: Sprite): void {
    this.fogLayer.removeChild(sp)
    sp.visible = false
    this.fogPool.push(sp)
  }

  private drawHoverShape(doc: MapDocument): void {
    const corners = hexCornersRelative(doc)
    const pts = corners.flatMap((p) => [p.x, p.y])
    this.hoverGfx.clear()
    this.hoverGfx.poly(pts)
    this.hoverGfx.fill({ color: 0xffe066, alpha: 0.18 })
    this.hoverGfx.stroke({ width: 3, color: 0xffe066, alpha: 0.9, alignment: 0.5 })
    this.hoverGfx.visible = false
  }

  // ---- sprite pooling -----------------------------------------------------

  private acquire(): Sprite {
    let sp = this.spritePool.pop()
    if (!sp) {
      sp = new Sprite(this.hexTexture!)
      sp.anchor.set(0.5)
    } else {
      sp.texture = this.hexTexture!
    }
    sp.visible = true
    this.terrainLayer.addChild(sp)
    return sp
  }

  private release(sp: Sprite): void {
    this.terrainLayer.removeChild(sp)
    sp.visible = false
    this.spritePool.push(sp)
  }

  private clearSprites(): void {
    for (const sp of this.active.values()) this.release(sp)
    this.active.clear()
    for (const sp of this.overlayActive.values()) this.releaseOverlay(sp)
    this.overlayActive.clear()
    for (const sp of this.fogActive.values()) this.releaseFog(sp)
    this.fogActive.clear()
  }

  private acquireOverlay(): Sprite {
    const sp = this.overlayPool.pop() ?? new Sprite()
    sp.anchor.set(0.5)
    sp.visible = true
    this.overlayLayer.addChild(sp)
    return sp
  }

  private releaseOverlay(sp: Sprite): void {
    this.overlayLayer.removeChild(sp)
    sp.visible = false
    this.overlayPool.push(sp)
  }

  private terrainTextureFor(key: string): Texture {
    const terrain = this.doc?.tiles[key]?.terrain ?? ''
    return this.terrainTextures.get(terrain) ?? this.terrainTextures.get('') ?? this.hexTexture!
  }

  // ---- culling ------------------------------------------------------------

  private scheduleCull(): void {
    if (this.cullScheduled || this.destroyed) return
    this.cullScheduled = true
    requestAnimationFrame(() => {
      this.cullScheduled = false
      this.cull()
    })
  }

  private cull(): void {
    if (!this.inited || !this.doc || !this.hexTexture) return
    const s = this.world.scale.x
    const ext = hexExtent(this.doc)
    const marginX = ext.width
    const marginY = ext.height
    const minX = (-this.world.x) / s - marginX
    const minY = (-this.world.y) / s - marginY
    const maxX = (this.app.screen.width - this.world.x) / s + marginX
    const maxY = (this.app.screen.height - this.world.y) / s + marginY

    const visible = new Set<string>()
    for (const c of this.cells) {
      if (c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY) {
        visible.add(c.key)
      }
    }

    // rimuovi gli sprite non più visibili
    for (const [key, sp] of this.active) {
      if (!visible.has(key)) {
        this.release(sp)
        this.active.delete(key)
      }
    }
    // aggiungi/aggiorna i visibili
    for (const key of visible) {
      const c = this.cellByKey.get(key)!
      let sp = this.active.get(key)
      if (!sp) {
        sp = this.acquire()
        sp.position.set(c.x, c.y)
        this.active.set(key, sp)
      }
      sp.texture = this.terrainTextureFor(key)
      sp.tint = 0xffffff
    }

    // --- overlay layer (solo overlay-simbolo; i lineari sono percorsi) ---
    for (const [key, sp] of this.overlayActive) {
      const tile = this.doc.tiles[key]
      if (
        !visible.has(key) ||
        !tile?.overlay ||
        isLineOverlay(tile.overlay) ||
        !this.overlayTextures.has(tile.overlay)
      ) {
        this.releaseOverlay(sp)
        this.overlayActive.delete(key)
      }
    }
    for (const key of visible) {
      const tile = this.doc.tiles[key]
      if (!tile?.overlay || isLineOverlay(tile.overlay)) continue
      const tex = this.overlayTextures.get(tile.overlay)
      if (!tex) continue
      const c = this.cellByKey.get(key)!
      let sp = this.overlayActive.get(key)
      if (!sp) {
        sp = this.acquireOverlay()
        sp.position.set(c.x, c.y)
        this.overlayActive.set(key, sp)
      }
      sp.texture = tex
      sp.tint = 0xffffff // colore già cotto nella texture
      sp.rotation = (tile.rotation * Math.PI) / 180
    }

    // --- fog layer ---
    for (const [key, sp] of this.fogActive) {
      if (!visible.has(key)) {
        this.releaseFog(sp)
        this.fogActive.delete(key)
      }
    }
    for (const key of visible) {
      const fog = this.doc.tiles[key]?.fog ?? 'hidden'
      const alpha = fogAlpha(this.renderMode, fog)
      const existing = this.fogActive.get(key)
      if (alpha <= 0) {
        if (existing) {
          this.releaseFog(existing)
          this.fogActive.delete(key)
        }
        continue
      }
      let sp = existing
      if (!sp) {
        sp = this.acquireFog()
        const c = this.cellByKey.get(key)!
        sp.position.set(c.x, c.y)
        this.fogActive.set(key, sp)
      }
      sp.alpha = alpha
    }

    // --- effetti (neve/vulcanica/ghiaccio), percorsi (strade/fiumi) e ancore ---
    this.drawEffects(visible)
    this.drawPaths(visible)
    this.updateAnchors(visible)
    this.drawBlocked(visible)
    this.drawPlayer()
  }

  /** Bordi rossi sottili sugli hex dove i giocatori NON possono essere spostati
   * col mezzo/meteo attuali. Solo in modalità esplorazione; salta l'hex corrente
   * (che ha già il bordo blu). Molto più sottile del bordo dei giocatori. */
  private drawBlocked(visible: Set<string>): void {
    const g = this.blockedGfx
    g.clear()
    if (!this.doc || this.relCorners.length !== 6) return
    if (!this.callbacks.isExplorationMode?.()) return
    const playerKey = this.doc.playerPos
      ? keyOf(this.doc.playerPos.q, this.doc.playerPos.r)
      : null
    const width = Math.max(1, this.doc.hexSize * 0.05) // ~1/3 del bordo blu (0.16)
    for (const key of visible) {
      if (key === playerKey) continue
      if (!isBlocked(this.doc, key)) continue
      const cell = this.cellByKey.get(key)
      if (!cell) continue
      const pts = this.relCorners.flatMap((c) => [cell.x + c.x, cell.y + c.y])
      g.poly(pts)
      g.stroke({ width, color: 0xd0504c, alpha: 0.7, alignment: 0 })
    }
  }

  /** Bordo blu sull'esagono dei giocatori. */
  private drawPlayer(): void {
    const g = this.playerGfx
    g.clear()
    const pos = this.doc?.playerPos
    if (!pos || this.relCorners.length !== 6) return
    const cell = this.cellByKey.get(keyOf(pos.q, pos.r))
    if (!cell) return
    const pts = this.relCorners.flatMap((c) => [cell.x + c.x, cell.y + c.y])
    g.poly(pts)
    g.stroke({
      width: Math.max(2, this.doc!.hexSize * 0.16),
      color: 0x3a9bdc,
      alpha: 1,
      alignment: 0.5,
    })
  }

  /** Disegna i percorsi (2 uscite = arco, 3 = incrocio) in un Graphics. */
  private drawHexPaths(g: Graphics, cx: number, cy: number, paths: HexPath[]): void {
    if (!this.doc || this.relEdgeMids.length !== 6) return
    const size = this.doc.hexSize
    for (const path of paths) {
      if (!Array.isArray(path.edges)) continue
      const color = overlayColor(path.kind)
      const width = path.kind === 'river' ? size * 0.24 : size * 0.16
      if (path.edges.length === 2) {
        const a = this.relEdgeMids[path.edges[0]]
        const b = this.relEdgeMids[path.edges[1]]
        if (!a || !b) continue
        g.moveTo(cx + a.x, cy + a.y)
        g.quadraticCurveTo(cx, cy, cx + b.x, cy + b.y)
        g.stroke({ width, color, alpha: 1, cap: 'round', join: 'round' })
      } else if (path.edges.length >= 3) {
        // incrocio: un raggio da ogni uscita al centro
        for (const e of path.edges) {
          const m = this.relEdgeMids[e]
          if (!m) continue
          g.moveTo(cx + m.x, cy + m.y)
          g.lineTo(cx, cy)
          g.stroke({ width, color, alpha: 1, cap: 'round', join: 'round' })
        }
        g.circle(cx, cy, width * 0.75)
        g.fill({ color })
      }
      // length < 2: uscita in attesa (nessun disegno; l'ancora gialla la segnala)
    }
  }

  private drawPaths(visible: Set<string>): void {
    const g = this.pathGfx
    g.clear()
    if (!this.doc) return
    for (const key of visible) {
      const tile = this.doc.tiles[key]
      if (!tile?.paths?.length) continue
      const c = this.cellByKey.get(key)!
      this.drawHexPaths(g, c.x, c.y, tile.paths)
    }
  }

  /** Un'ancora è "usata" se è un lato-uscita di un percorso disegnato. */
  private isUsedAnchor(entry: AnchorEntry): boolean {
    if (!this.doc) return false
    for (const m of entry.members) {
      const paths = this.doc.tiles[m.hexKey]?.paths
      if (paths?.some((p) => Array.isArray(p.edges) && p.edges.some((e) => e === m.edge))) {
        return true
      }
    }
    return false
  }

  /** Ricostruisce indice + disegno delle ancore (colorate per stato/selezione). */
  private updateAnchors(visible: Set<string>): void {
    const g = this.anchorGfx
    g.clear()
    this.anchorIndex.clear()

    const active = this.callbacks.isAnchorMode?.() ?? false
    const kind = this.callbacks.pathKind?.() ?? null
    if (!active || !this.doc || this.relEdgeMids.length !== 6 || visible.size > ANCHOR_CAP) {
      this.clearSelection()
      return
    }
    // cambio strumento/tipo -> azzera la selezione
    if (kind !== this.lastKind) {
      this.clearSelection()
      this.lastKind = kind
    }

    // indicizza le ancore (dedup per posizione: i lati condivisi coincidono)
    for (const key of visible) {
      const c = this.cellByKey.get(key)!
      for (let e = 0; e < 6; e++) {
        const m = this.relEdgeMids[e]
        const x = c.x + m.x
        const y = c.y + m.y
        const pkey = `${Math.round(x)},${Math.round(y)}`
        let entry = this.anchorIndex.get(pkey)
        if (!entry) {
          entry = { x, y, members: [] }
          this.anchorIndex.set(pkey, entry)
        }
        entry.members.push({ hexKey: key, edge: e })
      }
    }

    const size = this.doc.hexSize
    const baseR = Math.max(2, size * 0.13)
    for (const [pkey, entry] of this.anchorIndex) {
      const selected = this.selPkeys.has(pkey)
      const usable = this.usablePkeys.has(pkey)
      const used = !selected && this.isUsedAnchor(entry)
      g.circle(entry.x, entry.y, selected || usable ? baseR * 1.3 : baseR)
      // riempimento
      if (selected) g.fill({ color: 0xffe066, alpha: 1 }) // giallo pieno = selezionato
      else if (used) g.fill({ color: 0x4aa3df, alpha: 1 }) // blu = usato
      else g.fill({ color: 0xffffff, alpha: 0.85 })
      // bordo
      if (selected) {
        g.stroke({ width: Math.max(1, size * 0.04), color: 0x000000, alpha: 0.5 })
      } else if (usable) {
        g.stroke({ width: Math.max(2, size * 0.06), color: 0xffe066, alpha: 1 }) // bordo giallo
      } else {
        g.stroke({ width: Math.max(1, size * 0.03), color: 0x000000, alpha: 0.4 })
      }
    }
  }

  // ---- interazione ancore (selezione guidata) -----------------------------

  private pkeyOfEdge(hexKey: string, edge: number): string | null {
    const cell = this.cellByKey.get(hexKey)
    const m = this.relEdgeMids[edge]
    if (!cell || !m) return null
    return `${Math.round(cell.x + m.x)},${Math.round(cell.y + m.y)}`
  }

  private currentKind(): string {
    return this.callbacks.pathKind?.() ?? 'road'
  }

  private clearSelection(): void {
    // azzera SOLO lo stato transitorio della selezione: i percorsi già scritti
    // restano (non si cancella un elemento se non riselezionandone le ancore).
    this.selPkeys.clear()
    this.ownedHexes.clear()
    this.usablePkeys.clear()
  }

  private committedEdges(hexKey: string, kind: string): number[] {
    const path = this.doc?.tiles[hexKey]?.paths?.find((p) => p.kind === kind)
    return path ? [...path.edges] : []
  }

  /** Lati di un esagono attualmente selezionati. */
  private selectedEdgesOf(hexKey: string): number[] {
    const out: number[] = []
    for (let e = 0; e < 6; e++) {
      const pk = this.pkeyOfEdge(hexKey, e)
      if (pk && this.selPkeys.has(pk)) out.push(e)
    }
    return out
  }

  /** Aggiunge un'ancora alla selezione, prendendo "possesso" degli esagoni
   * coinvolti: freschi (senza percorso) oppure quelli di cui si clicca un'uscita
   * esistente (che viene assorbita per la modifica). */
  private addAnchor(pkey: string): void {
    const kind = this.currentKind()
    this.selPkeys.add(pkey)
    const entry = this.anchorIndex.get(pkey)
    for (const m of entry?.members ?? []) {
      if (this.ownedHexes.has(m.hexKey)) continue
      const committed = this.committedEdges(m.hexKey, kind)
      if (committed.length === 0) {
        this.ownedHexes.add(m.hexKey) // esagono fresco
      } else if (committed.includes(m.edge)) {
        // si è cliccata un'uscita di un elemento esistente: lo si prende in
        // carico assorbendone tutte le uscite
        this.ownedHexes.add(m.hexKey)
        for (const e of committed) {
          const pk = this.pkeyOfEdge(m.hexKey, e)
          if (pk) this.selPkeys.add(pk)
        }
      }
      // esagono con elemento esistente di cui NON si è cliccata un'uscita:
      // non si possiede -> resta intatto.
    }
  }

  /** Ricalcola le ancore utilizzabili: lati non adiacenti a quelli selezionati,
   * su TUTTI gli esagoni posseduti (si lavora su entrambi i lati condivisi). */
  private recomputeUsable(): void {
    this.usablePkeys.clear()
    for (const H of this.ownedHexes) {
      const selEdges = this.selectedEdgesOf(H)
      for (let e = 0; e < 6; e++) {
        const pkey = this.pkeyOfEdge(H, e)
        if (!pkey || this.selPkeys.has(pkey)) continue
        if (selEdges.every((se) => !edgesAdjacent(se as Edge, e as Edge))) {
          this.usablePkeys.add(pkey)
        }
      }
    }
  }

  /** Scrive in dati le uscite di ogni esagono posseduto (>=2 = percorso, altrimenti
   * rimosso); poi smette di possedere gli esagoni rimasti senza uscite. */
  private writeOwned(): void {
    const kind = this.currentKind()
    for (const H of [...this.ownedHexes]) {
      const edges = this.selectedEdgesOf(H)
      this.callbacks.onSetPath?.(H, kind, edges.length >= 2 ? edges : [])
      if (edges.length === 0) this.ownedHexes.delete(H)
    }
  }

  private handleAnchorClick(p: { x: number; y: number }): void {
    if (!this.doc) return
    const w = this.screenToWorld(p.x, p.y)
    let bestPkey: string | null = null
    let bestD = this.doc.hexSize * 0.5
    for (const [pkey, entry] of this.anchorIndex) {
      const d = Math.hypot(entry.x - w.x, entry.y - w.y)
      if (d < bestD) {
        bestD = d
        bestPkey = pkey
      }
    }

    if (!bestPkey) {
      // click nel vuoto: conferma e azzera la selezione (i percorsi restano)
      this.clearSelection()
      this.scheduleCull()
      return
    }

    if (this.selPkeys.size === 0) {
      // nuova selezione
      this.addAnchor(bestPkey)
      this.recomputeUsable()
      this.writeOwned()
    } else if (this.selPkeys.has(bestPkey)) {
      // deseleziona (può ridurre/rimuovere un percorso: è "riselezionare le
      // ancore dell'elemento")
      this.selPkeys.delete(bestPkey)
      this.writeOwned()
      this.recomputeUsable()
      if (this.selPkeys.size === 0) this.clearSelection()
    } else if (this.usablePkeys.has(bestPkey)) {
      this.addAnchor(bestPkey)
      this.recomputeUsable()
      this.writeOwned()
    } else {
      // ancora non utilizzabile: azzera solo la selezione (nessun elemento
      // viene cancellato). Un nuovo click ricomincerà da capo.
      this.clearSelection()
    }
    this.scheduleCull()
  }

  // ---- viewport -----------------------------------------------------------

  private fitToView(doc: MapDocument): void {
    const b = mapPixelBounds(doc)
    const mapW = Math.max(1, b.maxX - b.minX)
    const mapH = Math.max(1, b.maxY - b.minY)
    const sw = this.app.screen.width || 800
    const sh = this.app.screen.height || 600
    const pad = 48
    const scale = clamp(
      Math.min((sw - pad * 2) / mapW, (sh - pad * 2) / mapH),
      MIN_SCALE,
      MAX_SCALE,
    )
    this.world.scale.set(scale)
    const cx = (b.minX + b.maxX) / 2
    const cy = (b.minY + b.maxY) / 2
    this.world.x = sw / 2 - cx * scale
    this.world.y = sh / 2 - cy * scale
  }

  private zoomAt(cx: number, cy: number, factor: number): void {
    const old = this.world.scale.x
    const next = clamp(old * factor, MIN_SCALE, MAX_SCALE)
    if (next === old) return
    const k = next / old
    this.world.x = cx - (cx - this.world.x) * k
    this.world.y = cy - (cy - this.world.y) * k
    this.world.scale.set(next)
    this.scheduleCull()
  }

  // ---- eventi -------------------------------------------------------------

  private localPoint(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private screenToWorld(x: number, y: number): { x: number; y: number } {
    const s = this.world.scale.x
    return { x: (x - this.world.x) / s, y: (y - this.world.y) / s }
  }

  private onPointerDown = (e: PointerEvent): void => {
    const p = this.localPoint(e)
    this.lastPointer = p
    this.activePointers.set(e.pointerId, p)
    try {
      this.canvas.setPointerCapture?.(e.pointerId)
    } catch {
      /* pointerId non catturabile (es. evento sintetico): si procede comunque */
    }
    // Due dita: avvia il pinch (zoom + pan), annullando drag/pittura in corso.
    if (this.activePointers.size >= 2) {
      this.dragging = false
      this.painting = false
      this.lastPaintKey = null
      this.syncPinchAnchor()
      return
    }
    // Sinistro: modalità ancore -> seleziona; pennello attivo -> dipinge;
    // altrimenti pan (sinistro col tool pan, o tasto destro/centrale sempre).
    if (e.button === 0 && this.callbacks.isAnchorMode?.()) {
      this.handleAnchorClick(p)
    } else if (e.button === 0 && this.callbacks.isPlayerMode?.()) {
      this.movePlayersAt(p)
    } else if (e.button === 0 && this.callbacks.isPaintActive?.()) {
      this.painting = true
      this.lastPaintKey = null
      this.paintAt(p)
    } else {
      this.dragging = true
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.localPoint(e)
    if (this.activePointers.has(e.pointerId)) this.activePointers.set(e.pointerId, p)
    // Pinch a due dita: zoom attorno al punto medio + pan col suo movimento.
    if (this.pinch && this.activePointers.size >= 2) {
      this.handlePinch()
      return
    }
    if (this.dragging) {
      this.world.x += p.x - this.lastPointer.x
      this.world.y += p.y - this.lastPointer.y
      this.lastPointer = p
      this.scheduleCull()
    } else if (this.painting) {
      this.paintAt(p)
    }
    this.updateHover(p)
  }

  private onPointerUp = (e: PointerEvent): void => {
    this.endPointer(e.pointerId)
    try {
      this.canvas.releasePointerCapture?.(e.pointerId)
    } catch {
      /* nessuna cattura attiva da rilasciare */
    }
  }

  private onPointerCancel = (e: PointerEvent): void => {
    this.endPointer(e.pointerId)
  }

  /** Rimuove un puntatore e ripristina lo stato di gesto coerente. */
  private endPointer(pointerId: number): void {
    this.activePointers.delete(pointerId)
    if (this.activePointers.size < 2) this.pinch = null
    if (this.activePointers.size === 0) {
      this.dragging = false
      this.painting = false
      this.lastPaintKey = null
    } else if (this.activePointers.size === 1) {
      // resta un dito dopo il pinch: niente pan/pittura finché non si rialza
      this.dragging = false
      this.painting = false
      const [only] = this.activePointers.values()
      if (only) this.lastPointer = only
    }
  }

  /** Memorizza distanza e punto medio correnti tra le prime due dita. */
  private syncPinchAnchor(): void {
    const pts = [...this.activePointers.values()]
    if (pts.length < 2) {
      this.pinch = null
      return
    }
    const [a, b] = pts
    this.pinch = {
      dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    }
  }

  /** Applica un passo di pinch: zoom proporzionale + pan del punto medio. */
  private handlePinch(): void {
    const prev = this.pinch
    const pts = [...this.activePointers.values()]
    if (!prev || pts.length < 2) return
    const [a, b] = pts
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const midX = (a.x + b.x) / 2
    const midY = (a.y + b.y) / 2
    this.zoomAt(midX, midY, dist / prev.dist)
    this.world.x += midX - prev.midX
    this.world.y += midY - prev.midY
    this.pinch = { dist, midX, midY }
    this.scheduleCull()
  }

  private onPointerLeave = (): void => {
    this.dragging = false
    this.painting = false
    this.lastPaintKey = null
    this.hoverGfx.visible = false
    this.callbacks.onHover?.(null)
  }

  /** Sposta i giocatori sull'hex sotto il puntatore (click singolo). */
  private movePlayersAt(p: { x: number; y: number }): void {
    if (!this.doc) return
    const w = this.screenToWorld(p.x, p.y)
    const { q, r } = pointToAxial(this.doc, w.x, w.y)
    if (this.cellByKey.has(`${q},${r}`)) this.callbacks.onMovePlayers?.(q, r)
  }

  /** Dipinge l'hex sotto il puntatore; riempie la linea dall'ultimo hex per
   * evitare buchi durante drag veloci. */
  private paintAt(p: { x: number; y: number }): void {
    if (!this.doc) return
    const w = this.screenToWorld(p.x, p.y)
    const { q, r } = pointToAxial(this.doc, w.x, w.y)
    const key = `${q},${r}`
    if (!this.cellByKey.has(key) || key === this.lastPaintKey) return
    if (this.lastPaintKey) {
      const last = parseKey(this.lastPaintKey)
      for (const a of axialLine(last, { q, r })) {
        if (this.cellByKey.has(`${a.q},${a.r}`)) this.callbacks.onPaint?.(a.q, a.r)
      }
    } else {
      this.callbacks.onPaint?.(q, r)
    }
    this.lastPaintKey = key
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const p = this.localPoint(e)
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    this.zoomAt(p.x, p.y, factor)
  }

  private updateHover(p: { x: number; y: number }): void {
    if (!this.doc) return
    const w = this.screenToWorld(p.x, p.y)
    const { q, r } = pointToAxial(this.doc, w.x, w.y)
    const key = `${q},${r}`
    const cell = this.cellByKey.get(key)
    if (cell) {
      this.hoverGfx.position.set(cell.x, cell.y)
      this.hoverGfx.visible = true
      this.callbacks.onHover?.({ q, r })
    } else {
      this.hoverGfx.visible = false
      this.callbacks.onHover?.(null)
    }
  }

  private attachEvents(): void {
    const c = this.canvas
    c.addEventListener('pointerdown', this.onPointerDown)
    c.addEventListener('pointermove', this.onPointerMove)
    c.addEventListener('pointerup', this.onPointerUp)
    c.addEventListener('pointercancel', this.onPointerCancel)
    c.addEventListener('pointerleave', this.onPointerLeave)
    c.addEventListener('wheel', this.onWheel, { passive: false })
    c.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private detachEvents(): void {
    if (!this.canvas) return
    const c = this.canvas
    c.removeEventListener('pointerdown', this.onPointerDown)
    c.removeEventListener('pointermove', this.onPointerMove)
    c.removeEventListener('pointerup', this.onPointerUp)
    c.removeEventListener('pointercancel', this.onPointerCancel)
    c.removeEventListener('pointerleave', this.onPointerLeave)
    c.removeEventListener('wheel', this.onWheel)
  }

  destroy(): void {
    this.destroyed = true
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.inited) {
      this.detachEvents()
      this.hexTexture?.destroy(true)
      this.hexTexture = null
      for (const tex of this.terrainTextures.values()) tex.destroy(true)
      this.terrainTextures.clear()
      for (const tex of this.overlayTextures.values()) tex.destroy(true)
      this.overlayTextures.clear()
      this.fogTexture?.destroy(true)
      this.fogTexture = null
      this.app.destroy({ removeView: true }, { children: true })
    }
  }
}
