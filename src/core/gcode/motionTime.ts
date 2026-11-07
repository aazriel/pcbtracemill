/**
 * Run-time model of a hobby CNC controller (Mach3 constant-velocity mode, GRBL, LinuxCNC):
 * every axis accelerates at `accel`, rapids start and stop (axis limits per axis), and chains of feed
 * moves keep their speed through gentle corners but slow down for sharp ones. See D-029.
 *
 * Without acceleration a program of thousands of short segments (isolation, height-corrected files)
 * is estimated 10-25 % too short - measured on a Mach3 router: 1 h 17 min estimated, 1 h 23 min real.
 */

export interface TimedMove {
  kind: 'rapid' | 'feed'
  from: readonly [number, number, number]
  to: readonly [number, number, number]
  /** Commanded feed mm/min (feed moves). */
  feed: number
  /** The machine stops at the end of this move (probe touch, pause) – no corner blending. */
  stop?: boolean
  /** Feed moves: length used for timing instead of the geometric one (a probe stops at the surface). */
  timedLength?: number
}

export interface MotionLimits {
  /** Rapid / maximum feed of X and Y, mm/min. */
  maxFeedXY: number
  /** Rapid / maximum feed of Z, mm/min. */
  maxFeedZ: number
  /** Axis acceleration mm/s². 0 or missing = instant (no acceleration time). */
  accel?: number
}

/** Typical hobby router (Mach3 motor tuning ~ 50 mm/s² on belt / lead-screw machines). */
export const DEFAULT_ACCEL = 50

/** Time (s) to travel `len` mm with top speed v, entry vi and exit vo (mm/s) at acceleration a. */
function profileTime(len: number, v: number, vi: number, vo: number, a: number): number {
  if (len <= 0 || v <= 0) return 0
  if (!(a > 0)) return len / v
  vi = Math.min(vi, v)
  vo = Math.min(vo, v)
  const dUp = (v * v - vi * vi) / (2 * a)
  const dDown = (v * v - vo * vo) / (2 * a)
  if (dUp + dDown <= len) return (v - vi) / a + (v - vo) / a + (len - dUp - dDown) / v
  // never reaches top speed: triangle profile
  const vp = Math.sqrt(Math.max(vi * vi, vo * vo, (2 * a * len + vi * vi + vo * vo) / 2))
  return (vp - vi) / a + (vp - vo) / a
}

/** Seconds for each move. */
export function moveTimes(moves: readonly TimedMove[], lim: MotionLimits): number[] {
  const n = moves.length
  const a = lim.accel && lim.accel > 0 ? lim.accel : 0
  const vXY = lim.maxFeedXY > 0 ? lim.maxFeedXY / 60 : Infinity
  const vZ = lim.maxFeedZ > 0 ? lim.maxFeedZ / 60 : vXY
  const len = new Float64Array(n)
  const dir: [number, number, number][] = []
  const vmax = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const m = moves[i]
    const d: [number, number, number] = [m.to[0] - m.from[0], m.to[1] - m.from[1], m.to[2] - m.from[2]]
    const L = Math.hypot(d[0], d[1], d[2])
    len[i] = m.timedLength ?? L
    dir.push(L > 0 ? [d[0] / L, d[1] / L, d[2] / L] : [0, 0, 0])
    if (m.kind === 'feed') {
      // a feed is limited by the slowest axis taking part
      const xy = Math.hypot(dir[i][0], dir[i][1])
      const z = Math.abs(dir[i][2])
      const axisCap = Math.min(xy > 0 ? vXY / xy : Infinity, z > 0 ? vZ / z : Infinity)
      vmax[i] = Math.min(m.feed > 0 ? m.feed / 60 : vXY, axisCap)
    }
  }
  // junction speeds: vj[i] = speed at the start of move i (= end of move i-1)
  const vj = new Float64Array(n + 1)
  for (let i = 1; i < n; i++) {
    const p = moves[i - 1]
    const m = moves[i]
    if (m.kind !== 'feed' || p.kind !== 'feed' || p.stop || !(len[i] > 0) || !(len[i - 1] > 0)) continue
    const c = dir[i][0] * dir[i - 1][0] + dir[i][1] * dir[i - 1][1] + dir[i][2] * dir[i - 1][2]
    vj[i] = Math.min(vmax[i], vmax[i - 1]) * Math.max(0, c)
  }
  if (a > 0) {
    // the machine must be able to brake for what follows, and can only speed up so fast
    for (let i = n - 1; i >= 0; i--)
      if (moves[i].kind === 'feed') vj[i] = Math.min(vj[i], Math.sqrt(vj[i + 1] ** 2 + 2 * a * len[i]))
    for (let i = 0; i < n; i++)
      if (moves[i].kind === 'feed') vj[i + 1] = Math.min(vj[i + 1], Math.sqrt(vj[i] ** 2 + 2 * a * len[i]))
  }
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const m = moves[i]
    if (m.kind === 'rapid') {
      // each axis moves at its own limit; the slower one decides (rapids start and stop)
      const dxy = Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1])
      const dz = Math.abs(m.to[2] - m.from[2])
      out[i] = Math.max(profileTime(dxy, vXY, 0, 0, a), profileTime(dz, vZ, 0, 0, a))
    } else out[i] = a > 0 ? profileTime(len[i], vmax[i], vj[i], vj[i + 1], a) : len[i] / (vmax[i] || 1)
  }
  return out
}
