import { useEffect, useState } from 'react'
import {
  deleteMap,
  duplicateMap,
  listMaps,
  loadMap,
  saveMap,
  type StoredMap,
} from '@/persistence/db'
import { useMapStore } from '@/store/mapStore'
import { useT } from '@/i18n/useT'
import { PRESET_MAPS, type PresetMap } from '@/data/presets'

export default function MapsPanel({ onClose }: { onClose: () => void }) {
  const t = useT()
  const doc = useMapStore((s) => s.doc)
  const lang = useMapStore((s) => s.lang)
  const loadDoc = useMapStore((s) => s.loadDoc)
  const [maps, setMaps] = useState<StoredMap[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = () => listMaps().then(setMaps)
  useEffect(() => {
    refresh()
  }, [])

  const onLoad = async (id: string) => {
    const d = await loadMap(id)
    if (d) {
      loadDoc(d)
      onClose()
    }
  }
  /** Carica un preset (mappa predefinita, disponibile a tutti) come copia di lavoro. */
  const onLoadPreset = async (p: PresetMap) => {
    setBusy(true)
    try {
      const d = await p.load()
      loadDoc(d)
      onClose()
    } catch {
      setBusy(false)
    }
  }
  const onDuplicate = async (id: string) => {
    setBusy(true)
    await duplicateMap(id, t('maps.copySuffix'))
    await refresh()
    setBusy(false)
  }
  const onDelete = async (id: string) => {
    if (!window.confirm(t('maps.confirmDelete'))) return
    setBusy(true)
    await deleteMap(id)
    await refresh()
    setBusy(false)
  }
  const onSaveCurrent = async () => {
    if (!doc) return
    setBusy(true)
    await saveMap(doc)
    await refresh()
    setBusy(false)
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{t('maps.heading')}</h2>

        {PRESET_MAPS.length > 0 && (
          <>
            <div className="panel-title">{t('maps.presets')}</div>
            <ul className="map-list">
              {PRESET_MAPS.map((p) => (
                <li key={`preset:${p.key}`} className="map-row">
                  <div className="map-info">
                    <strong>{p.name}</strong>
                    <span className="muted small">{t('maps.presetHint')}</span>
                  </div>
                  <div className="map-actions">
                    <button className="btn" onClick={() => onLoadPreset(p)} disabled={busy}>
                      {t('common.load')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="panel-title">{t('maps.title')}</div>
        <ul className="map-list">
          {maps.length === 0 && <li className="muted">{t('maps.empty')}</li>}
          {maps.map((m) => (
            <li key={m.id} className={m.id === doc?.id ? 'map-row current' : 'map-row'}>
              <div className="map-info">
                <strong>{m.name}</strong>
                <span className="muted small">
                  {m.doc.width}×{m.doc.height} hex · {m.doc.orientation} ·{' '}
                  {new Date(m.updatedAt).toLocaleString(lang)}
                </span>
              </div>
              <div className="map-actions">
                <button className="btn" onClick={() => onLoad(m.id)} disabled={busy}>
                  {t('common.load')}
                </button>
                <button className="btn" onClick={() => onDuplicate(m.id)} disabled={busy}>
                  {t('common.duplicate')}
                </button>
                <button className="btn danger" onClick={() => onDelete(m.id)} disabled={busy}>
                  {t('common.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="dialog-actions">
          <button className="btn primary" onClick={onSaveCurrent} disabled={!doc || busy}>
            {t('maps.saveCurrent')}
          </button>
          <button className="btn ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
