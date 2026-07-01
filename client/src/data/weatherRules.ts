// Configurazione data-driven del meteo dinamico. Tutti i valori "tunable" del
// sistema vivono qui: pesi base per stagione, modificatori nord/sud (latitudine),
// modificatori di terreno alle probabilità, inerzia (continuità) per tipo meteo,
// e modificatori del meteo ai TEMPI di viaggio (+ combinazioni meteo+terreno).
//
// Le funzioni pure che consumano questa config stanno in `weather.ts` (algoritmo
// probabilità) e in `travel.ts` (pipeline dei tempi).

import type { Season, WeatherType } from '@/model/types'

/** Pesi relativi per ciascun tipo di meteo (non normalizzati). */
export type WeatherWeights = Record<WeatherType, number>

/** Pesi tutti a zero: base su cui costruire le tabelle stagionali. */
export function zeroWeights(): WeatherWeights {
  return {
    sunny: 0,
    cloudy: 0,
    rain: 0,
    storm: 0,
    snow: 0,
    blizzard: 0,
    fog: 0,
    heatwave: 0,
    sandstorm: 0,
    ashfall: 0,
    volcanicEruption: 0,
  }
}

// 1) ---- Pesi base stagionali ----------------------------------------------
// I meteo "speciali" (sandstorm/ashfall/volcanicEruption) partono da 0 e sono
// ABILITATI dai modificatori di terreno (deserto, vulcano). heatwave/blizzard
// hanno base bassa e vengono spinti da stagione + latitudine + terreno.
export const BASE_SEASON_WEIGHTS: Record<Season, WeatherWeights> = {
  spring: { ...zeroWeights(), sunny: 30, cloudy: 25, rain: 25, storm: 8, snow: 3, fog: 9 },
  summer: { ...zeroWeights(), sunny: 40, cloudy: 20, rain: 12, storm: 10, fog: 4, heatwave: 12, sandstorm: 2 },
  autumn: { ...zeroWeights(), sunny: 22, cloudy: 28, rain: 25, storm: 8, snow: 4, blizzard: 1, fog: 12 },
  winter: { ...zeroWeights(), sunny: 16, cloudy: 24, rain: 10, storm: 5, snow: 24, blizzard: 7, fog: 12 },
}

// 2) ---- Modificatori di latitudine (solo mappe kingdoms/continents) --------
// Moltiplicatori parziali sui pesi, per stagione e banda climatica.
export type ClimateBand = 'north' | 'mid' | 'south'

export const LATITUDE_MODS: Partial<
  Record<Season, Partial<Record<ClimateBand, Partial<WeatherWeights>>>>
> = {
  winter: {
    north: { snow: 1.6, blizzard: 2.0, rain: 0.4 },
    south: { snow: 0.35, blizzard: 0.15, rain: 1.8, sunny: 1.2 },
  },
  summer: {
    north: { heatwave: 0.4, sandstorm: 0.5 },
    south: { heatwave: 2.0, sandstorm: 1.5, rain: 0.8 },
  },
  spring: {
    north: { snow: 1.6, rain: 0.85 },
    south: { rain: 1.2, snow: 0.3, heatwave: 1.3 },
  },
  autumn: {
    north: { snow: 1.6, rain: 0.9 },
    south: { rain: 1.2, snow: 0.4 },
  },
}

// 3) ---- Modificatori di terreno alle probabilità ---------------------------
// Alcuni sono moltiplicativi (mul*) sui pesi esistenti, altri additivi (add*)
// perché ABILITANO meteo con base 0 (sandstorm/ashfall/eruption).
export const TERRAIN_WEATHER = {
  /** montagna, neve o adiacenza a neve: più snow/blizzard */
  mountainSnowBoost: { snow: 1.8, blizzard: 2.0 } as Partial<WeatherWeights>,
  /** deserto o adiacenza: più sunny/heatwave */
  desertBoost: { sunny: 1.4, heatwave: 1.8 } as Partial<WeatherWeights>,
  /** deserto o adiacenza: abilita sandstorm */
  desertEnable: { sandstorm: 8 } as Partial<WeatherWeights>,
  /** deserto o adiacenza: riduce rain/snow */
  desertReduce: { rain: 0.3, snow: 0.2 } as Partial<WeatherWeights>,
  /** hex vulcanico (terrain volcano o overlay volcanic): abilita ashfall + eruption raro */
  volcanicEnable: { ashfall: 10, volcanicEruption: 1.5 } as Partial<WeatherWeights>,
  /** adiacenza a vulcano/volcanic: abilita ashfall ma NON l'eruzione */
  volcanicNearEnable: { ashfall: 6 } as Partial<WeatherWeights>,
  /** palude/acqua: più fog/rain */
  wetlandBoost: { fog: 1.8, rain: 1.6 } as Partial<WeatherWeights>,
  /** foresta: leggermente più fog/rain */
  forestBoost: { fog: 1.25, rain: 1.2 } as Partial<WeatherWeights>,
}

// 4) ---- Continuità (inerzia) del meteo -------------------------------------
// Moltiplicatore applicato al peso del meteo CORRENTE in base ai giorni
// consecutivi: index 0 = 1° giorno, ultimo valore = "N+ giorni". Il bonus parte
// alto e decade sotto 1 (il meteo si "stanca").
export const WEATHER_CONTINUITY: Partial<Record<WeatherType, number[]>> = {
  sunny: [3.5, 3.0, 2.5, 2.0, 1.6],
  cloudy: [2.6, 2.0, 1.5, 1.1, 0.9],
  rain: [3.0, 2.0, 1.2, 0.7, 0.4],
  storm: [1.5, 0.6, 0.3],
  snow: [2.6, 1.8, 1.2, 0.8, 0.5],
  blizzard: [1.5, 0.6, 0.3],
  fog: [2.2, 1.4, 0.8, 0.5],
  heatwave: [2.4, 1.9, 1.4, 1.0, 0.7],
  sandstorm: [1.8, 0.9, 0.4],
  ashfall: [2.6, 2.1, 1.6, 1.2, 0.9],
  volcanicEruption: [0.4, 0.2],
}

/** Continuità di default per i meteo non elencati sopra. */
export const DEFAULT_CONTINUITY = [2.0, 1.3, 0.8, 0.5]

// 5) ---- Modificatori del meteo ai TEMPI di viaggio -------------------------
// `general` è il moltiplicatore base; `terrain` sovrascrive per terreni
// specifici; `snowOverlay` per tile con overlay neve; `nearDesert`/`nearVolcanic`
// per adiacenza. La pipeline usa il MASSIMO tra i candidati applicabili.
export interface WeatherTravelRule {
  general: number
  terrain?: Partial<Record<string, number>>
  snowOverlay?: number
  nearDesert?: number
  nearVolcanic?: number
}

export const WEATHER_TRAVEL: Record<WeatherType, WeatherTravelRule> = {
  sunny: { general: 1.0 },
  cloudy: { general: 1.0 },
  rain: { general: 1.15, terrain: { swamp: 1.35 } },
  storm: {
    general: 1.5,
    terrain: { mountain: 1.75, forest: 1.75, swamp: 1.75, water: 1.75, deepwater: 1.75 },
  },
  snow: { general: 1.35, terrain: { mountain: 1.6, hills: 1.6, forest: 1.6 }, snowOverlay: 2.0 },
  blizzard: { general: 2.0, terrain: { mountain: 2.5 } },
  fog: { general: 1.15, terrain: { forest: 1.35, swamp: 1.35, mountain: 1.35 } },
  heatwave: { general: 1.25, terrain: { desert: 1.75, hills: 1.4, plains: 1.4 } },
  sandstorm: { general: 1.25, terrain: { desert: 2.0 }, nearDesert: 1.5 },
  ashfall: { general: 1.35, terrain: { volcano: 1.75 }, nearVolcanic: 1.75 },
  volcanicEruption: { general: 1.0, terrain: { volcano: 2.0 } },
}

// 6) ---- Combinazioni contestuali meteo + terreno ---------------------------
// Malus EXTRA (o blocco) applicati sopra il modificatore base del meteo.
export interface WeatherTerrainCombo {
  weather: WeatherType
  /** terreno del tile richiesto (alternativo a `volcanic`) */
  terrain?: string
  /** true = richiede tile vulcanico (terrain volcano o overlay volcanic) */
  volcanic?: boolean
  multiplier?: number
  block?: boolean
}

export const WEATHER_TERRAIN_COMBO: WeatherTerrainCombo[] = [
  { weather: 'rain', terrain: 'swamp', multiplier: 1.2 },
  { weather: 'storm', terrain: 'mountain', multiplier: 1.25 },
  { weather: 'snow', terrain: 'mountain', multiplier: 1.25 },
  { weather: 'fog', terrain: 'forest', multiplier: 1.2 },
  { weather: 'fog', terrain: 'swamp', multiplier: 1.2 },
  { weather: 'heatwave', terrain: 'desert', multiplier: 1.25 },
  { weather: 'sandstorm', terrain: 'desert', multiplier: 1.25 },
  { weather: 'ashfall', volcanic: true, multiplier: 1.25 },
  { weather: 'volcanicEruption', volcanic: true, block: true },
]

/** Cap massimo del prodotto dei moltiplicatori (evita esplosioni). Il blocco
 * movimento (blocksMovement) non è soggetto al cap. */
export const WEATHER_TRAVEL_CAP = 3.0
