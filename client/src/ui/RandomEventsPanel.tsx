import { useState } from 'react'
import { useMapStore } from '@/store/mapStore'
import { useT } from '@/i18n/useT'
import { RANDOM_EVENT_TYPES, ensureRandomEventsState, keyOf, type RandomEventType } from '@/model/types'
import { isNegativeEvent, isPositiveEvent } from '@/data/randomEvents'
import CollapsibleSection from './CollapsibleSection'

/** Classe di colore per polarità dell'evento. */
function polarityClass(e: RandomEventType): string {
  if (isPositiveEvent(e)) return 'ev-pos'
  if (isNegativeEvent(e)) return 'ev-neg'
  return 'ev-none'
}

/** Sezione "Eventi Casuali" del tab Esplorazione. Il DM può attivarli,
 * generare/gestire la proposta e vedere probabilità/motivi; i giocatori vedono
 * SOLO l'ultimo evento confermato (mai la proposta pending). */
export default function RandomEventsPanel({ readOnly = false }: { readOnly?: boolean }) {
  const t = useT()
  const doc = useMapStore((s) => s.doc)
  const setEnabled = useMapStore((s) => s.setRandomEventsEnabled)
  const rollNow = useMapStore((s) => s.rollRandomEventNow)
  const confirm = useMapStore((s) => s.confirmRandomEvent)
  const discard = useMapStore((s) => s.discardRandomEvent)
  const replace = useMapStore((s) => s.replaceRandomEvent)
  const setManual = useMapStore((s) => s.setRandomEventManual)
  const pending = useMapStore((s) => s.pendingRandomEvent)
  const roll = useMapStore((s) => s.randomEventRoll)
  const [chosen, setChosen] = useState<RandomEventType>('positive')

  if (!doc) return null
  const state = ensureRandomEventsState(doc.randomEvents)

  const lastEl = state.lastConfirmedEvent ? (
    <strong className={`event-badge ${polarityClass(state.lastConfirmedEvent)}`}>
      {t(`randomEvent.${state.lastConfirmedEvent}`)}
    </strong>
  ) : (
    <strong className="muted">—</strong>
  )
  const lastConfirmedLine = (
    <div className="travel-field">
      <span className="muted small">{t('randomEvents.lastConfirmed')}</span>
      {lastEl}
    </div>
  )

  // Vista giocatore: stato attivo/inattivo + SOLO l'evento della casella attuale
  // (se confermato/scelto dal DM proprio su quella casella).
  const currentKey = doc.playerPos ? keyOf(doc.playerPos.q, doc.playerPos.r) : null
  const tileEvent =
    state.enabled && state.lastConfirmedEvent && state.lastConfirmedTile && state.lastConfirmedTile === currentKey
      ? state.lastConfirmedEvent
      : null
  const statusLine = (
    <div className="travel-field">
      <span className="muted small">{t('randomEvents.status')}</span>
      <strong className={state.enabled ? undefined : 'muted'}>
        {state.enabled ? t('randomEvents.statusActive') : t('randomEvents.statusInactive')}
      </strong>
    </div>
  )
  const tileLine = (
    <div className="travel-field">
      <span className="muted small">{t('randomEvents.currentTile')}</span>
      {tileEvent ? (
        <strong className={`event-badge ${polarityClass(tileEvent)}`}>{t(`randomEvent.${tileEvent}`)}</strong>
      ) : (
        <strong className="muted">{t('randomEvent.none')}</strong>
      )}
    </div>
  )

  return (
    <CollapsibleSection
      title={t('randomEvents.title')}
      summary={readOnly ? (state.enabled ? tileLine : statusLine) : lastConfirmedLine}
    >
      {readOnly ? (
        <>
          {statusLine}
          {state.enabled && tileLine}
          <p className="muted small">{t('randomEvents.readonly')}</p>
        </>
      ) : (
        <>
          <label className="check-row">
            <input type="checkbox" checked={state.enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>{t('randomEvents.enabled')}</span>
          </label>

          {state.enabled ? (
            <>
              <div className="fog-actions">
                <button className="btn" onClick={rollNow}>
                  {t('randomEvents.generate')}
                </button>
              </div>

              {/* Inserimento manuale: scegli il tipo e applicalo come evento avvenuto */}
              <div className="manual-move">
                <select value={chosen} onChange={(e) => setChosen(e.target.value as RandomEventType)}>
                  {RANDOM_EVENT_TYPES.map((e) => (
                    <option key={e} value={e}>
                      {t(`randomEvent.${e}`)}
                    </option>
                  ))}
                </select>
                <button className="btn" onClick={() => setManual(chosen)}>
                  {t('randomEvents.setManual')}
                </button>
              </div>

              {/* Proposta in attesa: SOLO il DM la vede (mai sincronizzata ai player) */}
              {pending && (
                <div className="event-proposed">
                  <div className="legend-sub">{t('randomEvents.proposed')}</div>
                  <div className="travel-field">
                    <span className="muted small">{t('randomEvents.proposedEvent')}</span>
                    <strong className={`event-badge ${polarityClass(pending.proposedEvent)}`}>
                      {t(`randomEvent.${pending.proposedEvent}`)}
                    </strong>
                  </div>
                  <div className="fog-actions">
                    <button className="btn primary" onClick={confirm}>
                      {t('randomEvents.confirm')}
                    </button>
                    <button className="btn danger" onClick={discard}>
                      {t('randomEvents.discard')}
                    </button>
                  </div>
                  <div className="manual-move">
                    <select value={chosen} onChange={(e) => setChosen(e.target.value as RandomEventType)}>
                      {RANDOM_EVENT_TYPES.map((e) => (
                        <option key={e} value={e}>
                          {t(`randomEvent.${e}`)}
                        </option>
                      ))}
                    </select>
                    <button className="btn" onClick={() => replace(chosen)}>
                      {t('randomEvents.chooseOther')}
                    </button>
                  </div>
                </div>
              )}

              {/* Probabilità correnti + motivi */}
              {roll && (
                <>
                  <div className="legend-sub">{t('randomEvents.probabilities')}</div>
                  <ul className="weather-probs">
                    {roll.probabilities
                      .filter((p) => p.weight > 0)
                      .sort((a, b) => b.probability - a.probability)
                      .map((p) => {
                        const pct = Math.round(p.probability * 100)
                        return (
                          <li key={p.event}>
                            <span className="wp-name">{t(`randomEvent.${p.event}`)}</span>
                            <span className="wp-bar">
                              <span style={{ width: `${pct}%` }} />
                            </span>
                            <span className="wp-pct mono">{pct}%</span>
                          </li>
                        )
                      })}
                  </ul>
                  <p className="muted small">
                    {t('randomEvents.reasons')}:{' '}
                    {roll.reasonSummary.length
                      ? roll.reasonSummary.map((r) => t(r)).join(' · ')
                      : t('randomEvents.reasonsNone')}
                  </p>
                </>
              )}

              {lastConfirmedLine}
            </>
          ) : (
            <p className="muted small">{t('randomEvents.disabledHint')}</p>
          )}
        </>
      )}
    </CollapsibleSection>
  )
}
