import { useMemo, useState } from 'react'
import { useMapStore } from '@/store/mapStore'
import { useT } from '@/i18n/useT'
import { connectsToRoad, shortestPath } from '@/hex/pathfind'
import { formatTravel } from '@/data/travel'
import { axialDistance } from '@/hex/coordinates'

export default function MovePlayersDialog() {
  const t = useT()
  const doc = useMapStore((s) => s.doc)
  const pending = useMapStore((s) => s.pendingPlayerMove)
  const cancel = useMapStore((s) => s.cancelPlayerMove)
  const confirm = useMapStore((s) => s.confirmPlayerMove)
  const hoursPerDay = doc?.hoursPerDay ?? 24
  const [manualHours, setManualHours] = useState(hoursPerDay)

  const sp = useMemo(() => {
    if (!doc?.playerPos || !pending) return null
    return shortestPath(doc, doc.playerPos, pending)
  }, [doc, pending])

  const viaRoad = useMemo(() => {
    if (!doc?.playerPos || !pending) return false
    return connectsToRoad(doc, doc.playerPos) && connectsToRoad(doc, pending)
  }, [doc, pending])

  if (!doc || !pending || !doc.playerPos) return null
  const dist = axialDistance(doc.playerPos, pending)

  return (
    <div className="dialog-backdrop" onMouseDown={cancel}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{t('move.title')}</h2>
        <p className="muted small">{t('move.intro', { dist })}</p>

        {sp ? (
          <p className="io-msg ok">
            {t('move.estimate')}{' '}
            <strong>{formatTravel(sp.days, hoursPerDay, t('unit.day'), t('unit.hour'))}</strong>
            {viaRoad && t('move.viaRoad')}
          </p>
        ) : (
          <p className="io-msg err">{t('move.noPath')}</p>
        )}

        <div className="manual-move">
          <span className="muted small">{t('move.manualLabel')}</span>
          <input
            type="number"
            min={0}
            value={manualHours}
            onChange={(e) => setManualHours(Math.max(0, Math.round(Number(e.target.value) || 0)))}
          />
          <button className="btn" onClick={() => confirm('manual', manualHours)}>
            {t('move.manualBtn', { h: manualHours })}
          </button>
        </div>

        <div className="dialog-actions move-actions">
          <button className="btn ghost" onClick={cancel}>
            {t('common.cancel')}
          </button>
          <button className="btn" onClick={() => confirm('noTravel')}>
            {t('move.noTravel')}
          </button>
          <button className="btn primary" onClick={() => confirm('shortest')} disabled={!sp}>
            {t('move.shortest')}
          </button>
        </div>
      </div>
    </div>
  )
}
