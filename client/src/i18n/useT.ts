// Hook di traduzione: restituisce una funzione t(key, params?) legata alla
// lingua corrente nello store. Cambiando lingua, i componenti che usano l'hook
// si ri-renderizzano.

import { useMapStore } from '@/store/mapStore'
import { translate, type Lang } from './index'

export function useT() {
  const lang = useMapStore((s) => s.lang)
  return (key: string, params?: Record<string, string | number>) => translate(lang, key, params)
}

export type { Lang }
