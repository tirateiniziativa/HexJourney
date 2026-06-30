import { useState } from 'react'
import {
  MAX_DIM,
  MIN_DIM,
  useMapStore,
  type NewMapOptions,
} from '@/store/mapStore'
import { useT } from '@/i18n/useT'
import { TERRAINS } from '@/data/catalog'
import type { MapShape, Orientation } from '@/model/types'

export default function NewMapDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const createMap = useMapStore((s) => s.createMap)
  const [name, setName] = useState(t('newMap.defaultName'))
  const [width, setWidth] = useState(20)
  const [height, setHeight] = useState(15)
  const [orientation, setOrientation] = useState<Orientation>('pointy')
  const [shape, setShape] = useState<MapShape>('rectangular')
  // Default: nuova mappa interamente ad acqua (l'utente può cambiare il terreno di base).
  const [baseTerrain, setBaseTerrain] = useState('water')
  const [playersAtCenter, setPlayersAtCenter] = useState(true)

  const clampDim = (v: number) => Math.max(MIN_DIM, Math.min(MAX_DIM, Math.round(v || 0)))
  const valid =
    width >= MIN_DIM && width <= MAX_DIM && height >= MIN_DIM && height <= MAX_DIM

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    const opts: NewMapOptions = {
      name,
      width,
      height,
      orientation,
      shape,
      playersAtCenter,
      baseTerrain,
    }
    createMap(opts)
    onClose()
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form className="dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{t('newMap.title')}</h2>

        <label className="field">
          <span>{t('newMap.name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>

        <div className="field-row">
          <label className="field">
            <span>{t('newMap.width')}</span>
            <input
              type="number"
              min={MIN_DIM}
              max={MAX_DIM}
              value={width}
              onChange={(e) => setWidth(clampDim(Number(e.target.value)))}
            />
          </label>
          <label className="field">
            <span>{t('newMap.height')}</span>
            <input
              type="number"
              min={MIN_DIM}
              max={MAX_DIM}
              value={height}
              onChange={(e) => setHeight(clampDim(Number(e.target.value)))}
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>{t('newMap.orientation')}</span>
            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as Orientation)}
            >
              <option value="pointy">{t('newMap.pointy')}</option>
              <option value="flat">{t('newMap.flat')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('newMap.shape')}</span>
            <select value={shape} onChange={(e) => setShape(e.target.value as MapShape)}>
              <option value="rectangular">{t('newMap.rectangular')}</option>
              <option value="hexagonal">{t('newMap.hexagonal')}</option>
            </select>
          </label>
        </div>

        <label className="field">
          <span>{t('newMap.baseTerrain')}</span>
          <select value={baseTerrain} onChange={(e) => setBaseTerrain(e.target.value)}>
            <option value="">{t('newMap.baseEmpty')}</option>
            {TERRAINS.map((td) => (
              <option key={td.id} value={td.id}>
                {t(`terrain.${td.id}`)}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{t('newMap.baseTerrainHint')}</p>

        <label className="check-row">
          <input
            type="checkbox"
            checked={playersAtCenter}
            onChange={(e) => setPlayersAtCenter(e.target.checked)}
          />
          <span>{t('newMap.playersAtCenter')}</span>
        </label>

        <p className="hint">
          {t('newMap.dimHint', { min: MIN_DIM, max: MAX_DIM })}
          {shape === 'hexagonal' && t('newMap.hexagonalHint')}
        </p>

        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            {t('newMap.create')}
          </button>
        </div>
      </form>
    </div>
  )
}
