// Matematica degli esagoni secondo Red Blob Games.
// - Coordinate ASSIALI (q, r) per memorizzare/indicizzare.
// - Coordinate CUBICHE (q, r, s con q+r+s=0) per gli algoritmi:
//   distanza, vicini, linee, raggi. Niente coordinate offset negli algoritmi.

export interface Axial {
  q: number
  r: number
}

export interface Cube {
  q: number
  r: number
  s: number
}

export function axialToCube(a: Axial): Cube {
  return { q: a.q, r: a.r, s: -a.q - a.r }
}

export function cubeToAxial(c: Cube): Axial {
  return { q: c.q, r: c.r }
}

/** Le 6 direzioni cubiche, in ordine. */
export const CUBE_DIRECTIONS: readonly Cube[] = [
  { q: 1, r: 0, s: -1 },
  { q: 1, r: -1, s: 0 },
  { q: 0, r: -1, s: 1 },
  { q: -1, r: 0, s: 1 },
  { q: -1, r: 1, s: 0 },
  { q: 0, r: 1, s: -1 },
]

export function cubeAdd(a: Cube, b: Cube): Cube {
  return { q: a.q + b.q, r: a.r + b.r, s: a.s + b.s }
}

export function cubeNeighbor(c: Cube, direction: number): Cube {
  return cubeAdd(c, CUBE_DIRECTIONS[((direction % 6) + 6) % 6])
}

/** Vicini in coordinate assiali (usa internamente le cubiche). */
export function axialNeighbors(a: Axial): Axial[] {
  const c = axialToCube(a)
  return CUBE_DIRECTIONS.map((d) => cubeToAxial(cubeAdd(c, d)))
}

export function cubeDistance(a: Cube, b: Cube): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.s - b.s)) / 2
}

export function axialDistance(a: Axial, b: Axial): number {
  return cubeDistance(axialToCube(a), axialToCube(b))
}

/** Arrotonda coordinate cubiche frazionarie all'hex più vicino. */
export function cubeRound(fq: number, fr: number, fs: number): Cube {
  let q = Math.round(fq)
  let r = Math.round(fr)
  let s = Math.round(fs)
  const dq = Math.abs(q - fq)
  const dr = Math.abs(r - fr)
  const ds = Math.abs(s - fs)
  if (dq > dr && dq > ds) {
    q = -r - s
  } else if (dr > ds) {
    r = -q - s
  } else {
    s = -q - r
  }
  return { q, r, s }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function cubeLerp(a: Cube, b: Cube, t: number): Cube {
  return { q: lerp(a.q, b.q, t), r: lerp(a.r, b.r, t), s: lerp(a.s, b.s, t) }
}

/** Linea di hex da a a b (inclusi gli estremi). */
export function cubeLine(a: Cube, b: Cube): Cube[] {
  const n = cubeDistance(a, b)
  const results: Cube[] = []
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n
    const p = cubeLerp(a, b, t)
    results.push(cubeRound(p.q, p.r, p.s))
  }
  return results
}

export function axialLine(a: Axial, b: Axial): Axial[] {
  return cubeLine(axialToCube(a), axialToCube(b)).map(cubeToAxial)
}

/** Tutti gli hex entro raggio N dal centro (disco esagonale). */
export function cubeRange(center: Cube, n: number): Cube[] {
  const results: Cube[] = []
  for (let dq = -n; dq <= n; dq++) {
    const rMin = Math.max(-n, -dq - n)
    const rMax = Math.min(n, -dq + n)
    for (let dr = rMin; dr <= rMax; dr++) {
      const ds = -dq - dr
      results.push({ q: center.q + dq, r: center.r + dr, s: center.s + ds })
    }
  }
  return results
}

/** Anello di hex a distanza esatta N dal centro. */
export function cubeRing(center: Cube, n: number): Cube[] {
  if (n <= 0) return [center]
  const results: Cube[] = []
  let cube = cubeAdd(center, scale(CUBE_DIRECTIONS[4], n))
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < n; j++) {
      results.push(cube)
      cube = cubeNeighbor(cube, i)
    }
  }
  return results
}

function scale(c: Cube, k: number): Cube {
  return { q: c.q * k, r: c.r * k, s: c.s * k }
}
