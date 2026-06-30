import { useEffect, useState } from 'react'
import { useMapStore } from '@/store/mapStore'
import { useT } from '@/i18n/useT'
import { getSyncClient } from '@/sync/bridge'

/** Link da condividere coi giocatori: apre l'app già pronta a unirsi. */
function playerLink(sessionId: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}?session=${encodeURIComponent(sessionId)}&role=player`
}

export default function SessionPanel({ onClose }: { onClose: () => void }) {
  const t = useT()
  const doc = useMapStore((s) => s.doc)
  const sessionId = useMapStore((s) => s.sessionId)
  const sessionRole = useMapStore((s) => s.sessionRole)
  const status = useMapStore((s) => s.sessionStatus)
  const players = useMapStore((s) => s.sessionPlayers)
  const error = useMapStore((s) => s.sessionError)
  const clearSession = useMapStore((s) => s.clearSession)
  const [joinCode, setJoinCode] = useState('')
  const [copied, setCopied] = useState(false)

  // Precompila il codice dalla query string (link giocatore: ?session=…&role=player).
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('session')
    if (code) setJoinCode(code.toUpperCase())
  }, [])

  const inSession = !!sessionId && status !== 'idle'
  const gmCount = players.filter((p) => p.role === 'gm').length
  const playerCount = players.filter((p) => p.role === 'player').length

  const createSession = () => {
    if (doc) getSyncClient()?.createSession(doc)
  }
  const joinSession = () => {
    const code = joinCode.trim().toUpperCase()
    if (code) getSyncClient()?.joinSession(code, 'player')
  }
  const leave = () => {
    getSyncClient()?.disconnect()
    clearSession()
  }
  const copyCode = () => {
    if (sessionId) navigator.clipboard?.writeText(sessionId).catch(() => {})
  }
  const copyLink = () => {
    if (!sessionId) return
    navigator.clipboard
      ?.writeText(playerLink(sessionId))
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{t('session.title')}</h2>

        <p className="session-status">
          {t('session.status')} <span className={`dot ${status}`} />{' '}
          {t(`session.status.${status}`)}
          {sessionRole && (
            <>
              {' '}
              · {t('session.role')}{' '}
              <strong>{sessionRole === 'gm' ? t('role.dm') : t('role.player')}</strong>
            </>
          )}
        </p>

        {inSession ? (
          <>
            <div className="session-code">
              <span className="muted small">{t('session.code')}</span>
              <div className="code-row">
                <code>{sessionId}</code>
                <button className="btn" onClick={copyCode}>
                  {t('session.copy')}
                </button>
                {sessionRole === 'gm' && (
                  <button className="btn" onClick={copyLink}>
                    {copied ? t('session.linkCopied') : t('session.copyPlayerLink')}
                  </button>
                )}
              </div>
            </div>
            <p className="muted small">
              {t('session.present', { gm: gmCount, players: playerCount })}
            </p>
            <div className="dialog-actions">
              <button className="btn danger" onClick={leave}>
                {t('session.leave')}
              </button>
              <button className="btn ghost" onClick={onClose}>
                {t('common.close')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="panel-title">{t('session.imDm')}</div>
            <p className="muted small">{t('session.imDm.hint')}</p>
            <button className="btn primary" onClick={createSession} disabled={!doc}>
              {t('session.create')}
            </button>

            <div className="panel-title" style={{ marginTop: 18 }}>
              {t('session.imPlayer')}
            </div>
            <div className="code-row">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder={t('session.codePlaceholder')}
                maxLength={8}
              />
              <button className="btn" onClick={joinSession} disabled={!joinCode.trim()}>
                {t('session.join')}
              </button>
            </div>

            {error && <p className="io-msg err">{error}</p>}

            <div className="dialog-actions">
              <button className="btn ghost" onClick={onClose}>
                {t('common.close')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
