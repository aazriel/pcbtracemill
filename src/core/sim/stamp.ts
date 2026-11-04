import type { Tool } from '../model/types'
import { toolRadiusAtHeight } from '../tools/geometry'
import type { Affine } from './affine'
import { getToolProfile, type ToolProfile } from './profile'
import {
  extendDirty,
  markChanged,
  MAT_COPPER,
  MAT_FR4,
  MAT_THROUGH,
  SIM_TILE,
  type CellRect,
  type SimStock
} from './stock'

export type Vec3 = [number, number, number]

export interface StampOptions {
  /** The opposite face. When given, cells cut through the board are also marked as air there. */
  other?: SimStock
  /** Maps THIS stock's XY to the other stock's XY (see `faceMirrorAffine`). Required with `other`. */
  toOther?: Affine
  /**
   * Sloped moves (ramps, helices) are split into pieces whose Z change is at most this value (mm);
   * each piece uses the tip Z at the closest point on that piece. Default max(res, 0.01).
   */
  maxDzPerPiece?: number
}

const EPS = 1e-6

interface Ctx {
  stock: SimStock
  profile: ProfileArrays
  other: SimStock | null
  toOther: Affine | null
  rx0: number
  ry0: number
  rx1: number
  ry1: number
  minTop: number
}

interface ProfileArrays {
  radius: number
  invStep: number
  n: number
  lut: Float64Array
}

function arrays(p: ToolProfile): ProfileArrays {
  return { radius: p.radius, invStep: 1 / p.step, n: p.n, lut: p.lut }
}

/**
 * Sweeps `tool` from `from` to `to` (both in THIS stock's coordinates; Z relative to this face's
 * copper top) and lowers the heightfield to the swept tool envelope:
 *   top[cell] = min(top[cell], tipZ(t*) + h(d))
 * where t* is the closest point of the XY segment to the cell centre, d the XY distance to it and
 * h the inverted tool profile. Updates `mat`, `dirty`, `minTop` and tile flags.
 *
 * Returns the rect of cells changed on `stock` (null when nothing changed).
 */
export function stampMove(
  stock: SimStock,
  from: Vec3,
  to: Vec3,
  tool: Tool,
  opts: StampOptions = {}
): CellRect | null {
  const zmin = Math.min(from[2], to[2])
  // The surface never rises above Z0, and h(d) ≥ 0: a tool tip at or above Z0 can't cut.
  if (!(zmin < 0)) return null
  if (!Number.isFinite(zmin)) return null
  const ctx: Ctx = {
    stock,
    profile: arrays(getToolProfile(tool, stock.res)),
    other: opts.other && opts.toOther ? opts.other : null,
    toOther: opts.other && opts.toOther ? opts.toOther : null,
    rx0: Infinity,
    ry0: Infinity,
    rx1: -Infinity,
    ry1: -Infinity,
    minTop: stock.minTop
  }
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  const L = Math.hypot(dx, dy)
  if (L < 1e-9) {
    stampPiece(ctx, tool, from[0], from[1], zmin, to[0], to[1], zmin)
  } else {
    const maxDz =
      opts.maxDzPerPiece && opts.maxDzPerPiece > 0 ? opts.maxDzPerPiece : Math.max(stock.res, 0.01)
    const pieces = Math.min(1024, Math.max(1, Math.ceil(Math.abs(dz) / maxDz - 1e-9)))
    let px = from[0]
    let py = from[1]
    let pz = from[2]
    for (let k = 1; k <= pieces; k++) {
      const f = k / pieces
      const qx = k === pieces ? to[0] : from[0] + dx * f
      const qy = k === pieces ? to[1] : from[1] + dy * f
      const qz = k === pieces ? to[2] : from[2] + dz * f
      stampPiece(ctx, tool, px, py, pz, qx, qy, qz)
      px = qx
      py = qy
      pz = qz
    }
  }
  stock.minTop = ctx.minTop
  if (ctx.rx1 < ctx.rx0) return null
  const rect = { x0: ctx.rx0, y0: ctx.ry0, x1: ctx.rx1 + 1, y1: ctx.ry1 + 1 }
  extendDirty(stock, rect.x0, rect.y0, rect.x1, rect.y1)
  return rect
}

function stampPiece(
  ctx: Ctx,
  tool: Tool,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number
): void {
  const zmin = Math.min(az, bz)
  if (!(zmin < 0)) return
  const stock = ctx.stock
  const pr = ctx.profile
  // Only the part of the cutter below Z0 can remove material.
  const reach = Math.min(pr.radius, toolRadiusAtHeight(tool, -zmin) + 1e-9)
  if (!(reach > 0)) return
  const R2 = reach * reach
  const res = stock.res
  const nx = stock.nx
  const ny = stock.ny
  const top = stock.top
  const mat = stock.mat
  const tiles = stock.tileTouched
  const tilesX = stock.tilesX
  const lut = pr.lut
  const invStep = pr.invStep
  const nLut = pr.n
  const cuLevel = -stock.copperThickness + EPS
  const throughLevel = -stock.thickness + EPS
  const other = ctx.other
  const toOther = ctx.toOther
  // A cell may reach the other face's surface when v + other.minTop ≤ -thickness.
  const checkLevel = other ? throughLevel - other.minTop : throughLevel

  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const L2 = dx * dx + dy * dy
  const L = Math.sqrt(L2)
  const invL2 = L2 > 1e-18 ? 1 / L2 : 0
  const ux = L > 1e-12 ? dx / L : 0
  const uy = L > 1e-12 ? dy / L : 0

  const yLo = Math.min(ay, by) - reach
  const yHi = Math.max(ay, by) + reach
  const j0 = Math.max(0, Math.ceil(yLo / res - 0.5))
  const j1 = Math.min(ny - 1, Math.floor(yHi / res - 0.5))
  let minTop = ctx.minTop

  for (let j = j0; j <= j1; j++) {
    const cy = (j + 0.5) * res
    // X interval where the capsule (segment ⊕ disc) intersects this row: hull of disc A, disc B, strip.
    let xl = Infinity
    let xr = -Infinity
    let t = cy - ay
    if (t * t <= R2) {
      const w = Math.sqrt(R2 - t * t)
      if (ax - w < xl) xl = ax - w
      if (ax + w > xr) xr = ax + w
    }
    t = cy - by
    if (t * t <= R2) {
      const w = Math.sqrt(R2 - t * t)
      if (bx - w < xl) xl = bx - w
      if (bx + w > xr) xr = bx + w
    }
    if (L > 1e-12) {
      const ry = cy - ay
      // proj(x) = ux·(x-ax) + uy·ry ∈ [0, L]; perp(x) = -uy·(x-ax) + ux·ry ∈ [-reach, reach]
      let sl = -Infinity
      let sr = Infinity
      let ok = true
      if (Math.abs(ux) > 1e-12) {
        const p0 = (0 - uy * ry) / ux
        const p1 = (L - uy * ry) / ux
        sl = Math.max(sl, Math.min(p0, p1))
        sr = Math.min(sr, Math.max(p0, p1))
      } else if (uy * ry < 0 || uy * ry > L) ok = false
      if (Math.abs(uy) > 1e-12) {
        const q0 = (-reach - ux * ry) / -uy
        const q1 = (reach - ux * ry) / -uy
        sl = Math.max(sl, Math.min(q0, q1))
        sr = Math.min(sr, Math.max(q0, q1))
      } else if (Math.abs(ux * ry) > reach) ok = false
      if (ok && sl <= sr) {
        if (ax + sl < xl) xl = ax + sl
        if (ax + sr > xr) xr = ax + sr
      }
    }
    if (!(xl <= xr)) continue
    const i0 = Math.max(0, Math.ceil(xl / res - 0.5) - 1)
    const i1 = Math.min(nx - 1, Math.floor(xr / res - 0.5) + 1)
    if (i0 > i1) continue
    let rowMin = Infinity
    let rowMax = -Infinity
    const rowBase = j * nx
    const ry = cy - ay
    for (let i = i0; i <= i1; i++) {
      const rx = (i + 0.5) * res - ax
      let tt = (rx * dx + ry * dy) * invL2
      if (tt < 0) tt = 0
      else if (tt > 1) tt = 1
      const px = rx - tt * dx
      const py = ry - tt * dy
      const d2 = px * px + py * py
      if (d2 > R2) continue
      const idx = rowBase + i
      const cur = top[idx]
      const z = az + tt * dz
      if (z >= cur) continue
      // h(d) from the LUT (linear interpolation).
      const f = Math.sqrt(d2) * invStep
      const k = f | 0
      let h: number
      if (k >= nLut) h = lut[nLut]
      else {
        const a = lut[k]
        const b = lut[k + 1]
        h = b === Infinity ? (f === k ? a : Infinity) : a + (b - a) * (f - k)
      }
      let v = z + h
      if (!(v < cur)) continue
      if (v <= checkLevel) {
        let through = v <= throughLevel
        if (!through && other && toOther) {
          const oc = otherCell(other, toOther, (i + 0.5) * res, cy)
          if (oc >= 0 && v + other.top[oc] <= throughLevel) through = true
        }
        if (through) {
          v = -stock.thickness
          mat[idx] = MAT_THROUGH
          if (other && toOther) markOtherThrough(other, toOther, (i + 0.5) * res, cy)
        } else if (mat[idx] === MAT_COPPER && v < cuLevel) mat[idx] = MAT_FR4
      } else if (mat[idx] === MAT_COPPER && v < cuLevel) mat[idx] = MAT_FR4
      top[idx] = v
      if (v < minTop) minTop = v
      if (i < rowMin) rowMin = i
      if (i > rowMax) rowMax = i
    }
    if (rowMin <= rowMax) {
      if (rowMin < ctx.rx0) ctx.rx0 = rowMin
      if (rowMax > ctx.rx1) ctx.rx1 = rowMax
      if (j < ctx.ry0) ctx.ry0 = j
      if (j > ctx.ry1) ctx.ry1 = j
      const tRow = ((j / SIM_TILE) | 0) * tilesX
      const t1 = (rowMax / SIM_TILE) | 0
      for (let tx = (rowMin / SIM_TILE) | 0; tx <= t1; tx++) tiles[tRow + tx] = 1
    }
  }
  ctx.minTop = minTop
}

/** Index of the cell of `other` containing the image of point (x, y), or -1 if outside. */
export function otherCell(other: SimStock, toOther: Affine, x: number, y: number): number {
  const ox = toOther[0] * x + toOther[1] * y + toOther[2]
  const oy = toOther[3] * x + toOther[4] * y + toOther[5]
  const i = Math.floor(ox / other.res)
  const j = Math.floor(oy / other.res)
  if (i < 0 || j < 0 || i >= other.nx || j >= other.ny) return -1
  return j * other.nx + i
}

/**
 * Cell index on the opposite face corresponding to cell (i, j) of `stock` (via the face-to-face
 * affine, mapping cell centres), or -1 when it falls outside the other stock.
 */
export function mirrorCell(stock: SimStock, other: SimStock, toOther: Affine, i: number, j: number): number {
  return otherCell(other, toOther, (i + 0.5) * stock.res, (j + 0.5) * stock.res)
}

function markOtherThrough(other: SimStock, toOther: Affine, x: number, y: number): void {
  const oc = otherCell(other, toOther, x, y)
  if (oc < 0) return
  if (other.mat[oc] === MAT_THROUGH) return
  other.mat[oc] = MAT_THROUGH
  other.top[oc] = -other.thickness
  if (-other.thickness < other.minTop) other.minTop = -other.thickness
  const i = oc % other.nx
  const j = (oc - i) / other.nx
  markChanged(other, i, j, i + 1, j + 1)
}
