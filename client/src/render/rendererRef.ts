// Riferimento globale al PixiManager attivo, così la UI (es. export PNG) può
// raggiungere il motore senza prop-drilling. Impostato da HexCanvas.

import type { PixiManager } from './PixiManager'

let current: PixiManager | null = null

export function setRenderer(manager: PixiManager | null): void {
  current = manager
}

export function getRenderer(): PixiManager | null {
  return current
}
