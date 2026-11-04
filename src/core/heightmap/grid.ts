import type { HeightMap, ProbeGridConfig } from '../model/types'

export interface ProbePoint {
  x: number
  y: number
  z: number
}

export interface ProbeArea {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const DEFAULT_PROBE_FEED = 50
export const DEFAULT_PROBE_DEPTH = -2
export const DEFAULT_CLEARANCE_Z = 2

/** A probe grid covering `area` with roughly `spacing` mm between points (at least 2×2). */
export function defaultProbeGrid(area: ProbeArea, spacing = 10): ProbeGridConfig {
  const sp = spacing > 0 && Number.isFinite(spacing) ? spacing : 10
  const w = Math.max(0, area.maxX - area.minX)
  const h = Math.max(0, area.maxY - area.minY)
  return {
    minX: area.minX,
    minY: area.minY,
    maxX: area.minX + w,
    maxY: area.minY + h,
    countX: Math.max(2, Math.ceil(w / sp - 1e-9) + 1),
    countY: Math.max(2, Math.ceil(h / sp - 1e-9) + 1),
    probeFeed: DEFAULT_PROBE_FEED,
    probeDepth: DEFAULT_PROBE_DEPTH,
    clearanceZ: DEFAULT_CLEARANCE_Z
  }
}

export function gridStep(cfg: ProbeGridConfig): { dx: number; dy: number } {
  return {
    dx: cfg.countX > 1 ? (cfg.maxX - cfg.minX) / (cfg.countX - 1) : 0,
    dy: cfg.countY > 1 ? (cfg.maxY - cfg.minY) / (cfg.countY - 1) : 0
  }
}

/** Probe points in serpentine order: row 0 left→right, row 1 right→left, ... First point = (minX, minY). */
export function probePoints(cfg: ProbeGridConfig): { x: number; y: number; ix: number; iy: number }[] {
  const { dx, dy } = gridStep(cfg)
  const out: { x: number; y: number; ix: number; iy: number }[] = []
  for (let iy = 0; iy < cfg.countY; iy++) {
    for (let k = 0; k < cfg.countX; k++) {
      const ix = iy % 2 === 0 ? k : cfg.countX - 1 - k
      out.push({ x: cfg.minX + ix * dx, y: cfg.minY + iy * dy, ix, iy })
    }
  }
  return out
}

/** Cluster sorted values whose gaps are below `tol`; returns cluster means. */
function clusters(values: number[], tol: number): number[] {
  const s = [...values].sort((a, b) => a - b)
  const out: number[][] = []
  for (const v of s) {
    const cur = out[out.length - 1]
    if (cur && v - cur[cur.length - 1] <= tol) cur.push(v)
    else out.push([v])
  }
  return out.map((c) => c.reduce((a, b) => a + b, 0) / c.length)
}

function inferGrid(points: ProbePoint[]): ProbeGridConfig {
  const xs = clusters(
    points.map((p) => p.x),
    0.2
  )
  const ys = clusters(
    points.map((p) => p.y),
    0.2
  )
  if (xs.length < 2 || ys.length < 2)
    throw new Error('Probe data must cover a grid of at least 2 x 2 distinct points.')
  return {
    minX: xs[0],
    minY: ys[0],
    maxX: xs[xs.length - 1],
    maxY: ys[ys.length - 1],
    countX: xs.length,
    countY: ys.length,
    probeFeed: DEFAULT_PROBE_FEED,
    probeDepth: DEFAULT_PROBE_DEPTH,
    clearanceZ: DEFAULT_CLEARANCE_Z
  }
}

/**
 * Build a height map from probed points.
 *  - With `cfg`, points are snapped to the configured grid. If most points are off the grid
 *    (e.g. GRBL reports machine coordinates) the cloud is shifted so the first point lands on
 *    (minX, minY) - the first point of the serpentine probe program.
 *  - Without `cfg`, the grid is inferred from distinct X/Y values.
 *  - Z is normalised so the cell of the FIRST point is 0 (the user zeroes Z there).
 *  - Missing cells are filled by inverse-distance weighting of the measured cells.
 */
export function buildHeightMap(points: ProbePoint[], cfg?: ProbeGridConfig, source = 'probe'): HeightMap {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))
  if (pts.length === 0) throw new Error('No probe points to build a height map from.')
  const grid: ProbeGridConfig = cfg ? { ...cfg } : inferGrid(pts)
  if (grid.countX < 2 || grid.countY < 2) throw new Error('The probe grid needs at least 2 x 2 points.')
  const { dx, dy } = gridStep(grid)
  const tolX = dx > 0 ? dx * 0.3 : 0.1
  const tolY = dy > 0 ? dy * 0.3 : 0.1

  const onGrid = (x: number, y: number): boolean => {
    const fx = dx > 0 ? (x - grid.minX) / dx : 0
    const fy = dy > 0 ? (y - grid.minY) / dy : 0
    const ix = Math.round(fx)
    const iy = Math.round(fy)
    return (
      ix >= 0 &&
      iy >= 0 &&
      ix < grid.countX &&
      iy < grid.countY &&
      Math.abs(x - (grid.minX + ix * dx)) <= tolX &&
      Math.abs(y - (grid.minY + iy * dy)) <= tolY
    )
  }

  let shiftX = 0
  let shiftY = 0
  if (cfg) {
    const ok = pts.filter((p) => onGrid(p.x, p.y)).length
    if (ok < pts.length / 2) {
      shiftX = grid.minX - pts[0].x
      shiftY = grid.minY - pts[0].y
    }
  }

  const n = grid.countX * grid.countY
  const sum = new Array<number>(n).fill(0)
  const cnt = new Array<number>(n).fill(0)
  let firstCell = -1
  for (const p of pts) {
    const x = p.x + shiftX
    const y = p.y + shiftY
    if (!onGrid(x, y)) continue
    const ix = dx > 0 ? Math.round((x - grid.minX) / dx) : 0
    const iy = dy > 0 ? Math.round((y - grid.minY) / dy) : 0
    const k = iy * grid.countX + ix
    sum[k] += p.z
    cnt[k]++
    if (firstCell < 0) firstCell = k
  }
  if (firstCell < 0) throw new Error('None of the probe points match the probe grid.')

  const z = sum.map((s, k) => (cnt[k] ? s / cnt[k] : NaN))
  const ref = z[firstCell]
  for (let k = 0; k < n; k++) if (cnt[k]) z[k] -= ref

  // Inverse-distance-weighted fill for cells that were never probed.
  const known: { x: number; y: number; z: number }[] = []
  for (let k = 0; k < n; k++) {
    if (cnt[k]) known.push({ x: (k % grid.countX) * dx, y: Math.floor(k / grid.countX) * dy, z: z[k] })
  }
  for (let k = 0; k < n; k++) {
    if (cnt[k]) continue
    const x = (k % grid.countX) * dx
    const y = Math.floor(k / grid.countX) * dy
    let ws = 0
    let vs = 0
    for (const q of known) {
      const d2 = (q.x - x) ** 2 + (q.y - y) ** 2
      const w = 1 / Math.max(d2, 1e-12)
      ws += w
      vs += w * q.z
    }
    z[k] = vs / ws
  }
  return { config: grid, z, source }
}

/** Bilinear interpolation of the map at (x, y), clamped to the grid outside its area. */
export function sampleHeight(map: HeightMap, x: number, y: number): number {
  const c = map.config
  const { dx, dy } = gridStep(c)
  const fx = dx > 0 ? Math.min(c.countX - 1, Math.max(0, (x - c.minX) / dx)) : 0
  const fy = dy > 0 ? Math.min(c.countY - 1, Math.max(0, (y - c.minY) / dy)) : 0
  const ix = Math.min(c.countX - 2, Math.floor(fx))
  const iy = Math.min(c.countY - 2, Math.floor(fy))
  const tx = fx - ix
  const ty = fy - iy
  const at = (i: number, j: number): number => map.z[j * c.countX + i]
  const z0 = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx
  const z1 = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx
  return z0 * (1 - ty) + z1 * ty
}

export function heightMapStats(map: HeightMap): { min: number; max: number; range: number; mean: number } {
  if (!map.z.length) return { min: 0, max: 0, range: 0, mean: 0 }
  let min = Infinity
  let max = -Infinity
  let s = 0
  for (const v of map.z) {
    if (v < min) min = v
    if (v > max) max = v
    s += v
  }
  return { min, max, range: max - min, mean: s / map.z.length }
}
