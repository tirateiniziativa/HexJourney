import { useSyncExternalStore } from 'react'

/** Profilo dispositivo per l'adattamento del front-end. */
export type Device = 'mobile' | 'tablet' | 'desktop'

// Soglie di larghezza (px). La classificazione NON usa lo user-agent (fragile e
// di fatto deprecato): si basa su viewport + tipo di puntatore, affidabili e
// reattivi a resize/rotazione.
const MOBILE_MAX = 640
const TABLET_MAX = 1366

/** Determina il profilo dispositivo corrente. */
function getDevice(): Device {
  if (typeof window === 'undefined') return 'desktop'
  const w = window.innerWidth
  if (w <= MOBILE_MAX) return 'mobile'
  // un puntatore "coarse" (touch) entro una larghezza media => tablet;
  // altrimenti (mouse/hover, o schermo ampio) => desktop.
  const coarse = window.matchMedia('(pointer: coarse)').matches
  if (coarse && w <= TABLET_MAX) return 'tablet'
  return 'desktop'
}

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia('(pointer: coarse)')
  window.addEventListener('resize', onChange)
  window.addEventListener('orientationchange', onChange)
  mql.addEventListener('change', onChange)
  return () => {
    window.removeEventListener('resize', onChange)
    window.removeEventListener('orientationchange', onChange)
    mql.removeEventListener('change', onChange)
  }
}

/** Profilo dispositivo corrente ('mobile' | 'tablet' | 'desktop'), reattivo a
 * cambi di dimensione/orientamento e tipo di puntatore. */
export function useDevice(): Device {
  return useSyncExternalStore(subscribe, getDevice, () => 'desktop')
}
