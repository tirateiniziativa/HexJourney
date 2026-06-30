import { OVERLAYS, TERRAINS, getTileDef, type TileDef } from '@/data/catalog'
import { DEFAULT_SCALE, SCALES, VEHICLES, formatDistance, formatTravel, scaleOf } from '@/data/travel'
import { useMapStore, type EffectKind } from '@/store/mapStore'
import { useT } from '@/i18n/useT'
import type { FogState, MapScale, Vehicle } from '@/model/types'
import Legend from './Legend'

const HOURS_OPTIONS = Array.from({ length: 30 - 6 + 1 }, (_, i) => i + 6) // 6..30

const FOG_OPTIONS: { state: FogState; key: string; color: string }[] = [
  { state: 'visible', key: 'fog.visible', color: '#4caf50' },
  { state: 'explored', key: 'fog.explored', color: '#caa53b' },
  { state: 'hidden', key: 'fog.hidden', color: '#2b2e3b' },
]

const LAND_OVERLAYS = OVERLAYS.filter((o) => o.on === 'land' || o.on === 'both')
const WATER_OVERLAYS = OVERLAYS.filter((o) => o.on === 'water' || o.on === 'both')

export default function Palette() {
  const t = useT()
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
    return (
      <aside className="sidebar">
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
      </aside>
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
          onClick={() => setEffectTool(eff)}
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
        onClick={() => setSelectedOverlay(o.id)}
        title={t(`overlay.${o.id}`)}
      >
        <span className="swatch-color" style={{ background: o.color }} />
        <span className="swatch-name">{t(`overlay.${o.id}`)}</span>
      </button>
    )
  }

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
              onClick={() => setSelectedTerrain(td.id)}
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
          <button
            className={'swatch' + (overlayActive('') ? ' active' : '')}
            onClick={() => setSelectedOverlay('')}
            title={t('palette.remove.title')}
          >
            <span className="swatch-color swatch-erase">✕</span>
            <span className="swatch-name">{t('palette.remove')}</span>
          </button>
        </div>

        {brushKind === 'overlay' &&
          selectedOverlay &&
          getTileDef(selectedOverlay)?.shape === 'line' && (
            <p className="muted small anchor-hint">{t('palette.anchorHint')}</p>
          )}
      </div>

      <div className="panel-section">
        <div className="panel-title">{t('legend.overlaysWater')}</div>
        <div className="swatch-grid">{WATER_OVERLAYS.map(overlaySwatch)}</div>
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
              onClick={() => setFogBrush(f.state)}
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
          onClick={setPlayerTool}
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

  return (
    <aside className="sidebar">
      {nameHeader}
      {tool === 'brush' && brushSections}
      {tool === 'explore' && exploreSections}
      {tool === 'pan' && <Legend />}
    </aside>
  )
}
