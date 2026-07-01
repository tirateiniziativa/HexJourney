import { OVERLAYS, TERRAINS, type TileDef } from '@/data/catalog'
import { formatTravel, terrainCrossingDays } from '@/data/travel'
import { useMapStore } from '@/store/mapStore'
import { useT } from '@/i18n/useT'
import CollapsibleSection from './CollapsibleSection'

const LAND_OVERLAYS = OVERLAYS.filter((o) => o.on === 'land' || o.on === 'both')
const WATER_OVERLAYS = OVERLAYS.filter((o) => o.on === 'water' || o.on === 'both')

/** Leggenda: tutte le caselle (col tempo di attraversamento per il mezzo/scala
 * correnti) e tutti gli overlay, raggruppati terra/acqua. */
export default function Legend() {
  const t = useT()
  const doc = useMapStore((s) => s.doc)
  const hoursPerDay = doc?.hoursPerDay ?? 24

  const timeFor = (terrain: string): string => {
    if (!doc) return ''
    const days = terrainCrossingDays(doc, terrain)
    if (!isFinite(days)) return t('legend.impassable')
    return formatTravel(days, hoursPerDay, t('unit.day'), t('unit.hour'), t('unit.minute'))
  }

  const overlayItem = (o: TileDef) => (
    <li key={o.id}>
      <span className="legend-color" style={{ background: o.color }} />
      <span className="legend-name">{t(`overlay.${o.id}`)}</span>
    </li>
  )

  return (
    <CollapsibleSection title={t('legend.title')}>
      <ul className="legend">
        {TERRAINS.map((td) => (
          <li key={td.id}>
            <span className="legend-color" style={{ background: td.color }} />
            <span className="legend-name">{t(`terrain.${td.id}`)}</span>
            <span className="legend-time">{timeFor(td.id)}</span>
          </li>
        ))}
      </ul>

      <div className="legend-sub">{t('legend.overlaysLand')}</div>
      <ul className="legend">{LAND_OVERLAYS.map(overlayItem)}</ul>

      <div className="legend-sub">{t('legend.overlaysWater')}</div>
      <ul className="legend">{WATER_OVERLAYS.map(overlayItem)}</ul>

      <p className="muted small">{t('legend.note')}</p>
    </CollapsibleSection>
  )
}
