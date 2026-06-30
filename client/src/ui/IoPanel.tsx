import { useRef, useState } from 'react'
import { useMapStore } from '@/store/mapStore'
import { useT } from '@/i18n/useT'
import { getRenderer } from '@/render/rendererRef'
import {
  downloadDataUrl,
  downloadText,
  exportCleanMap,
  exportExploration,
  exportFullMap,
  mapFileName,
  parseImport,
  readFileText,
} from '@/persistence/io'

type Msg = { kind: 'ok' | 'err'; text: string } | null

export default function IoPanel({ onClose }: { onClose: () => void }) {
  const t = useT()
  const doc = useMapStore((s) => s.doc)
  const loadDoc = useMapStore((s) => s.loadDoc)
  const applyExploration = useMapStore((s) => s.applyExploration)
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<Msg>(null)

  const exportFull = () => {
    if (!doc) return
    downloadText(mapFileName(doc, 'full'), exportFullMap(doc))
  }
  const exportClean = () => {
    if (!doc) return
    downloadText(mapFileName(doc, 'clean'), exportCleanMap(doc))
  }
  const exportExpl = () => {
    if (!doc) return
    downloadText(mapFileName(doc, 'exploration'), exportExploration(doc))
  }
  const exportPng = () => {
    if (!doc) return
    const url = getRenderer()?.exportPNG(2)
    if (url) downloadDataUrl(mapFileName(doc, 'image', 'png'), url)
    else setMsg({ kind: 'err', text: t('io.pngUnavailable') })
  }

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // consenti reimport dello stesso file
    if (!file) return
    try {
      const text = await readFileText(file)
      const result = parseImport(text)
      if (result.kind === 'map') {
        loadDoc(result.doc)
        setMsg({ kind: 'ok', text: t('io.mapImported', { name: result.doc.name }) })
      } else {
        if (!doc) {
          setMsg({ kind: 'err', text: t('io.needMapFirst') })
          return
        }
        if (result.exploration.mapId !== doc.id) {
          const ok = window.confirm(t('io.mapIdMismatch'))
          if (!ok) return
        }
        applyExploration(result.exploration)
        setMsg({ kind: 'ok', text: t('io.explApplied') })
      }
    } catch (err) {
      // parseImport lancia chiavi i18n; eventuali altri errori restano grezzi.
      setMsg({ kind: 'err', text: err instanceof Error ? t(err.message) : t('io.importFailed') })
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{t('io.title')}</h2>

        <div className="panel-title">{t('io.export')}</div>
        <div className="io-grid">
          <button className="btn" onClick={exportFull} disabled={!doc}>
            {t('io.exportFull')}
          </button>
          <button className="btn" onClick={exportClean} disabled={!doc}>
            {t('io.exportClean')}
          </button>
          <button className="btn" onClick={exportExpl} disabled={!doc}>
            {t('io.exportExpl')}
          </button>
          <button className="btn" onClick={exportPng} disabled={!doc}>
            {t('io.exportPng')}
          </button>
        </div>

        <div className="panel-title" style={{ marginTop: 18 }}>
          {t('io.import')}
        </div>
        <p className="muted small">{t('io.importHint')}</p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={onPickFile}
          style={{ display: 'none' }}
        />
        <button className="btn" onClick={() => fileRef.current?.click()}>
          {t('io.chooseFile')}
        </button>

        {msg && (
          <p className={msg.kind === 'ok' ? 'io-msg ok' : 'io-msg err'}>{msg.text}</p>
        )}

        <div className="dialog-actions">
          <button className="btn ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
