import type { Tool } from '../model/types'
import { toolRadiusAtHeight } from '../tools/geometry'

/**
 * Inverted radial tool profile: `h(d)` = height above the tool tip at which the cutter reaches
 * radius `d` (the lowest point the tool cuts at horizontal distance `d` from its axis).
 * Sampled into a LUT so the inner stamping loop is a single interpolated lookup.
 *
 * Inversion is done numerically on `toolRadiusAtHeight` (the shared single source of truth),
 * so every tool type supported there (flat, ball, vbit, drill, corn) is supported here.
 */
export interface ToolProfile {
  /** Cutter radius (mm). Cells farther than this from the axis are never cut. */
  radius: number
  /** LUT step (mm). lut[k] = h(k·step), k = 0..n. */
  step: number
  n: number
  lut: Float64Array
}

const H_MAX = 200

function invertHeight(tool: Tool, d: number): number {
  if (toolRadiusAtHeight(tool, 0) >= d) return 0
  if (toolRadiusAtHeight(tool, H_MAX) < d - 1e-12) return Infinity
  let lo = 0
  let hi = H_MAX
  for (let it = 0; it < 64; it++) {
    const mid = 0.5 * (lo + hi)
    if (toolRadiusAtHeight(tool, mid) >= d) hi = mid
    else lo = mid
  }
  return hi
}

export function buildToolProfile(tool: Tool, res: number): ToolProfile {
  const radius = Math.max(1e-6, tool.geometry.diameter / 2)
  // ≥ 8 samples per cell, at least 64 samples total, at most 8192.
  const n = Math.min(8192, Math.max(64, Math.ceil((radius / res) * 8)))
  const step = radius / n
  const lut = new Float64Array(n + 1)
  for (let k = 0; k <= n; k++) lut[k] = invertHeight(tool, k === n ? radius : k * step)
  return { radius, step, n, lut }
}

const cache = new WeakMap<Tool, Map<number, ToolProfile>>()

/** Cached per (tool object, resolution). */
export function getToolProfile(tool: Tool, res: number): ToolProfile {
  let m = cache.get(tool)
  if (!m) {
    m = new Map()
    cache.set(tool, m)
  }
  let p = m.get(res)
  if (!p) {
    p = buildToolProfile(tool, res)
    m.set(res, p)
  }
  return p
}

/** h(d) by linear interpolation; Infinity beyond the radius. */
export function profileHeight(p: ToolProfile, d: number): number {
  if (d > p.radius) return Infinity
  const f = d / p.step
  const k = Math.floor(f)
  if (k >= p.n) return p.lut[p.n]
  const a = p.lut[k]
  const b = p.lut[k + 1]
  if (b === Infinity) return f === k ? a : Infinity
  return a + (b - a) * (f - k)
}
