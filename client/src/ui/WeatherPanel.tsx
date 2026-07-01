import { useMapStore } from '@/store/mapStore'
import { useT } from '@/i18n/useT'
import { SEASONS, WEATHER_TYPES, ensureWeatherState, keyOf, type Season, type WeatherType } from '@/model/types'
import { computeTravel, formatTravel, type TravelTimeModifier } from '@/data/travel'
import CollapsibleSection from './CollapsibleSection'

type Translate = ReturnType<typeof useT>

/** Etichetta leggibile di un modificatore, componendo le chiavi i18n esistenti
 * (terreni/overlay/meteo) così da non duplicare stringhe. */
function modifierLabel(t: Translate, m: TravelTimeModifier): string {
  switch (m.source) {
    case 'overlay':
      return t(`overlay.${m.id}`)
    case 'weather':
      return t(`weather.${m.id}`)
    case 'weatherTerrain': {
      const [w, right] = m.id.split('+')
      const rightLabel = right === 'volcanic' ? t('overlay.volcanic') : t(`terrain.${right}`)
      return `${t(`weather.${w}`)} + ${rightLabel}`
    }
    case 'terrain':
      return t(`terrain.${m.id}`)
    default:
      return m.id
  }
}

/** Pannello meteo del tab Esplorazione. In modalità DM permette di scegliere
 * stagione/meteo, avanzare il giorno e vedere la previsione + gli effetti sul
 * viaggio; per i giocatori è di sola lettura. */
export default function WeatherPanel({ readOnly = false }: { readOnly?: boolean }) {
  const t = useT()
  const doc = useMapStore((s) => s.doc)
  const setSeason = useMapStore((s) => s.setSeason)
  const setWeatherManual = useMapStore((s) => s.setWeatherManual)
  const advanceDay = useMapStore((s) => s.advanceDay)
  const weatherRoll = useMapStore((s) => s.weatherRoll)
  const hoursPerDay = doc?.hoursPerDay ?? 24

  if (!doc) return null
  const weather = ensureWeatherState(doc.weather)

  // Effetti sul viaggio dell'hex corrente (posizione del gruppo).
  const key = doc.playerPos ? keyOf(doc.playerPos.q, doc.playerPos.r) : null
  const travel = key ? computeTravel(doc, key) : null
  const fmt = (days: number) =>
    formatTravel(days, hoursPerDay, t('unit.day'), t('unit.hour'), t('unit.minute'))

  // Da compresso il pannello meteo mostra solo il meteo attuale.
  const currentSummary = (
    <div className="travel-field">
      <span className="muted small">{t('weather.current')}</span>
      <strong>{t(`weather.${weather.current}`)}</strong>
    </div>
  )

  return (
    <CollapsibleSection title={t('weather.title')} summary={currentSummary} className="weather-panel">
      {readOnly ? (
        <>
          <div className="travel-field">
            <span className="muted small">{t('weather.season')}</span>
            <strong>{t(`season.${weather.season}`)}</strong>
          </div>
          <div className="travel-field">
            <span className="muted small">{t('weather.current')}</span>
            <strong>{t(`weather.${weather.current}`)}</strong>
          </div>
        </>
      ) : (
        <>
          <label className="field">
            <span>{t('weather.season')}</span>
            <select value={weather.season} onChange={(e) => setSeason(e.target.value as Season)}>
              {SEASONS.map((s) => (
                <option key={s} value={s}>
                  {t(`season.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('weather.current')}</span>
            <select
              value={weather.current}
              onChange={(e) => setWeatherManual(e.target.value as WeatherType)}
              title={t('weather.manualHint')}
            >
              {WEATHER_TYPES.map((w) => (
                <option key={w} value={w}>
                  {t(`weather.${w}`)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <div className="travel-field">
        <span className="muted small">{t('weather.consecutiveDays', { n: weather.consecutiveDays })}</span>
      </div>

      {!readOnly && (
        <div className="fog-actions">
          <button className="btn" onClick={advanceDay} disabled={!doc.playerPos && !key}>
            {t('weather.advanceDay')}
          </button>
        </div>
      )}

      {!readOnly && (
        <>
          <div className="legend-sub">{t('weather.nextProbabilities')}</div>
          {weatherRoll ? (
            <>
              <ul className="weather-probs">
                {weatherRoll.probabilities.slice(0, 6).map((p) => {
                  const pct = Math.round(p.probability * 100)
                  return (
                    <li key={p.weather}>
                      <span className="wp-name">{t(`weather.${p.weather}`)}</span>
                      <span className="wp-bar">
                        <span style={{ width: `${pct}%` }} />
                      </span>
                      <span className="wp-pct mono">{pct}%</span>
                    </li>
                  )
                })}
              </ul>
              <p className="muted small">
                {t('weather.reasons')}: {weatherRoll.reasonSummary.map((r) => t(r)).join(' · ')}
              </p>
            </>
          ) : (
            <p className="muted small">{t('weather.noRoll')}</p>
          )}
        </>
      )}

      {travel && (
        <>
          <div className="legend-sub">{t('weather.travelEffects')}</div>
          {/* Tempo di viaggio accumulato: mostrato sempre, anche se l'hex è bloccato. */}
          <div className="travel-field">
            <span className="muted small">{t('travel.estimate')}</span>
            <strong className="travel-value">
              {doc.travelDays == null ? 'N/D' : fmt(doc.travelDays)}
            </strong>
          </div>
          <ul className="travel-breakdown">
            <li>
              <span>{t('weather.baseTime')}</span>
              <span className="mono">{isFinite(travel.baseDays) ? fmt(travel.baseDays) : '—'}</span>
            </li>
            {travel.modifiers
              .filter((m) => m.multiplier != null)
              .map((m, i) => (
                <li key={`${m.id}-${i}`}>
                  <span>
                    {modifierLabel(t, m)}
                    {m.capped ? ` (${t('weather.capped')})` : ''}
                  </span>
                  <span className="mono">×{m.multiplier!.toFixed(2)}</span>
                </li>
              ))}
            <li className="tb-total">
              <span>{t('weather.total')}</span>
              <span className="mono">{travel.blocked ? t('weather.blocked') : fmt(travel.finalDays)}</span>
            </li>
          </ul>
          {travel.warnings.map((w) => (
            <p key={w} className="muted small">
              {t(w)}
            </p>
          ))}
        </>
      )}

      {readOnly && <p className="muted small">{t('weather.readonly')}</p>}
    </CollapsibleSection>
  )
}
