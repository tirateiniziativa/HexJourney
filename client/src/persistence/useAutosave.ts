import { useEffect, useRef } from 'react'
import { useMapStore } from '@/store/mapStore'
import { saveMap } from './db'

/**
 * Autosave su Dexie a ogni modifica significativa del documento, con debounce.
 * Poiché la fog vive nei tiles, questo persiste anche lo stato di esplorazione.
 */
export function useAutosave(delay = 700) {
  const doc = useMapStore((s) => s.doc)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!doc) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      saveMap(doc).catch((err) => console.error('[autosave]', err))
    }, delay)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [doc, delay])
}
