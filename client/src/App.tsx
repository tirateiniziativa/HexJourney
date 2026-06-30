import { useState } from 'react'
import HexCanvas from '@/render/HexCanvas'
import Toolbar from '@/ui/Toolbar'
import StatusBar from '@/ui/StatusBar'
import Palette from '@/ui/Palette'
import NewMapDialog from '@/ui/NewMapDialog'
import MapsPanel from '@/ui/MapsPanel'
import IoPanel from '@/ui/IoPanel'
import ResizeDialog from '@/ui/ResizeDialog'
import SessionPanel from '@/ui/SessionPanel'
import MovePlayersDialog from '@/ui/MovePlayersDialog'
import { useMapStore } from '@/store/mapStore'
import { useT } from '@/i18n/useT'
import { useAutosave } from '@/persistence/useAutosave'
import { useSyncSetup } from '@/sync/useSync'
import '@/ui/styles.css'

export default function App() {
  const t = useT()
  const doc = useMapStore((s) => s.doc)
  const [showNewMap, setShowNewMap] = useState(false)
  const [showMaps, setShowMaps] = useState(false)
  const [showIo, setShowIo] = useState(false)
  const [showResize, setShowResize] = useState(false)
  // Se l'URL contiene ?session=… (link giocatore) apri subito il pannello sessione.
  const [showSession, setShowSession] = useState(
    () => new URLSearchParams(window.location.search).has('session'),
  )

  useAutosave()
  useSyncSetup()

  return (
    <div className="app">
      <Toolbar
        onNewMap={() => setShowNewMap(true)}
        onOpenMaps={() => setShowMaps(true)}
        onOpenIo={() => setShowIo(true)}
        onResize={() => setShowResize(true)}
        onOpenSession={() => setShowSession(true)}
      />

      <div className="body">
        {doc && <Palette />}
        <div className="stage">
          <HexCanvas />
          {!doc && (
            <div className="empty-state">
              <div className="empty-card">
                <h1>⬡ HexJourney</h1>
                <p>{t('app.tagline')}</p>
                <button className="btn primary" onClick={() => setShowNewMap(true)}>
                  {t('app.createFirst')}
                </button>
                <p className="credit">
                  {t('app.createdBy')}{' '}
                  <a
                    className="social-link"
                    href="https://linktr.ee/TirateIniziativa"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    TirateIniziativa
                  </a>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <StatusBar />

      {showNewMap && <NewMapDialog onClose={() => setShowNewMap(false)} />}
      {showMaps && <MapsPanel onClose={() => setShowMaps(false)} />}
      {showIo && <IoPanel onClose={() => setShowIo(false)} />}
      {showResize && <ResizeDialog onClose={() => setShowResize(false)} />}
      {showSession && <SessionPanel onClose={() => setShowSession(false)} />}
      <MovePlayersDialog />
    </div>
  )
}
