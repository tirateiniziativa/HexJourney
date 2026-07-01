// Mappe predefinite ("preset") disponibili a TUTTI gli utenti e in TUTTE le
// sessioni: sono servite come asset statici da `public/presets/` (quindi
// bundle-ate col deploy, disponibili anche offline) e compaiono nell'elenco
// "Mappe" pronte da caricare. Caricare un preset crea una copia di lavoro
// indipendente (id nuovo), così salvataggi/modifiche non toccano il preset.

import { CURRENT_SCHEMA_VERSION, ensureWeatherState, type MapDocument } from '@/model/types'

export interface PresetMap {
  /** chiave stabile per la lista (non è l'id del documento) */
  key: string
  /** nome mostrato e assegnato alla copia caricata */
  name: string
  /** carica (fetch dell'asset statico) e normalizza il documento */
  load: () => Promise<MapDocument>
}

async function loadPreset(file: string, name: string): Promise<MapDocument> {
  const res = await fetch(`${import.meta.env.BASE_URL}presets/${file}`)
  if (!res.ok) throw new Error(`Preset non trovato: ${file}`)
  const raw = (await res.json()) as MapDocument
  return {
    ...raw,
    id: crypto.randomUUID(), // copia di lavoro indipendente a ogni caricamento
    name,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    weather: ensureWeatherState(raw.weather), // retro-compatibilità meteo
  }
}

export const PRESET_MAPS: PresetMap[] = [
  { key: 'tristora', name: 'Tristora', load: () => loadPreset('tristora.json', 'Tristora') },
]
