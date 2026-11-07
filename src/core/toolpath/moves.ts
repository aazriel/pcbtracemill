/** Move emission helpers, arc linearisation, statistics and time estimation. */
import type { MachineProfile, Move, Path, Toolpath, ToolpathSegment, ToolpathStats } from '../model/types'
import { DEFAULT_ACCEL, moveTimes, type TimedMove } from '../gcode/motionTime'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Heights and feeds shared by every segment of one step. */
export interface CutContext {
  safeZ: number
  /** Height to which the tool rapids before a feed-rate plunge (a little above the copper). */
  approachZ: number
  feedXY: number
  feedZ: number
}

/** Clearance above Z0 the tool rapids down to before plunging at feed rate, mm. */
export const APPROACH_CLEARANCE = 0.5

/**
 * Depth levels (negative Z values) from the surface down to -depth with at most `stepDown`
 * per level, evenly spaced. stepDown <= 0 means a single pass.
 */
export function depthLevels(depth: number, stepDown: number): number[] {
  const d = Math.max(0, depth)
  if (d === 0) return [0]
  const n = stepDown > 0 ? Math.max(1, Math.ceil(d / stepDown - 1e-9)) : 1
  const out: number[] = []
  for (let i = 1; i <= n; i++) out.push(-(d * i) / n)
  return out
}

/** Interval along a closed loop (arc-length) over which the tool lifts to `z` on deep passes. */
export interface LiftInterval {
  start: number
  end: number
}

/**
 * Splits a closed loop at the given arc-length positions, returning the loop as an explicit closed
 * polyline (last point == first point) and, for every edge, whether it lies inside a lift interval.
 */
function splitLoop(path: Path, lifts: LiftInterval[]): { pts: Path; inLift: boolean[] } {
  const L: number[] = [0]
  const ring = path.concat([path[0]])
  for (let i = 1; i < ring.length; i++)
    L.push(L[i - 1] + Math.hypot(ring[i].x - ring[i - 1].x, ring[i].y - ring[i - 1].y))
  const total = L[L.length - 1]
  const cuts: number[] = []
  for (const iv of lifts) {
    cuts.push(((iv.start % total) + total) % total, ((iv.end % total) + total) % total)
  }
  cuts.sort((a, b) => a - b)
  const pts: Path = [ring[0]]
  const sAt: number[] = [0]
  let c = 0
  for (let i = 1; i < ring.length; i++) {
    while (c < cuts.length && cuts[c] <= L[i]) {
      const s = cuts[c++]
      if (s <= L[i - 1] + 1e-9 || s >= L[i] - 1e-9) continue
      const t = (s - L[i - 1]) / (L[i] - L[i - 1])
      pts.push({
        x: ring[i - 1].x + t * (ring[i].x - ring[i - 1].x),
        y: ring[i - 1].y + t * (ring[i].y - ring[i - 1].y)
      })
      sAt.push(s)
    }
    pts.push(ring[i])
    sAt.push(L[i])
  }
  const inside = (s: number): boolean =>
    lifts.some((iv) => {
      const a = ((iv.start % total) + total) % total
      const b = ((iv.end % total) + total) % total
      return a <= b ? s > a && s < b : s > a || s < b
    })
  const inLift: boolean[] = []
  for (let i = 1; i < pts.length; i++) inLift.push(inside((sAt[i - 1] + sAt[i]) / 2))
  return { pts, inLift }
}

/**
 * Cut a closed loop at each depth level without retracting between levels. When `lifts` and
 * `liftZ` are given, every pass deeper than `liftZ` rises to `liftZ` over the lift intervals (tabs).
 */
export function closedLoopSegment(
  path: Path,
  depths: number[],
  ctx: CutContext,
  lifts: LiftInterval[] = [],
  liftZ = -Infinity
): ToolpathSegment {
  const moves: Move[] = []
  const p0 = path[0]
  moves.push({ kind: 'rapid', x: p0.x, y: p0.y, z: ctx.safeZ })
  moves.push({ kind: 'rapid', x: p0.x, y: p0.y, z: ctx.approachZ })
  const { pts, inLift } = lifts.length ? splitLoop(path, lifts) : { pts: path.concat([p0]), inLift: [] }
  let z = ctx.approachZ
  for (const level of depths) {
    for (let i = 1; i < pts.length; i++) {
      const target = inLift[i - 1] && level < liftZ ? liftZ : level
      const a = pts[i - 1]
      if (target < z - 1e-9) moves.push({ kind: 'plunge', x: a.x, y: a.y, z: target, feed: ctx.feedZ })
      else if (target > z + 1e-9) moves.push({ kind: 'feed', x: a.x, y: a.y, z: target, feed: ctx.feedZ })
      z = target
      moves.push({ kind: 'feed', x: pts[i].x, y: pts[i].y, z, feed: ctx.feedXY })
    }
  }
  moves.push({ kind: 'retract', x: p0.x, y: p0.y, z: ctx.safeZ })
  return { moves }
}

/**
 * Cut an open polyline at each depth level. Between levels the tool feeds back to the start inside
 * the already-cut kerf (no material) so every cutting pass keeps the same direction.
 */
export function openPathSegment(path: Path, depths: number[], ctx: CutContext): ToolpathSegment {
  const moves: Move[] = []
  const p0 = path[0]
  moves.push({ kind: 'rapid', x: p0.x, y: p0.y, z: ctx.safeZ })
  moves.push({ kind: 'rapid', x: p0.x, y: p0.y, z: ctx.approachZ })
  depths.forEach((z, k) => {
    if (k > 0)
      for (let i = path.length - 2; i >= 0; i--)
        moves.push({ kind: 'feed', x: path[i].x, y: path[i].y, z: depths[k - 1], feed: ctx.feedXY })
    moves.push({ kind: 'plunge', x: p0.x, y: p0.y, z, feed: ctx.feedZ })
    for (let i = 1; i < path.length; i++)
      moves.push({ kind: 'feed', x: path[i].x, y: path[i].y, z, feed: ctx.feedXY })
  })
  const pe = path[path.length - 1]
  moves.push({ kind: 'retract', x: pe.x, y: pe.y, z: ctx.safeZ })
  return { moves }
}

// ─────────────────────────────────────────── arcs

function arcSweep(from: Vec3, m: Move): { r: number; a0: number; sweep: number } {
  const cx = m.cx ?? from.x
  const cy = m.cy ?? from.y
  const r = Math.hypot(from.x - cx, from.y - cy)
  const a0 = Math.atan2(from.y - cy, from.x - cx)
  let a1 = Math.atan2(m.y - cy, m.x - cx)
  const full = Math.hypot(from.x - m.x, from.y - m.y) < 1e-9
  let sweep: number
  if (m.kind === 'arc-cw') {
    if (full) sweep = -2 * Math.PI
    else {
      while (a1 >= a0) a1 -= 2 * Math.PI
      sweep = a1 - a0
    }
  } else {
    if (full) sweep = 2 * Math.PI
    else {
      while (a1 <= a0) a1 += 2 * Math.PI
      sweep = a1 - a0
    }
  }
  return { r, a0, sweep }
}

/** 3D length of a move starting at `from` (helical length for arcs). */
export function moveLength(from: Vec3, m: Move): number {
  if (m.kind === 'arc-cw' || m.kind === 'arc-ccw') {
    const { r, sweep } = arcSweep(from, m)
    return Math.hypot(Math.abs(sweep) * r, m.z - from.z)
  }
  if (m.kind === 'dwell') return 0
  return Math.hypot(m.x - from.x, m.y - from.y, m.z - from.z)
}

/**
 * Replace arc moves by feed polylines within chord tolerance `tol` mm (Z interpolated linearly for
 * helices). `start` is the tool position before the first move (defaults to the first move's end).
 */
export function linearizeArcs(moves: Move[], tol = 0.005, start?: Vec3): Move[] {
  const out: Move[] = []
  let pos: Vec3 =
    start ?? (moves.length ? { x: moves[0].x, y: moves[0].y, z: moves[0].z } : { x: 0, y: 0, z: 0 })
  for (const m of moves) {
    if (m.kind === 'arc-cw' || m.kind === 'arc-ccw') {
      const { r, a0, sweep } = arcSweep(pos, m)
      const cx = m.cx ?? pos.x
      const cy = m.cy ?? pos.y
      const step = r > tol ? 2 * Math.acos(1 - tol / r) : Math.PI / 4
      const n = Math.max(1, Math.ceil(Math.abs(sweep) / step))
      for (let i = 1; i <= n; i++) {
        const t = i / n
        const a = a0 + sweep * t
        const last = i === n
        out.push({
          kind: 'feed',
          x: last ? m.x : cx + r * Math.cos(a),
          y: last ? m.y : cy + r * Math.sin(a),
          z: pos.z + (m.z - pos.z) * t,
          feed: m.feed
        })
      }
    } else out.push(m)
    if (m.kind !== 'dwell') pos = { x: m.x, y: m.y, z: m.z }
  }
  return out
}

// ─────────────────────────────────────────── stats & time

function isFeedLike(k: Move['kind']): boolean {
  return k === 'feed' || k === 'arc-cw' || k === 'arc-ccw'
}

/**
 * Run time in seconds of `moves` starting at `start`, with the same acceleration model as the
 * G-code file estimate (gcode/motionTime.ts, D-029): rapids per axis at machine.maxFeedXY / maxFeedZ,
 * feeds at their feed clamped to the machine limits, slowing down for corners; dwells as given.
 */
function runSeconds(moves: Move[], machine: MachineProfile, start: Vec3): number {
  const timed: TimedMove[] = []
  let dwell = 0
  let pos = start
  for (const m of linearizeArcs(moves, 0.01, start)) {
    if (m.kind === 'dwell') {
      dwell += m.seconds ?? 0
      continue
    }
    const from = [pos.x, pos.y, pos.z] as const
    const to = [m.x, m.y, m.z] as const
    if (m.kind === 'rapid' || m.kind === 'retract') timed.push({ kind: 'rapid', from, to, feed: 0 })
    else
      timed.push({
        kind: 'feed',
        from,
        to,
        feed: m.feed ?? (m.kind === 'plunge' ? machine.maxFeedZ : machine.maxFeedXY)
      })
    pos = { x: m.x, y: m.y, z: m.z }
  }
  const lim = {
    maxFeedXY: machine.maxFeedXY,
    maxFeedZ: machine.maxFeedZ,
    accel: machine.accel && machine.accel > 0 ? machine.accel : DEFAULT_ACCEL
  }
  return moveTimes(timed, lim).reduce((t, s) => t + s, dwell)
}

/** Estimated run time in seconds. Starts from `start` (default X0 Y0 at machine.safeZ). */
export function estimateTime(moves: Move[], machine: MachineProfile, start?: Vec3): number {
  return runSeconds(moves, machine, start ?? { x: 0, y: 0, z: machine.safeZ })
}

/** Stats for a list of segments (cut length counts feed + arc moves, rapid length counts rapids + retracts). */
export function computeStats(
  segments: ToolpathSegment[],
  machine: MachineProfile,
  start?: Vec3
): ToolpathStats {
  const st: ToolpathStats = { cutLength: 0, rapidLength: 0, plungeCount: 0, estimatedSeconds: 0 }
  const from: Vec3 = start ?? { x: 0, y: 0, z: machine.safeZ }
  let pos = from
  const all: Move[] = []
  for (const seg of segments) {
    for (const m of seg.moves) {
      const len = moveLength(pos, m)
      if (isFeedLike(m.kind)) st.cutLength += len
      else if (m.kind === 'rapid' || m.kind === 'retract') st.rapidLength += len
      else if (m.kind === 'plunge') st.plungeCount++
      if (m.kind !== 'dwell') pos = { x: m.x, y: m.y, z: m.z }
      all.push(m)
    }
  }
  st.estimatedSeconds = runSeconds(all, machine, from)
  return st
}

/** All moves of a toolpath flattened in order. */
export function flattenMoves(tp: Pick<Toolpath, 'segments'>): Move[] {
  const out: Move[] = []
  for (const s of tp.segments) for (const m of s.moves) out.push(m)
  return out
}
