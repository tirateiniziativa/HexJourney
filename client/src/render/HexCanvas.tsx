import { useEffect, useRef } from 'react'
import { PixiManager } from './PixiManager'
import { setRenderer } from './rendererRef'
import { useMapStore } from '@/store/mapStore'
import { getTileDef } from '@/data/catalog'

const isLineOverlay = (id: string) => getTileDef(id)?.shape === 'line'

export default function HexCanvas() {
  const ref = useRef<HTMLDivElement>(null)
  const managerRef = useRef<PixiManager | null>(null)
  const doc = useMapStore((s) => s.doc)
  const mode = useMapStore((s) => s.mode)
  const tool = useMapStore((s) => s.tool)
  const brushKind = useMapStore((s) => s.brushKind)
  const selectedOverlay = useMapStore((s) => s.selectedOverlay)

  // Crea il motore Pixi una sola volta (gestendo il doppio mount di StrictMode).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const manager = new PixiManager()
    managerRef.current = manager
    setRenderer(manager)
    manager
      .init(el, {
        onHover: (h) => useMapStore.getState().setHovered(h),
        isPaintActive: () => {
          const s = useMapStore.getState()
          if (s.mode !== 'gm' || s.tool === 'pan' || s.sessionRole === 'player') return false
          if (s.brushKind === 'players') return false // sposta i giocatori, non dipinge
          // gli overlay lineari (strade/fiumi) usano le ancore, non il pennello
          if (s.brushKind === 'overlay' && isLineOverlay(s.selectedOverlay)) return false
          return true
        },
        isPlayerMode: () => {
          const s = useMapStore.getState()
          return (
            s.mode === 'gm' &&
            s.tool !== 'pan' &&
            s.sessionRole !== 'player' &&
            s.brushKind === 'players'
          )
        },
        onMovePlayers: (q, r) => {
          const s = useMapStore.getState()
          if (s.mode !== 'gm' || s.sessionRole === 'player') return
          s.requestMovePlayers(q, r)
        },
        isAnchorMode: () => {
          const s = useMapStore.getState()
          return (
            s.mode === 'gm' &&
            s.tool !== 'pan' &&
            s.sessionRole !== 'player' &&
            s.brushKind === 'overlay' &&
            isLineOverlay(s.selectedOverlay)
          )
        },
        pathKind: () => useMapStore.getState().selectedOverlay,
        onSetPath: (hexKey, kind, edges) => {
          const s = useMapStore.getState()
          if (s.mode !== 'gm' || s.sessionRole === 'player') return
          s.setPath(hexKey, kind, edges as (0 | 1 | 2 | 3 | 4 | 5)[])
        },
        onPaint: (q, r) => {
          const s = useMapStore.getState()
          if (s.mode !== 'gm' || s.tool === 'pan' || s.sessionRole === 'player') return
          if (s.brushKind === 'terrain') {
            s.setTerrainAt(q, r, s.selectedTerrain)
          } else if (s.brushKind === 'effect') {
            s.setTileEffect(q, r, s.selectedEffect, true)
          } else if (s.brushKind === 'overlay' && !isLineOverlay(s.selectedOverlay)) {
            s.setOverlayAt(q, r, s.selectedOverlay, s.selectedRotation)
            // "Rimuovi" (overlay vuoto) azzera anche gli effetti (neve/vulcanica/ghiaccio)
            if (s.selectedOverlay === '') s.setTileEffect(q, r, 'snow', false)
          } else if (s.brushKind === 'fog') {
            s.setFogAt(q, r, s.fogBrush)
          }
        },
      })
      .catch((err) => console.error('[pixi] init error', err))
    return () => {
      manager.destroy()
      if (managerRef.current === manager) managerRef.current = null
      setRenderer(null)
    }
  }, [])

  // Applica il documento corrente al motore quando cambia.
  useEffect(() => {
    if (doc) managerRef.current?.setDoc(doc)
  }, [doc])

  // Sincronizza la modalità di rendering (GM/Giocatore) col motore.
  useEffect(() => {
    managerRef.current?.setRenderMode(mode)
  }, [mode])

  // Mostra/nasconde le ancore quando cambia lo strumento attivo.
  useEffect(() => {
    managerRef.current?.requestRedraw()
  }, [tool, brushKind, selectedOverlay, mode])

  return <div ref={ref} className="hex-canvas" />
}
