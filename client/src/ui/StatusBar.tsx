import { useMapStore } from '@/store/mapStore'
import { useT } from '@/i18n/useT'

export default function StatusBar() {
  const t = useT()
  const doc = useMapStore((s) => s.doc)
  const hovered = useMapStore((s) => s.hovered)
  const mode = useMapStore((s) => s.mode)

  return (
    <footer className="statusbar">
      {doc ? (
        <>
          <span className="status-item">
            <strong>{doc.name}</strong>
          </span>
          <span className="status-item">
            {doc.width}×{doc.height} hex ·{' '}
            {doc.shape === 'hexagonal' ? t('shape.hexagonal') : t('shape.rectangular')} ·{' '}
            {doc.orientation === 'pointy' ? t('orient.pointy') : t('orient.flat')}
          </span>
          <span className="status-item">
            {t('status.mode', { mode: mode === 'gm' ? t('role.dm') : t('role.player') })}
          </span>
          <span className="status-spacer" />
          <span className="status-item mono">
            {hovered ? t('status.hex', { q: hovered.q, r: hovered.r }) : t('status.hexNone')}
          </span>
        </>
      ) : (
        <span className="status-item">{t('status.noMap')}</span>
      )}
    </footer>
  )
}
