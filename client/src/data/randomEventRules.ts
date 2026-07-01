// Configurazione data-driven degli Eventi Casuali. Tutti i valori "tunable"
// vivono qui: pesi base, modificatori di terreno/overlay/meteo, inerzia del
// "nessun evento" (momentum) e cooldown dopo eventi positivi/negativi.
//
// Le funzioni pure che consumano questa config stanno in `randomEvents.ts`.

import type { RandomEventType, WeatherType } from '@/model/types'

/** Pesi relativi per categoria di evento (non normalizzati). */
export type EventWeights = Record<RandomEventType, number>

/** Pesi base (richiesti dalla specifica). */
export const baseRandomEventWeights: EventWeights = {
  extremelyPositive: 1,
  veryPositive: 6,
  positive: 13,
  none: 60,
  negative: 13,
  veryNegative: 6,
  extremelyNegative: 1,
}

export const POSITIVE_EVENTS: readonly RandomEventType[] = ['extremelyPositive', 'veryPositive', 'positive']
export const NEGATIVE_EVENTS: readonly RandomEventType[] = ['negative', 'veryNegative', 'extremelyNegative']

// ---- 1) Modificatori di terreno (moltiplicativi sui pesi) ------------------
// plains/desert: più "none", meno eventi. forest/mountain/mesa: meno "none",
// più eventi (soprattutto positive/negative, poco gli estremi).
// hills/water/deepwater/swamp: neutri (nessuna voce).
export const TERRAIN_EVENT_MODS: Record<string, Partial<EventWeights>> = {
  plains: {
    none: 1.4,
    extremelyPositive: 0.8,
    veryPositive: 0.8,
    positive: 0.85,
    negative: 0.85,
    veryNegative: 0.8,
    extremelyNegative: 0.8,
  },
  desert: {
    none: 1.35,
    extremelyPositive: 0.8,
    veryPositive: 0.85,
    positive: 0.9,
    negative: 0.9,
    veryNegative: 0.85,
    extremelyNegative: 0.8,
  },
  forest: {
    none: 0.7,
    positive: 1.4,
    negative: 1.4,
    veryPositive: 1.2,
    veryNegative: 1.2,
    extremelyPositive: 1.05,
    extremelyNegative: 1.05,
  },
  mountain: {
    none: 0.65,
    positive: 1.4,
    negative: 1.5,
    veryPositive: 1.25,
    veryNegative: 1.3,
    extremelyPositive: 1.05,
    extremelyNegative: 1.1,
  },
  mesa: {
    none: 0.75,
    positive: 1.3,
    negative: 1.35,
    veryPositive: 1.15,
    veryNegative: 1.2,
    extremelyPositive: 1.05,
    extremelyNegative: 1.05,
  },
}

// ---- 2) Modificatori di overlay (moltiplicativi) ---------------------------
// road/river sono percorsi (tile.paths); snow/ice/volcanic sono effetti;
// shoal/reef sono overlay-simbolo. Gli overlay "di insediamento"
// (ruins/village/city/fortress/cave/sanctuary/oasis/dungeon) NON hanno voce:
// non triggerano eventi per la loro sola presenza.
export const OVERLAY_EVENT_MODS: Record<string, Partial<EventWeights>> = {
  road: { none: 1.3, positive: 0.8, negative: 0.8, veryPositive: 0.8, veryNegative: 0.8, extremelyPositive: 0.85, extremelyNegative: 0.85 },
  river: { none: 0.8, positive: 1.2, negative: 1.2, veryPositive: 1.1, veryNegative: 1.1 },
  snow: { none: 1.25, positive: 0.85, negative: 0.85, veryPositive: 0.85, veryNegative: 0.85 },
  ice: { none: 1.3, positive: 0.8, negative: 0.8, veryPositive: 0.8, veryNegative: 0.8 },
  volcanic: { none: 0.7, negative: 1.4, veryNegative: 1.3, positive: 1.1, extremelyNegative: 1.15 },
  shoal: { none: 0.8, positive: 1.2, negative: 1.2, veryPositive: 1.1, veryNegative: 1.1 },
}

// CONFLITTO "coral reef" (reef): la specifica lo elenca sia tra chi diminuisce
// sia tra chi aumenta gli eventi. Scelta esplicita: su ACQUA aumenta gli eventi
// (pericoli/incontri di navigazione), fuori acqua li diminuisce.
export const REEF_WATER_MOD: Partial<EventWeights> = { none: 0.8, positive: 1.2, negative: 1.2, veryPositive: 1.1, veryNegative: 1.1 }
export const REEF_LAND_MOD: Partial<EventWeights> = { none: 1.25, positive: 0.85, negative: 0.85, veryPositive: 0.85, veryNegative: 0.85 }

// ---- 3) Modificatori meteo (moltiplicativi) --------------------------------
export const WEATHER_EVENT_MODS: Partial<Record<WeatherType, Partial<EventWeights>>> = {
  sunny: { none: 1.15, extremelyPositive: 0.7, extremelyNegative: 0.7, veryPositive: 0.85, veryNegative: 0.85 },
  cloudy: {}, // neutro
  rain: { none: 0.85, negative: 1.3, veryNegative: 1.1, positive: 1.05 },
  storm: { none: 0.7, negative: 1.4, veryNegative: 1.5, extremelyNegative: 1.2, positive: 0.85 },
  snow: { none: 0.8, negative: 1.3, veryNegative: 1.15, positive: 0.8, veryPositive: 0.8 },
  blizzard: { none: 0.5, negative: 1.3, veryNegative: 1.6, extremelyNegative: 1.5, positive: 0.7, veryPositive: 0.7, extremelyPositive: 0.6 },
  fog: { none: 0.8, negative: 1.3, veryNegative: 1.1 },
  heatwave: { none: 0.8, negative: 1.3, veryNegative: 1.2 },
  sandstorm: { none: 0.5, negative: 1.3, veryNegative: 1.6, extremelyNegative: 1.5, positive: 0.75 },
  ashfall: { none: 0.75, negative: 1.4, veryNegative: 1.3, positive: 0.85 },
  volcanicEruption: { none: 0.2, negative: 1.6, veryNegative: 1.8, extremelyNegative: 2.0, positive: 0.15, veryPositive: 0.1, extremelyPositive: 0.1 },
}

// ---- 4) Momentum: più passi senza evento -> meno "none" --------------------
// Moltiplicatore su "none" per numero di passi consecutivi senza evento
// (index = min(steps, len-1)); il floor 0.45 impedisce che "none" sparisca.
export const NONE_MOMENTUM: readonly number[] = [1.0, 0.85, 0.7, 0.55, 0.45]
// Boost leggero alle categorie evento al crescere dei passi.
export const EVENT_MOMENTUM: readonly number[] = [1.0, 1.06, 1.12, 1.18, 1.25]

// ---- 5) Cooldown dopo eventi positivi/negativi -----------------------------
// factor applicato ai pesi della stessa polarità, indicizzato dai passi di
// cooldown residui (5 = appena avvenuto -> quasi zero; 0 = normale).
export const COOLDOWN_FACTORS: readonly number[] = [1.0, 0.85, 0.65, 0.4, 0.2, 0.0]
export const COOLDOWN_DURATION = 5
