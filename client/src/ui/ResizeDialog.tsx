import { useState } from 'react'
import { MAX_DIM, MIN_DIM, useMapStore } from '@/store/mapStore'
import { useT } from '@/i18n/useT'
import { mapCoords } from '@/hex/layout'
import { keyOf } from '@/model/types'

export default function ResizeDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const doc = useMapStore((s) => s.doc)
  const resizeMap = useMapStore((s) => s.resizeMap)
  const [width, setWidth] = useState(doc?.width ?? 20)
  const [height, setHeight] = useState(doc?.height ?? 15)

  if (!doc) return null

  const clampDim = (v: number) => Math.max(MIN_DIM, Math.min(MAX_DIM, Math.round(v || 0)))
  const valid =
    width >= MIN_DIM && width <= MAX_DIM && height >= MIN_DIM && height <= MAX_DIM

  // quanti tasselli esistenti finirebbero fuori dai nuovi limiti
  const droppedCount = (() => {
    if (!valid) return 0
    const validKeys = new Set(mapCoords({ ...doc, width, height }).map((c) => keyOf(c.q, c.r)))
    let n = 0
    for (const key of Object.keys(doc.tiles)) if (!validKeys.has(key)) n++
    return n
  })()

  const apply = () => {
    if (!valid) return
    if (droppedCount > 0) {
      const ok = window.confirm(t('resize.confirmShrink', { n: droppedCount }))
      if (!ok) return
    }
    resizeMap(width, height)
    onClose()
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{t('resize.title')}</h2>
        <p className="muted small">{t('resize.current', { w: doc.width, h: doc.height })}</p>

        <div className="field-row">
          <label className="field">
            <span>{t('resize.width')}</span>
            <input
              type="number"
              min={MIN_DIM}
              max={MAX_DIM}
              value={width}
              onChange={(e) => setWidth(clampDim(Number(e.target.value)))}
            />
          </label>
          <label className="field">
            <span>{t('resize.height')}</span>
            <input
              type="number"
              min={MIN_DIM}
              max={MAX_DIM}
              value={height}
              onChange={(e) => setHeight(clampDim(Number(e.target.value)))}
            />
          </label>
        </div>

        {droppedCount > 0 && (
          <p className="io-msg err">{t('resize.dropWarn', { n: droppedCount })}</p>
        )}

        <div className="dialog-actions">
          <button className="btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={apply} disabled={!valid}>
            {t('common.apply')}
          </button>
        </div>
      </div>
    </div>
  )
}
