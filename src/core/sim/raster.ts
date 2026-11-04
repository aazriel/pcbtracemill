import type { Path, PolygonSet } from '../model/types'
import { IDENTITY_AFFINE, type Affine } from './affine'

export interface RasterGrid {
  nx: number
  ny: number
  /** mm per cell. */
  res: number
}

/**
 * Rasterises a PolygonSet into a cell mask (1 = inside) using a scanline fill with the NonZero
 * rule over all rings (outers and holes; holes have opposite orientation so they cancel).
 * A cell is filled when its centre is inside. `affine` maps polygon coordinates to grid XY
 * (e.g. the face's work→stock transform). Pure TS, no canvas.
 */
export function rasterizeCopperMask(
  polys: PolygonSet,
  grid: RasterGrid,
  affine: Affine = IDENTITY_AFFINE
): Uint8Array {
  const { nx, ny, res } = grid
  const out = new Uint8Array(nx * ny)
  // Per-row crossing lists: x positions and winding directions.
  const xs: number[][] = new Array(ny)
  const ws: number[][] = new Array(ny)
  for (let j = 0; j < ny; j++) {
    xs[j] = []
    ws[j] = []
  }
  const addRing = (ring: Path): void => {
    const n = ring.length
    if (n < 3) return
    for (let k = 0; k < n; k++) {
      const p = ring[k]
      const q = ring[(k + 1) % n]
      const x0 = affine[0] * p.x + affine[1] * p.y + affine[2]
      const y0 = affine[3] * p.x + affine[4] * p.y + affine[5]
      const x1 = affine[0] * q.x + affine[1] * q.y + affine[2]
      const y1 = affine[3] * q.x + affine[4] * q.y + affine[5]
      if (y0 === y1) continue
      const dir = y1 > y0 ? 1 : -1
      const ylo = Math.min(y0, y1)
      const yhi = Math.max(y0, y1)
      // Rows whose centre cy satisfies ylo ≤ cy < yhi (half-open avoids double counting vertices).
      const jStart = Math.max(0, Math.ceil(ylo / res - 0.5))
      const jEnd = Math.min(ny - 1, Math.ceil(yhi / res - 0.5) - 1)
      const slope = (x1 - x0) / (y1 - y0)
      for (let j = jStart; j <= jEnd; j++) {
        const cy = (j + 0.5) * res
        xs[j].push(x0 + (cy - y0) * slope)
        ws[j].push(dir)
      }
    }
  }
  for (const poly of polys) {
    addRing(poly.outer)
    for (const h of poly.holes) addRing(h)
  }
  for (let j = 0; j < ny; j++) {
    const rx = xs[j]
    const m = rx.length
    if (m < 2) continue
    const rw = ws[j]
    const order = new Array<number>(m)
    for (let k = 0; k < m; k++) order[k] = k
    order.sort((a, b) => rx[a] - rx[b])
    let wind = 0
    const base = j * nx
    for (let k = 0; k < m - 1; k++) {
      wind += rw[order[k]]
      if (wind === 0) continue
      const xa = rx[order[k]]
      const xb = rx[order[k + 1]]
      // Cells whose centre (i+0.5)·res lies in [xa, xb).
      const i0 = Math.max(0, Math.ceil(xa / res - 0.5))
      const i1 = Math.min(nx - 1, Math.ceil(xb / res - 0.5) - 1)
      for (let i = i0; i <= i1; i++) out[base + i] = 1
    }
  }
  return out
}
