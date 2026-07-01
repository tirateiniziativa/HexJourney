// Algoritmo del meteo dinamico: pipeline a PESI (non percentuali hardcoded).
//
//   base stagionale -> latitudine (scala) -> terreno+vicini -> continuità
//   -> normalizzazione -> estrazione pesata
//
// Tutte le funzioni sono pure e testabili; i valori tunable stanno in
// `weatherRules.ts`. Il roll usa il tile corrente del gruppo (o il centro mappa).

import {
  getTile,
  isWaterTerrain,
  keyOf,
  parseKey,
  WEATHER_TYPES,
  type MapDocument,
  type Season,
  type WeatherState,
  type WeatherType,
} from '@/model/types'
import { axialNeighbors } from '@/hex/coordinates'
import {
  BASE_SEASON_WEIGHTS,
  DEFAULT_CONTINUITY,
  LATITUDE_MODS,
  TERRAIN_WEATHER,
  WEATHER_CONTINUITY,
  zeroWeights,
  type ClimateBand,
  type WeatherWeights,
} from './weatherRules'

export interface WeatherProbability {
  weather: WeatherType
  weight: number
  probability: number
}

export interface WeatherRollContext {
  map: MapDocument
  tileKey: string
  season: Season
  currentWeather: WeatherState
}

export interface WeatherRollResult {
  previous: WeatherType
  next: WeatherType
  probabilities: WeatherProbability[]
  /** chiavi i18n che spiegano quali modificatori sono intervenuti */
  reasonSummary: string[]
}

// ---- helper sui pesi -------------------------------------------------------

function mulInto(w: WeatherWeights, part: Partial<WeatherWeights>): void {
  for (const k of Object.keys(part) as WeatherType[]) w[k] = (w[k] ?? 0) * (part[k] ?? 1)
}
function addInto(w: WeatherWeights, part: Partial<WeatherWeights>): void {
  for (const k of Object.keys(part) as WeatherType[]) w[k] = (w[k] ?? 0) + (part[k] ?? 0)
}

// ---- 1) base stagionale ----------------------------------------------------

export function getBaseSeasonWeights(season: Season): WeatherWeights {
  return { ...(BASE_SEASON_WEIGHTS[season] ?? zeroWeights()) }
}

// ---- 2) latitudine (nord/sud) su scale ampie -------------------------------

/** Banda climatica dal `r` del tile: r cresce verso sud. Terzi sull'altezza. */
export function getClimateBand(map: MapDocument, tileKey: string): ClimateBand {
  const { r } = parseKey(tileKey)
  const h = Math.max(1, map.height - 1)
  const frac = Math.min(1, Math.max(0, r / h)) // 0 = nord .. 1 = sud
  if (frac < 0.34) return 'north'
  if (frac > 0.66) return 'south'
  return 'mid'
}

export function applyScaleLatitudeModifiers(
  weights: WeatherWeights,
  map: MapDocument,
  tileKey: string,
  season: Season,
  reasons: string[],
): WeatherWeights {
  const scale = map.scale ?? 'regional'
  // La latitudine conta solo su mappe ampie (regni/continenti).
  if (scale !== 'kingdoms' && scale !== 'continents') return weights
  const band = getClimateBand(map, tileKey)
  const bandMods = LATITUDE_MODS[season]?.[band]
  if (bandMods) {
    mulInto(weights, bandMods)
    reasons.push(
      band === 'north'
        ? 'weatherReason.latNorth'
        : band === 'south'
          ? 'weatherReason.latSouth'
          : 'weatherReason.latMid',
    )
  }
  return weights
}

// ---- 3) terreno + 6 vicini -------------------------------------------------

function neighborTiles(map: MapDocument, tileKey: string) {
  const { q, r } = parseKey(tileKey)
  return axialNeighbors({ q, r }).map((n) => getTile(map, keyOf(n.q, n.r)))
}

export function applyTerrainModifiers(
  weights: WeatherWeights,
  map: MapDocument,
  tileKey: string,
  reasons: string[],
): WeatherWeights {
  const tile = getTile(map, tileKey)
  const terrain = tile.terrain || 'plains'
  const neigh = neighborTiles(map, tileKey)

  const isMountain = terrain === 'mountain'
  const nearSnow = neigh.some((t) => t.snow)
  if (isMountain || tile.snow || nearSnow) {
    mulInto(weights, TERRAIN_WEATHER.mountainSnowBoost)
    reasons.push('weatherReason.mountainSnow')
  }

  const nearDesert = neigh.some((t) => (t.terrain || '') === 'desert')
  if (terrain === 'desert' || nearDesert) {
    mulInto(weights, TERRAIN_WEATHER.desertBoost)
    mulInto(weights, TERRAIN_WEATHER.desertReduce)
    addInto(weights, TERRAIN_WEATHER.desertEnable)
    reasons.push('weatherReason.desert')
  }

  const isVolcanic = terrain === 'volcano' || !!tile.volcanic
  const nearVolcanic = neigh.some((t) => (t.terrain || '') === 'volcano' || t.volcanic)
  if (isVolcanic) {
    addInto(weights, TERRAIN_WEATHER.volcanicEnable)
    reasons.push('weatherReason.volcanic')
  } else if (nearVolcanic) {
    addInto(weights, TERRAIN_WEATHER.volcanicNearEnable)
    reasons.push('weatherReason.volcanicNear')
  }

  if (isWaterTerrain(terrain) || terrain === 'swamp') {
    mulInto(weights, TERRAIN_WEATHER.wetlandBoost)
    reasons.push('weatherReason.wetland')
  } else if (terrain === 'forest') {
    mulInto(weights, TERRAIN_WEATHER.forestBoost)
    reasons.push('weatherReason.forest')
  }

  return weights
}

// ---- 4) continuità (inerzia) ----------------------------------------------

export function applyContinuityModifiers(
  weights: WeatherWeights,
  current: WeatherType,
  consecutiveDays: number,
  reasons: string[],
): WeatherWeights {
  const arr = WEATHER_CONTINUITY[current] ?? DEFAULT_CONTINUITY
  const idx = Math.min(Math.max(1, consecutiveDays), arr.length) - 1
  const factor = arr[idx]
  if (weights[current] != null && factor !== 1) {
    weights[current] *= factor
    reasons.push('weatherReason.continuity')
  }
  return weights
}

// ---- 5) normalizzazione + estrazione --------------------------------------

export function normalizeWeights(weights: WeatherWeights): WeatherProbability[] {
  const entries = WEATHER_TYPES.map((weather) => ({ weather, weight: Math.max(0, weights[weather] ?? 0) }))
  const total = entries.reduce((s, e) => s + e.weight, 0) || 1
  return entries.map((e) => ({ ...e, probability: e.weight / total }))
}

export function weightedRandom(probs: WeatherProbability[], rng: () => number): WeatherType {
  const total = probs.reduce((s, p) => s + p.weight, 0)
  if (total <= 0) return 'sunny'
  let x = rng() * total
  for (const p of probs) {
    x -= p.weight
    if (x <= 0) return p.weather
  }
  return probs[probs.length - 1]?.weather ?? 'sunny'
}

// ---- roll completo ---------------------------------------------------------

/** Esegue la pipeline completa e sceglie il meteo del giorno successivo.
 * `rng` è iniettabile per i test; di default usa Math.random. */
export function rollWeather(ctx: WeatherRollContext, rng: () => number = Math.random): WeatherRollResult {
  const reasons: string[] = ['weatherReason.season']
  let weights = getBaseSeasonWeights(ctx.season)
  weights = applyScaleLatitudeModifiers(weights, ctx.map, ctx.tileKey, ctx.season, reasons)
  weights = applyTerrainModifiers(weights, ctx.map, ctx.tileKey, reasons)
  weights = applyContinuityModifiers(
    weights,
    ctx.currentWeather.current,
    ctx.currentWeather.consecutiveDays,
    reasons,
  )
  const probabilities = normalizeWeights(weights)
  const next = weightedRandom(probabilities, rng)
  return {
    previous: ctx.currentWeather.current,
    next,
    probabilities: probabilities.filter((p) => p.weight > 0).sort((a, b) => b.probability - a.probability),
    reasonSummary: reasons,
  }
}

// ---- transizioni di stato --------------------------------------------------

/** Applica l'esito di un roll: aggiorna current/previous e i giorni consecutivi. */
export function applyRoll(state: WeatherState, next: WeatherType): WeatherState {
  return {
    ...state,
    previous: state.current,
    current: next,
    consecutiveDays: next === state.current ? state.consecutiveDays + 1 : 1,
    lastUpdatedTurn: (state.lastUpdatedTurn ?? 0) + 1,
  }
}

/** Override manuale del DM: imposta il meteo senza roll, azzera i consecutivi. */
export function setManualWeather(state: WeatherState, weather: WeatherType): WeatherState {
  return {
    ...state,
    previous: state.current,
    current: weather,
    consecutiveDays: 1,
    lastUpdatedTurn: (state.lastUpdatedTurn ?? 0) + 1,
  }
}
