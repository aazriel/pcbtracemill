/** Path ordering: greedy nearest neighbour (grid-accelerated) and bounded 2-opt. */
import type { Path, Vec2 } from '../model/types'
import { nearestVertexIndex, rotateRing } from './pathUtils'

/** Uniform grid of points tagged with an owner id, supporting "nearest live point" queries. */
class PointGrid {
  private readonly cells = new Map<number, number[]>()
  private readonly cell: number
  private readonly minX: number
  private readonly minY: number
  private readonly nx: number
  private readonly ny: number

  constructor(
    private readonly xs: Float64Array,
    private readonly ys: Float64Array,
    private readonly owner: Int32Array,
    private readonly alive: Uint8Array
  ) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < xs.length; i++) {
      minX = Math.min(minX, xs[i])
      minY = Math.min(minY, ys[i])
      maxX = Math.max(maxX, xs[i])
      maxY = Math.max(maxY, ys[i])
    }
    if (!isFinite(minX)) minX = minY = maxX = maxY = 0
    const w = maxX - minX
    const h = maxY - minY
    const n = Math.max(1, xs.length / 2)
    // ~2 points per cell for 2D spreads; collinear sets fall back to the long side; ≤ 1024 cells per axis
    this.cell = Math.max(Math.sqrt((w * h) / n), Math.max(w, h) / Math.max(n, 1), Math.max(w, h) / 1024, 1e-3)
    this.minX = minX
    this.minY = minY
    this.nx = Math.floor((maxX - minX) / this.cell) + 1
    this.ny = Math.floor((maxY - minY) / this.cell) + 1
    for (let i = 0; i < xs.length; i++) {
      const k = this.cellIndex(this.cx(xs[i]), this.cy(ys[i]))
      const l = this.cells.get(k)
      if (l) l.push(i)
      else this.cells.set(k, [i])
    }
  }

  private cx(x: number): number {
    return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.minX) / this.cell)))
  }
  private cy(y: number): number {
    return Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.minY) / this.cell)))
  }
  private cellIndex(ix: number, iy: number): number {
    return iy * this.nx + ix
  }

  /** Index of the nearest point whose owner is alive, or -1. */
  nearest(q: Vec2): number {
    const qx = this.cx(q.x)
    const qy = this.cy(q.y)
    let best = -1
    let bestD = Infinity
    const maxRing = Math.max(this.nx, this.ny)
    for (let ring = 0; ring <= maxRing; ring++) {
      // distance from q to any cell in this ring is at least (ring - 1) * cell
      if (best >= 0) {
        const lb = (ring - 1) * this.cell
        if (lb > 0 && lb * lb > bestD) break
      }
      const x0 = qx - ring
      const x1 = qx + ring
      const y0 = qy - ring
      const y1 = qy + ring
      for (let iy = y0; iy <= y1; iy++) {
        if (iy < 0 || iy >= this.ny) continue
        const edgeRow = iy === y0 || iy === y1
        for (let ix = x0; ix <= x1; ix += edgeRow ? 1 : x1 - x0 || 1) {
          if (ix < 0 || ix >= this.nx) continue
          const l = this.cells.get(this.cellIndex(ix, iy))
          if (!l) continue
          let w = 0
          for (let r = 0; r < l.length; r++) {
            const i = l[r]
            if (!this.alive[this.owner[i]]) continue
            l[w++] = i // compact dead entries lazily
            const d = (this.xs[i] - q.x) ** 2 + (this.ys[i] - q.y) ** 2
            if (d < bestD) {
              bestD = d
              best = i
            }
          }
          l.length = w
        }
      }
    }
    return best
  }
}

export interface OrderableItem {
  /** Points considered as possible entry points. */
  path: Path
  /** Closed loop: may be entered at any vertex (start is rotated). Open: only path[0] is an entry. */
  closed: boolean
}

/**
 * Greedy nearest-neighbour ordering. Closed loops are rotated to start at the vertex nearest to the
 * previous exit point (they also exit there). Open paths are never reversed (direction is meaningful
 * for climb/conventional milling). Returns reordered items and the final position.
 */
export function orderPaths<T extends OrderableItem>(items: T[], start: Vec2): { items: T[]; end: Vec2 } {
  if (items.length === 0) return { items: [], end: start }
  // Sample up to 48 candidate vertices per item for the grid; the exact entry vertex is refined later.
  const xsArr: number[] = []
  const ysArr: number[] = []
  const own: number[] = []
  items.forEach((it, idx) => {
    const p = it.path
    if (!it.closed) {
      xsArr.push(p[0].x)
      ysArr.push(p[0].y)
      own.push(idx)
      return
    }
    const stride = Math.max(1, Math.floor(p.length / 48))
    for (let i = 0; i < p.length; i += stride) {
      xsArr.push(p[i].x)
      ysArr.push(p[i].y)
      own.push(idx)
    }
  })
  const alive = new Uint8Array(items.length).fill(1)
  const owner = Int32Array.from(own)
  const grid = new PointGrid(Float64Array.from(xsArr), Float64Array.from(ysArr), owner, alive)
  const out: T[] = []
  let pos = start
  for (let n = 0; n < items.length; n++) {
    const pi = grid.nearest(pos)
    if (pi < 0) break
    const idx = owner[pi]
    alive[idx] = 0
    const it = items[idx]
    if (it.closed) {
      const vi = nearestVertexIndex(it.path, pos)
      const path = rotateRing(it.path, vi)
      out.push({ ...it, path })
      pos = path[0]
    } else {
      out.push(it)
      pos = it.path[it.path.length - 1]
    }
  }
  return { items: out, end: pos }
}

/**
 * Order points for drilling: nearest neighbour from `start`, then 2-opt improvement (open tour with
 * fixed start) bounded by `maxPasses` sweeps and a ~`budgetMs` time budget. Returns index order.
 */
export function orderPoints(points: Vec2[], start: Vec2, maxPasses = 25, budgetMs = 250): number[] {
  const n = points.length
  if (n === 0) return []
  const xs = Float64Array.from(points.map((p) => p.x))
  const ys = Float64Array.from(points.map((p) => p.y))
  const alive = new Uint8Array(n).fill(1)
  const owner = Int32Array.from({ length: n }, (_, i) => i)
  const grid = new PointGrid(xs, ys, owner, alive)
  const tour: number[] = []
  let pos = start
  for (let k = 0; k < n; k++) {
    const i = grid.nearest(pos)
    alive[i] = 0
    tour.push(i)
    pos = points[i]
  }
  if (n < 3) return tour
  const d = (a: number, b: number): number =>
    a < 0 ? Math.hypot(start.x - xs[b], start.y - ys[b]) : Math.hypot(xs[a] - xs[b], ys[a] - ys[b])
  const t0 = Date.now()
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false
    for (let i = 0; i < n - 1; i++) {
      const a = i === 0 ? -1 : tour[i - 1]
      const b = tour[i]
      const dab = d(a, b)
      for (let j = i + 1; j < n; j++) {
        const c = tour[j]
        const e = j + 1 < n ? tour[j + 1] : -2
        const before = dab + (e === -2 ? 0 : d(c, e))
        const after = d(a, c) + (e === -2 ? 0 : d(b, e))
        if (after < before - 1e-9) {
          // reverse tour[i..j]
          for (let l = i, r = j; l < r; l++, r--) {
            const t = tour[l]
            tour[l] = tour[r]
            tour[r] = t
          }
          improved = true
          break
        }
      }
      if (Date.now() - t0 > budgetMs) return tour
    }
    if (!improved) break
  }
  return tour
}
