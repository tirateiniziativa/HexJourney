import { useState } from 'react'
import { useMapStore } from '@/store/mapStore'
import { saveMap } from '@/persistence/db'
import { useT } from '@/i18n/useT'
import { LANGS, type Lang } from '@/i18n'
import type { DistanceUnit } from '@/store/mapStore'

export default function Toolbar({
  onNewMap,
  onOpenMaps,
  onOpenIo,
  onResize,
  onOpenSession,
}: {
  onNewMap: () => void
  onOpenMaps: () => void
  onOpenIo: () => void
  onResize: () => void
  onOpenSession: () => void
}) {
  const t = useT()
  const mode = useMapStore((s) => s.mode)
  const setMode = useMapStore((s) => s.setMode)
  const tool = useMapStore((s) => s.tool)
  const setTool = useMapStore((s) => s.setTool)
  const doc = useMapStore((s) => s.doc)
  const sessionStatus = useMapStore((s) => s.sessionStatus)
  const sessionRole = useMapStore((s) => s.sessionRole)
  const lang = useMapStore((s) => s.lang)
  const setLang = useMapStore((s) => s.setLang)
  const distanceUnit = useMapStore((s) => s.distanceUnit)
  const setDistanceUnit = useMapStore((s) => s.setDistanceUnit)
  const [saved, setSaved] = useState(false)

  const isPlayerSession = sessionRole === 'player'

  const onSave = async () => {
    if (!doc) return
    await saveMap(doc)
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <span className="brand">⬡ HexJourney</span>
        <a
          className="social-link toolbar-social"
          href="https://linktr.ee/TirateIniziativa"
          target="_blank"
          rel="noopener noreferrer"
          title={t('social.follow')}
        >
          🔗 TirateIniziativa
        </a>
      </div>

      <div className="toolbar-group">
        <button className="btn" onClick={onNewMap}>
          {t('toolbar.newMap')}
        </button>
        <button className="btn" onClick={onOpenMaps}>
          {t('toolbar.maps')}
        </button>
        <button className="btn" onClick={onSave} disabled={!doc}>
          {saved ? t('toolbar.saved') : t('toolbar.save')}
        </button>
        <button className="btn" onClick={onOpenIo} disabled={!doc}>
          {t('toolbar.io')}
        </button>
        <button className="btn" onClick={onResize} disabled={!doc || isPlayerSession}>
          {t('toolbar.resize')}
        </button>
        <button className="btn" onClick={onOpenSession}>
          <span className={`dot ${sessionStatus}`} /> {t('toolbar.session')}
        </button>
      </div>

      {mode === 'gm' && (
        <div className="toolbar-group">
          <div className="mode-toggle" role="group" aria-label={t('toolbar.mode')}>
            <button
              className={tool === 'brush' ? 'seg active' : 'seg'}
              onClick={() => setTool('brush')}
              disabled={!doc}
              title={t('tool.brush.title')}
            >
              {t('tool.brush')}
            </button>
            <button
              className={tool === 'explore' ? 'seg active' : 'seg'}
              onClick={() => setTool('explore')}
              disabled={!doc}
              title={t('tool.explore.title')}
            >
              {t('tool.explore')}
            </button>
            <button
              className={tool === 'pan' ? 'seg active' : 'seg'}
              onClick={() => setTool('pan')}
              disabled={!doc}
              title={t('tool.pan.title')}
            >
              {t('tool.pan')}
            </button>
          </div>
        </div>
      )}

      <div className="toolbar-spacer" />

      <div className="toolbar-group">
        <select
          className="lang-select"
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          aria-label="Language"
          title="Language"
        >
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <select
          className="lang-select"
          value={distanceUnit}
          onChange={(e) => setDistanceUnit(e.target.value as DistanceUnit)}
          aria-label={t('travel.distanceUnit')}
          title={t('travel.distanceUnit')}
        >
          <option value="km">{t('unit.km')}</option>
          <option value="mi">{t('unit.mi')}</option>
        </select>
      </div>

      <div className="toolbar-group">
        <span className="muted small">{t('toolbar.mode')}</span>
        <div className="mode-toggle" role="group" aria-label={t('toolbar.mode')}>
          <button
            className={mode === 'gm' ? 'seg active' : 'seg'}
            onClick={() => setMode('gm')}
            disabled={!doc || isPlayerSession}
            title={isPlayerSession ? t('palette.player.readonly') : undefined}
          >
            {t('role.dm')}
          </button>
          <button
            className={mode === 'player' ? 'seg active' : 'seg'}
            onClick={() => setMode('player')}
            disabled={!doc || isPlayerSession}
          >
            {t('role.player')}
          </button>
        </div>
      </div>
    </header>
  )
}
