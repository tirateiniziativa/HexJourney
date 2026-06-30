import { useEffect, useState } from 'react'
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
import { useDevice } from '@/ui/useDevice'
import { useAutosave } from '@/persistence/useAutosave'
import { useSyncSetup } from '@/sync/useSync'
import '@/ui/styles.css'

export default function App() {
  const t = useT()
  const doc = useMapStore((s) => s.doc)
  const device = useDevice()
  const [showNewMap, setShowNewMap] = useState(false)
  const [showMaps, setShowMaps] = useState(false)
  const [showIo, setShowIo] = useState(false)
  const [showResize, setShowResize] = useState(false)
  // Su mobile la palette è un cassetto a scomparsa; su desktop/tablet è in linea.
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Se l'URL contiene ?session=… (link giocatore) apri subito il pannello sessione.
  const [showSession, setShowSession] = useState(
    () => new URLSearchParams(window.location.search).has('session'),
  )

  useAutosave()
  useSyncSetup()

  // Uscendo dal profilo mobile, chiudi il cassetto per non lasciare il backdrop.
  useEffect(() => {
    if (device !== 'mobile') setPaletteOpen(false)
  }, [device])

  return (
    <div className={`app device-${device}`}>
      <Toolbar
        onNewMap={() => setShowNewMap(true)}
        onOpenMaps={() => setShowMaps(true)}
        onOpenIo={() => setShowIo(true)}
        onResize={() => setShowResize(true)}
        onOpenSession={() => setShowSession(true)}
        showPaletteToggle={device === 'mobile' && !!doc}
        onTogglePalette={() => setPaletteOpen((o) => !o)}
      />

      <div className="body">
        {doc && (
          <Palette
            device={device}
            drawerOpen={paletteOpen}
            onCloseDrawer={() => setPaletteOpen(false)}
          />
        )}
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
                <div className="empty-actions">
                  <button className="btn" onClick={() => setShowMaps(true)}>
                    {t('app.loadMap')}
                  </button>
                  <button className="btn" onClick={() => setShowIo(true)}>
                    {t('app.importMap')}
                  </button>
                  <button className="btn" onClick={() => setShowSession(true)}>
                    {t('app.joinPlayer')}
                  </button>
                </div>
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
