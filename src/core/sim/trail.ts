import type { SimMove } from '../model/types'
import type { Affine } from './affine'

/** Start time of move `i` (seconds). */
export function moveStart(moves: SimMove[], i: number): number {
  return i > 0 ? moves[i - 1].tEnd : 0
}

/**
 * Index of the move active at `time`: the first move with tEnd > time, or the last move when
 * time ≥ total program time. Returns -1 for an empty program.
 */
export function moveIndexAt(moves: SimMove[], time: number): number {
  const n = moves.length
  if (n === 0) return -1
  let lo = 0
  let hi = n - 1
  if (time >= moves[hi].tEnd) return hi
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (moves[mid].tEnd > time) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** Fraction (0..1) of move `i` completed at `time`. */
export function moveFraction(moves: SimMove[], i: number, time: number): number {
  const t0 = moveStart(moves, i)
  const t1 = moves[i].tEnd
  if (t1 <= t0) return time >= t1 ? 1 : 0
  const f = (time - t0) / (t1 - t0)
  return f < 0 ? 0 : f > 1 ? 1 : f
}

/** Interpolated tool tip position of move `i` at `time` (work coordinates). */
export function positionInMove(moves: SimMove[], i: number, time: number): [number, number, number] {
  const m = moves[i]
  const f = moveFraction(moves, i, time)
  return [
    m.from[0] + (m.to[0] - m.from[0]) * f,
    m.from[1] + (m.to[1] - m.from[1]) * f,
    m.from[2] + (m.to[2] - m.from[2]) * f
  ]
}

/**
 * Recent tool path up to `uptoTime` as packed XYZ triples (oldest first), ending at the
 * interpolated current position. At most `maxPoints` points. Optional `affine` maps XY
 * (e.g. work→stock). Optional `filter` restricts which moves are included (e.g. one side):
 * the walk back stops at the first excluded move so the polyline stays contiguous.
 */
export function trailPolyline(
  moves: SimMove[],
  uptoTime: number,
  maxPoints: number,
  affine?: Affine,
  filter?: (m: SimMove) => boolean
): Float32Array {
  const cur = moveIndexAt(moves, uptoTime)
  if (cur < 0 || maxPoints < 1) return new Float32Array(0)
  const pts: number[] = []
  const pos = positionInMove(moves, cur, uptoTime)
  if (filter && !filter(moves[cur])) return new Float32Array(0)
  pts.push(pos[0], pos[1], pos[2])
  let i = cur
  while (pts.length / 3 < maxPoints && i >= 0) {
    const m = moves[i]
    if (filter && !filter(m)) break
    pts.push(m.from[0], m.from[1], m.from[2])
    i--
  }
  const n = pts.length / 3
  const out = new Float32Array(n * 3)
  for (let k = 0; k < n; k++) {
    const src = (n - 1 - k) * 3
    let x = pts[src]
    let y = pts[src + 1]
    if (affine) {
      const tx = affine[0] * x + affine[1] * y + affine[2]
      y = affine[3] * x + affine[4] * y + affine[5]
      x = tx
    }
    out[k * 3] = x
    out[k * 3 + 1] = y
    out[k * 3 + 2] = pts[src + 2]
  }
  return out
}
