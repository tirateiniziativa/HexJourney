import { useLayoutEffect, useRef, useState } from 'react'
import { OVERLAYS, TERRAINS, getTileDef, type TileDef } from '@/data/catalog'
import { DEFAULT_SCALE, SCALES, VEHICLES, formatDistance, formatTravel, scaleOf } from '@/data/travel'
import { useMapStore, type EffectKind } from '@/store/mapStore'
import { useT } from '@/i18n/useT'
import type { FogState, MapScale, Vehicle } from '@/model/types'
import type { Device } from './useDevice'
import Legend from './Legend'

const HOURS_OPTIONS = Array.from({ length: 30 - 6 + 1 }, (_, i) => i + 6) // 6..30

const FOG_OPTIONS: { state: FogState; key: string; color: string }[] = [
  { state: 'visible', key: 'fog.visible', color: '#4caf50' },
  { state: 'explored', key: 'fog.explored', color: '#caa53b' },
  { state: 'hidden', key: 'fog.hidden', color: '#2b2e3b' },
]

const LAND_OVERLAYS = OVERLAYS.filter((o) => o.on === 'land' || o.on === 'both')
const WATER_OVERLAYS = OVERLAYS.filter((o) => o.on === 'water' || o.on === 'both')

// Vincoli di larghezza della barra laterale e costanti di layout degli swatch
// (devono restare allineate al CSS: gap della griglia + padding orizzontale).
const SIDEBAR_MIN = 224
const SIDEBAR_MAX = 480
const SIDEBAR_GRID_GAP = 8
const SIDEBAR_PADDING_X = 24

/** Larghezza (px) per contenere senza tagli una griglia di swatch a 2 colonne
 * con le `labels` date. Misura il vero layout di uno swatch fuori schermo, così
 * tiene conto di colore, gap, padding e bordo reali. */
function fitSidebarWidth(labels: string[]): number {
  const probe = document.createElement('div')
  probe.className = 'swatch'
  probe.style.cssText =
    'position:absolute;visibility:hidden;left:-9999px;top:0;width:auto;white-space:nowrap'
  const color = document.createElement('span')
  color.className = 'swatch-color'
  const name = document.createElement('span')
  name.className = 'swatch-name'
  // forza la larghezza piena del testo (niente ellissi durante la misura)
  name.style.cssText = 'overflow:visible;text-overflow:clip;white-space:nowrap'
  probe.append(color, name)
  document.body.appendChild(probe)
  let maxSwatch = 0
  for (const l of labels) {
    name.textContent = l
    if (probe.offsetWidth > maxSwatch) maxSwatch = probe.offsetWidth
  }
  document.body.removeChild(probe)
  const w = Math.round(2 * maxSwatch + SIDEBAR_GRID_GAP + SIDEBAR_PADDING_X)
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w))
}

export default function Palette({
  device = 'desktop',
  drawerOpen = false,
  onCloseDrawer,
}: {
  device?: Device
  /** stato del cassetto a scomparsa (solo mobile) */
  drawerOpen?: boolean
  onCloseDrawer?: () => void
} = {}) {
  const t = useT()
  const lang = useMapStore((s) => s.lang)
  const mode = useMapStore((s) => s.mode)
  const tool = useMapStore((s) => s.tool)
  const brushKind = useMapStore((s) => s.brushKind)
  const selectedTerrain = useMapStore((s) => s.selectedTerrain)
  const selectedOverlay = useMapStore((s) => s.selectedOverlay)
  const fogBrush = useMapStore((s) => s.fogBrush)
  const setSelectedTerrain = useMapStore((s) => s.setSelectedTerrain)
  const setSelectedOverlay = useMapStore((s) => s.setSelectedOverlay)
  const selectedEffect = useMapStore((s) => s.selectedEffect)
  const setEffectTool = useMapStore((s) => s.setEffectTool)
  const setFogBrush = useMapStore((s) => s.setFogBrush)
  const revealAll = useMapStore((s) => s.revealAll)
  const hideAll = useMapStore((s) => s.hideAll)
  const setPlayerTool = useMapStore((s) => s.setPlayerTool)
  const undoPlayers = useMapStore((s) => s.undoPlayers)
  const resetExploration = useMapStore((s) => s.resetExploration)
  const resetTravel = useMapStore((s) => s.resetTravel)
  const adjustTravelDays = useMapStore((s) => s.adjustTravelDays)
  const playerUndoCount = useMapStore((s) => s.playerUndo.length)
  const doc = useMapStore((s) => s.doc)
  const mapName = useMapStore((s) => s.doc?.name ?? '')
  const setMapName = useMapStore((s) => s.setMapName)
  const playerPos = useMapStore((s) => s.doc?.playerPos ?? null)
  const hoursPerDay = useMapStore((s) => s.doc?.hoursPerDay ?? 24)
  const setHoursPerDay = useMapStore((s) => s.setHoursPerDay)
  const travelDays = useMapStore((s) => s.doc?.travelDays)
  const travelDistanceKm = useMapStore((s) => s.doc?.travelDistanceKm)
  const scale = useMapStore((s) => s.doc?.scale ?? DEFAULT_SCALE)
  const setScale = useMapStore((s) => s.setScale)
  const vehicle = useMapStore((s) => s.doc?.vehicle ?? 'foot')
  const setVehicle = useMapStore((s) => s.setVehicle)
  const distanceUnit = useMapStore((s) => s.distanceUnit)

  // --- Larghezza adattiva + ridimensionamento orizzontale della barra ---
  const sidebarRef = useRef<HTMLElement>(null)
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null)
  const drag = useRef<{ startX: number; startW: number } | null>(null)

  const measureWidth = () =>
    fitSidebarWidth([
      ...TERRAINS.map((td) => t(`terrain.${td.id}`)),
      ...OVERLAYS.map((o) => t(`overlay.${o.id}`)),
      ...FOG_OPTIONS.map((f) => t(f.key)),
      t('players.move'),
      t('palette.remove'),
    ])

  // All'avvio e a ogni cambio lingua: adatta la larghezza per mostrare tutto il
  // contenuto (padding incluso) senza troncamenti.
  useLayoutEffect(() => {
    setSidebarWidth(measureWidth())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { startX: e.clientX, startW: sidebarRef.current?.offsetWidth ?? SIDEBAR_MIN }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* pointerId non catturabile (es. evento sintetico): si procede comunque */
    }
  }
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const max = Math.min(SIDEBAR_MAX, Math.round(window.innerWidth * 0.5))
    const next = Math.max(SIDEBAR_MIN, Math.min(max, d.startW + (e.clientX - d.startX)))
    setSidebarWidth(next)
  }
  const onResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    } catch {
      /* nessuna cattura attiva da rilasciare */
    }
  }

  // Su mobile la palette è un cassetto a scomparsa; chiuderlo dopo aver scelto
  // uno strumento libera la vista sulla mappa.
  const isDrawer = device === 'mobile'
  const closeDrawer = () => {
    if (isDrawer) onCloseDrawer?.()
  }

  /** Avvolge il contenuto nella barra laterale con scroll interno. Su desktop/
   * tablet è in linea con maniglia di ridimensionamento; su mobile è un cassetto
   * a scomparsa con backdrop e pulsante di chiusura. */
  const renderSidebar = (content: React.ReactNode) => (
    <>
      {isDrawer && drawerOpen && <div className="drawer-backdrop" onClick={onCloseDrawer} />}
      <aside
        ref={sidebarRef}
        className={`sidebar${isDrawer ? ' drawer' : ''}${isDrawer && drawerOpen ? ' open' : ''}`}
        style={!isDrawer && sidebarWidth != null ? { width: sidebarWidth } : undefined}
        aria-hidden={isDrawer && !drawerOpen ? true : undefined}
      >
        {isDrawer && (
          <div className="drawer-header">
            <button
              className="btn ghost drawer-close"
              onClick={onCloseDrawer}
              aria-label={t('common.close')}
              title={t('common.close')}
            >
              ✕
            </button>
          </div>
        )}
        <div className="sidebar-scroll">{content}</div>
        {!isDrawer && (
          <div
            className="sidebar-resize"
            role="separator"
            aria-orientation="vertical"
            title={t('palette.resizeHandle')}
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            onDoubleClick={() => setSidebarWidth(measureWidth())}
          />
        )}
      </aside>
    </>
  )

  const travelText =
    travelDays == null
      ? 'N/D'
      : formatTravel(travelDays, hoursPerDay, t('unit.day'), t('unit.hour'), t('unit.minute'))
  const distanceText = travelDistanceKm == null ? 'N/D' : formatDistance(travelDistanceKm, distanceUnit)

  // Intestazione: nome mappa + scala e "cosa rappresenta" (entrambe le modalità).
  const sc = doc ? scaleOf(doc) : SCALES[1]
  const nameHeader = (
    <div className="map-name-section">
      {mode === 'gm' ? (
        <input
          className="map-name-input"
          value={mapName}
          onChange={(e) => setMapName(e.target.value)}
          placeholder={t('mapName.placeholder')}
          aria-label={t('mapName.placeholder')}
          title={t('mapName.title')}
        />
      ) : (
        <div className="map-name-readonly" title={mapName}>
          {mapName}
        </div>
      )}
      <div className="map-scale-line muted small">
        <strong>{t(`scale.${scale}`)}</strong> · {t('scale.hex', { mi: sc.miles, km: sc.km })}
      </div>
      <div className="map-scale-note muted small">{t(sc.noteKey)}</div>
    </div>
  )

  // --- Modalità Giocatore: sola lettura + viaggio + leggenda ---
  if (mode !== 'gm') {
    return renderSidebar(
      <>
        {nameHeader}
        <div className="panel-section">
          <div className="panel-title">{t('role.player')}</div>
          <p className="muted small">{t('palette.player.readonly')}</p>
        </div>

        <div className="panel-section">
          <div className="panel-title">{t('travel.title')}</div>
          <div className="travel-field">
            <span className="muted small">{t('explore.vehicle')}</span>
            <strong>{t(`vehicle.${vehicle}`)}</strong>
          </div>
          <div className="travel-field">
            <span className="muted small">{t('travel.hoursPerDay')}</span>
            <strong>{hoursPerDay}</strong>
          </div>
          <div className="travel-field">
            <span className="muted small">{t('travel.estimate')}</span>
            <strong className="travel-value">{travelText}</strong>
          </div>
          <div className="travel-field">
            <span className="muted small">{t('travel.distance')}</span>
            <strong className="travel-value">{distanceText}</strong>
          </div>
        </div>

        <Legend />
      </>,
    )
  }

  const terrainActive = (id: string) => brushKind === 'terrain' && selectedTerrain === id
  const overlayActive = (id: string) => brushKind === 'overlay' && selectedOverlay === id

  const overlaySwatch = (o: TileDef) => {
    if (o.shape === 'effect') {
      const eff = o.id as EffectKind
      return (
        <button
          key={o.id}
          className={'swatch' + (brushKind === 'effect' && selectedEffect === eff ? ' active' : '')}
          onClick={() => {
            setEffectTool(eff)
            closeDrawer()
          }}
          title={t(`overlay.${o.id}`)}
        >
          <span className="swatch-color" style={{ background: o.color }} />
          <span className="swatch-name">{t(`overlay.${o.id}`)}</span>
        </button>
      )
    }
    return (
      <button
        key={o.id}
        className={'swatch' + (overlayActive(o.id) ? ' active' : '')}
        onClick={() => {
          setSelectedOverlay(o.id)
          closeDrawer()
        }}
        title={t(`overlay.${o.id}`)}
      >
        <span className="swatch-color" style={{ background: o.color }} />
        <span className="swatch-name">{t(`overlay.${o.id}`)}</span>
      </button>
    )
  }

  // Swatch "Rimuovi" (overlay vuoto): azzera overlay ed effetti dell'hex.
  // Presente sia tra gli overlay di terra sia tra quelli d'acqua.
  const removeSwatch = () => (
    <button
      key="__remove"
      className={'swatch' + (overlayActive('') ? ' active' : '')}
      onClick={() => {
        setSelectedOverlay('')
        closeDrawer()
      }}
      title={t('palette.remove.title')}
    >
      <span className="swatch-color swatch-erase">✕</span>
      <span className="swatch-name">{t('palette.remove')}</span>
    </button>
  )

  // --- PENNELLO: scala + terreni + overlay ---
  const brushSections = (
    <>
      <div className="panel-section">
        <div className="panel-title">{t('palette.scale')}</div>
        <label className="field">
          <select value={scale} onChange={(e) => setScale(e.target.value as MapScale)}>
            {SCALES.map((s) => (
              <option key={s.id} value={s.id}>
                {t(`scale.${s.id}`)} — {s.miles} mi / {s.km} km
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel-section">
        <div className="panel-title">{t('palette.terrains')}</div>
        <div className="swatch-grid">
          {TERRAINS.map((td) => (
            <button
              key={td.id}
              className={'swatch' + (terrainActive(td.id) ? ' active' : '')}
              onClick={() => {
                setSelectedTerrain(td.id)
                closeDrawer()
              }}
              title={t(`terrain.${td.id}`)}
            >
              <span className="swatch-color" style={{ background: td.color }} />
              <span className="swatch-name">{t(`terrain.${td.id}`)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">{t('legend.overlaysLand')}</div>
        <div className="swatch-grid">
          {LAND_OVERLAYS.map(overlaySwatch)}
          {removeSwatch()}
        </div>

        {brushKind === 'overlay' &&
          selectedOverlay &&
          getTileDef(selectedOverlay)?.shape === 'line' && (
            <p className="muted small anchor-hint">{t('palette.anchorHint')}</p>
          )}
      </div>

      <div className="panel-section">
        <div className="panel-title">{t('legend.overlaysWater')}</div>
        <div className="swatch-grid">
          {WATER_OVERLAYS.map(overlaySwatch)}
          {removeSwatch()}
        </div>
      </div>
    </>
  )

  // --- ESPLORAZIONE: mezzo + viaggio + fog + giocatori + leggenda ---
  const exploreSections = (
    <>
      <div className="panel-section">
        <div className="panel-title">{t('explore.vehicle')}</div>
        <label className="field">
          <select value={vehicle} onChange={(e) => setVehicle(e.target.value as Vehicle)}>
            {VEHICLES.map((v) => (
              <option key={v} value={v}>
                {t(`vehicle.${v}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel-section">
        <div className="panel-title">{t('travel.title')}</div>
        <label className="field">
          <span>{t('travel.hoursPerDay')}</span>
          <select value={hoursPerDay} onChange={(e) => setHoursPerDay(Number(e.target.value))}>
            {HOURS_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <div className="travel-field">
          <span className="muted small">{t('travel.estimate')}</span>
          <strong className="travel-value">{travelText}</strong>
        </div>
        <div className="travel-field">
          <span className="muted small">{t('travel.distance')}</span>
          <strong className="travel-value">{distanceText}</strong>
        </div>
        <div className="fog-actions">
          <button className="btn" onClick={() => adjustTravelDays(0.25)}>
            {t('players.quarterPlus')}
          </button>
          <button className="btn" onClick={() => adjustTravelDays(-0.25)}>
            {t('players.quarterMinus')}
          </button>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">{t('palette.fog')}</div>
        <div className="swatch-grid">
          {FOG_OPTIONS.map((f) => (
            <button
              key={f.state}
              className={'swatch' + (brushKind === 'fog' && fogBrush === f.state ? ' active' : '')}
              onClick={() => {
                setFogBrush(f.state)
                closeDrawer()
              }}
              title={t('fog.brushTitle', { label: t(f.key) })}
            >
              <span className="swatch-color" style={{ background: f.color }} />
              <span className="swatch-name">{t(f.key)}</span>
            </button>
          ))}
        </div>
        <div className="fog-actions">
          <button className="btn" onClick={revealAll}>
            {t('fog.revealAll')}
          </button>
          <button className="btn" onClick={hideAll}>
            {t('fog.hideAll')}
          </button>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">{t('players.title')}</div>
        <button
          className={'swatch full' + (brushKind === 'players' ? ' active' : '')}
          onClick={() => {
            setPlayerTool()
            closeDrawer()
          }}
          title={t('players.move.title')}
        >
          <span className="swatch-color" style={{ background: '#3a9bdc' }} />
          <span className="swatch-name">{t('players.move')}</span>
        </button>
        <div className="fog-actions">
          <button className="btn" onClick={undoPlayers} disabled={playerUndoCount === 0}>
            {t('players.undo')}
          </button>
        </div>
        <div className="fog-actions">
          <button
            className="btn"
            onClick={() => {
              if (window.confirm(t('players.confirmResetTravel'))) resetTravel()
            }}
          >
            {t('players.resetTravel')}
          </button>
        </div>
        <div className="fog-actions">
          <button
            className="btn danger"
            onClick={() => {
              if (window.confirm(t('players.confirmResetExploration'))) resetExploration()
            }}
          >
            {t('players.resetExploration')}
          </button>
        </div>
        <p className="muted small">
          {playerPos
            ? t('players.position', { q: playerPos.q, r: playerPos.r })
            : t('players.noPosition')}
        </p>
      </div>

      <Legend />
    </>
  )

  return renderSidebar(
    <>
      {nameHeader}
      {tool === 'brush' && brushSections}
      {tool === 'explore' && exploreSections}
      {tool === 'pan' && <Legend />}
    </>,
  )
}
