// Algoritmo degli Eventi Casuali: pipeline a PESI (come il meteo).
//
//   base -> terreno -> overlay -> meteo -> momentum(no-event) -> cooldown
//   -> normalizzazione -> estrazione pesata
//
// Tutte le funzioni di calcolo sono pure e testabili; i valori tunable stanno
// in `randomEventRules.ts`. Le transizioni di stato (confirm/discard/replace)
// gestiscono momentum e cooldown secondo la specifica.

import {
  getTile,
  isWaterTerrain,
  RANDOM_EVENT_TYPES,
  type HexTile,
  type MapDocument,
  type RandomEventProbability,
  type RandomEventsState,
  type RandomEventType,
  type WeatherState,
} from '@/model/types'
import { hasPath } from './travel'
import {
  baseRandomEventWeights,
  COOLDOWN_DURATION,
  COOLDOWN_FACTORS,
  EVENT_MOMENTUM,
  NEGATIVE_EVENTS,
  NONE_MOMENTUM,
  OVERLAY_EVENT_MODS,
  POSITIVE_EVENTS,
  REEF_LAND_MOD,
  REEF_WATER_MOD,
  TERRAIN_EVENT_MODS,
  WEATHER_EVENT_MODS,
  type EventWeights,
} from './randomEventRules'

export interface RandomEventRollContext {
  map: MapDocument
  tileKey: string
  weather?: WeatherState
  randomEvents: RandomEventsState
}

export interface RandomEventRollResult {
  proposedEvent: RandomEventType
  probabilities: RandomEventProbability[]
  reasonSummary: string[]
}

/** Snapshot temporaneo per gestire lo scarto (annullamento totale del roll). */
export interface PendingRandomEventResolution {
  proposedEvent: RandomEventType
  preRollState: RandomEventsState
  probabilities: RandomEventProbability[]
  reasonSummary: string[]
}

// ---- helper sui pesi -------------------------------------------------------

function mulInto(w: EventWeights, part: Partial<EventWeights>): void {
  for (const k of Object.keys(part) as RandomEventType[]) w[k] = (w[k] ?? 0) * (part[k] ?? 1)
}

export function isPositiveEvent(e: RandomEventType): boolean {
  return POSITIVE_EVENTS.includes(e)
}
export function isNegativeEvent(e: RandomEventType): boolean {
  return NEGATIVE_EVENTS.includes(e)
}

// ---- pipeline --------------------------------------------------------------

export function getBaseRandomEventWeights(): EventWeights {
  return { ...baseRandomEventWeights }
}

export function applyTerrainEventModifiers(w: EventWeights, tile: HexTile, reasons: string[]): EventWeights {
  const mod = TERRAIN_EVENT_MODS[tile.terrain || 'plains']
  if (mod) {
    mulInto(w, mod)
    reasons.push('randomEventReason.terrain')
  }
  return w
}

export function applyOverlayEventModifiers(w: EventWeights, tile: HexTile, reasons: string[]): EventWeights {
  const water = isWaterTerrain(tile.terrain || '')
  let applied = false
  const apply = (part?: Partial<EventWeights>) => {
    if (part) {
      mulInto(w, part)
      applied = true
    }
  }
  // percorsi
  if (hasPath(tile, 'road')) apply(OVERLAY_EVENT_MODS.road)
  if (hasPath(tile, 'river')) apply(OVERLAY_EVENT_MODS.river)
  // effetti a tutta casella
  if (tile.snow) apply(OVERLAY_EVENT_MODS.snow)
  if (tile.ice) apply(OVERLAY_EVENT_MODS.ice)
  if (tile.volcanic) apply(OVERLAY_EVENT_MODS.volcanic)
  // overlay-simbolo che influenzano gli eventi
  if (tile.overlay === 'shoal') apply(OVERLAY_EVENT_MODS.shoal)
  if (tile.overlay === 'reef') apply(water ? REEF_WATER_MOD : REEF_LAND_MOD)
  // gli overlay di insediamento (ruins/village/city/fortress/cave/sanctuary/
  // oasis/dungeon) NON hanno voce: non triggerano eventi per la loro presenza.
  if (applied) reasons.push('randomEventReason.overlay')
  return w
}

export function applyWeatherEventModifiers(w: EventWeights, weather: WeatherState | undefined, reasons: string[]): EventWeights {
  const cur = weather?.current
  if (!cur) return w
  const mod = WEATHER_EVENT_MODS[cur]
  if (mod && Object.keys(mod).length > 0) {
    mulInto(w, mod)
    reasons.push('randomEventReason.weather')
  }
  return w
}

/** Più passi senza evento -> "none" ridotto (mai a zero) e categorie evento
 * leggermente potenziate. */
export function applyNoEventMomentum(w: EventWeights, stepsSinceLastEvent: number, reasons: string[]): EventWeights {
  if (stepsSinceLastEvent <= 0) return w
  w.none *= NONE_MOMENTUM[Math.min(stepsSinceLastEvent, NONE_MOMENTUM.length - 1)]
  const boost = EVENT_MOMENTUM[Math.min(stepsSinceLastEvent, EVENT_MOMENTUM.length - 1)]
  for (const e of RANDOM_EVENT_TYPES) if (e !== 'none') w[e] *= boost
  reasons.push('randomEventReason.momentum')
  return w
}

/** Riduce la polarità in cooldown (curva 5->0.0 … 0->1.0). */
export function applyPositiveNegativeCooldown(w: EventWeights, state: RandomEventsState, reasons: string[]): EventWeights {
  if (state.positiveCooldownSteps > 0) {
    const f = COOLDOWN_FACTORS[Math.min(state.positiveCooldownSteps, COOLDOWN_FACTORS.length - 1)]
    for (const e of POSITIVE_EVENTS) w[e] *= f
    reasons.push('randomEventReason.positiveCooldown')
  }
  if (state.negativeCooldownSteps > 0) {
    const f = COOLDOWN_FACTORS[Math.min(state.negativeCooldownSteps, COOLDOWN_FACTORS.length - 1)]
    for (const e of NEGATIVE_EVENTS) w[e] *= f
    reasons.push('randomEventReason.negativeCooldown')
  }
  return w
}

export function normalizeRandomEventWeights(w: EventWeights): RandomEventProbability[] {
  const entries = RANDOM_EVENT_TYPES.map((event) => ({ event, weight: Math.max(0, w[event] ?? 0) }))
  const total = entries.reduce((s, e) => s + e.weight, 0) || 1
  return entries.map((e) => ({ ...e, probability: e.weight / total }))
}

function weightedRandom(probs: RandomEventProbability[], rng: () => number): RandomEventType {
  const total = probs.reduce((s, p) => s + p.weight, 0)
  if (total <= 0) return 'none'
  let x = rng() * total
  for (const p of probs) {
    x -= p.weight
    if (x <= 0) return p.event
  }
  return probs[probs.length - 1]?.event ?? 'none'
}

/** Esegue l'intera pipeline e propone un evento. `rng` iniettabile per i test. */
export function rollRandomEvent(ctx: RandomEventRollContext, rng: () => number = Math.random): RandomEventRollResult {
  const reasons: string[] = []
  const tile = getTile(ctx.map, ctx.tileKey)
  let w = getBaseRandomEventWeights()
  w = applyTerrainEventModifiers(w, tile, reasons)
  w = applyOverlayEventModifiers(w, tile, reasons)
  w = applyWeatherEventModifiers(w, ctx.weather, reasons)
  w = applyNoEventMomentum(w, ctx.randomEvents.stepsSinceLastEvent, reasons)
  w = applyPositiveNegativeCooldown(w, ctx.randomEvents, reasons)
  const probabilities = normalizeRandomEventWeights(w)
  const proposedEvent = weightedRandom(probabilities, rng)
  return { proposedEvent, probabilities, reasonSummary: reasons }
}

// ---- transizioni di stato --------------------------------------------------

/** Esito "nessun evento": momentum +1, cooldown scalano di 1. */
export function applyNoneRoll(state: RandomEventsState): RandomEventsState {
  return {
    ...state,
    stepsSinceLastEvent: state.stepsSinceLastEvent + 1,
    positiveCooldownSteps: Math.max(0, state.positiveCooldownSteps - 1),
    negativeCooldownSteps: Math.max(0, state.negativeCooldownSteps - 1),
  }
}

/** Applica un evento avvenuto (conferma o sostituzione manuale): reset momentum,
 * reset del cooldown della polarità dell'evento, scalo dell'altra. `tileKey` è la
 * casella cui l'evento appartiene (posizione del gruppo), mostrata ai player. */
function applyEventOutcome(
  state: RandomEventsState,
  event: RandomEventType,
  tileKey: string | undefined,
): RandomEventsState {
  if (event === 'none') return applyNoneRoll(state)
  const pos = isPositiveEvent(event)
  const neg = isNegativeEvent(event)
  return {
    ...state,
    lastConfirmedEvent: event,
    lastConfirmedTile: tileKey,
    stepsSinceLastEvent: 0,
    positiveCooldownSteps: pos ? COOLDOWN_DURATION : Math.max(0, state.positiveCooldownSteps - 1),
    negativeCooldownSteps: neg ? COOLDOWN_DURATION : Math.max(0, state.negativeCooldownSteps - 1),
  }
}

/** Conferma l'evento proposto: `state` è lo stato PRE-roll; `tileKey` la casella. */
export function confirmRandomEvent(
  state: RandomEventsState,
  event: RandomEventType,
  tileKey?: string,
): RandomEventsState {
  return applyEventOutcome(state, event, tileKey)
}

/** Scarto = annullamento totale del roll: torna allo stato pre-roll invariato. */
export function discardRandomEvent(state: RandomEventsState): RandomEventsState {
  return { ...state }
}

/** Sostituzione manuale: tratta l'evento scelto come se fosse stato generato. */
export function replaceRandomEvent(
  state: RandomEventsState,
  chosenEvent: RandomEventType,
  tileKey?: string,
): RandomEventsState {
  return applyEventOutcome(state, chosenEvent, tileKey)
}
