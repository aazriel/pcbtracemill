/**
 * Heightfield stock model for the material-removal simulation.
 *
 * One `SimStock` represents ONE face of the copper-clad board seen from above (3-axis, top-down):
 *  - stock coordinates span 0..width × 0..height (mm),
 *  - Z0 is the top of this face's copper, copper occupies [-copperThickness, 0], FR4 continues to -thickness,
 *  - cell (i, j) covers [i·res, (i+1)·res) × [j·res, (j+1)·res); its centre is ((i+0.5)·res, (j+0.5)·res),
 *  - arrays are row-major: index = j·nx + i (j = 0 is the stock's min-Y row).
 *
 * Everything in a SimStock is structured-clone friendly (numbers, typed arrays, plain objects).
 */

/** Material exposed at the surface of a cell. */
export const MAT_COPPER = 0
export const MAT_FR4 = 1
/** Cut fully through the board (air). */
export const MAT_THROUGH = 2

/** Inclusive-exclusive cell rectangle: columns x0..x1-1, rows y0..y1-1. */
export interface CellRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Side length (cells) of the square tiles used for checkpoint bookkeeping. */
export const SIM_TILE = 64

export interface SimStock {
  nx: number
  ny: number
  /** mm per cell. */
  res: number
  width: number
  height: number
  thickness: number
  copperThickness: number
  /** Surface height per cell (mm, ≤ 0). Starts at 0. */
  top: Float32Array
  /** Material exposed at the surface per cell: MAT_COPPER / MAT_FR4 / MAT_THROUGH. */
  mat: Uint8Array
  /** Optional design copper mask (1 = copper in the design) for ghost / colouring. Never modified. */
  copperMask?: Uint8Array
  /** Bounding rect of cells changed since the last `takeDirty()`; null = nothing changed. */
  dirty: CellRect | null
  /** Deepest surface value present (≤ 0); used to detect through-cuts from both faces cheaply. */
  minTop: number
  /** Tile grid (SIM_TILE cells per side) used by the runner's copy-on-write checkpoints. */
  tilesX: number
  tilesY: number
  /** 1 for tiles touched since the runner last cleared the flags. */
  tileTouched: Uint8Array
}

export interface CreateStockOptions {
  width: number
  height: number
  thickness: number
  copperThickness: number
  /** mm per cell. Default: auto (see `chooseResolution`). */
  resolution?: number
  /** Design copper mask with nx·ny entries (e.g. from `rasterizeCopperMask`). */
  copperMask?: Uint8Array
  /** Cell budget for the automatic resolution. Default 4 000 000. */
  maxCells?: number
}

export const DEFAULT_MAX_CELLS = 4_000_000
export const MIN_AUTO_RESOLUTION = 0.02

/**
 * Picks a resolution: as fine as 0.02 mm, coarser if needed so the cell count stays ≤ maxCells.
 * The result is rounded up to a multiple of 0.005 mm for predictable cell sizes.
 */
export function chooseResolution(width: number, height: number, maxCells = DEFAULT_MAX_CELLS): number {
  const area = Math.max(width, 1e-3) * Math.max(height, 1e-3)
  let res = Math.max(MIN_AUTO_RESOLUTION, Math.sqrt(area / maxCells))
  res = Math.ceil(res / 0.005 - 1e-9) * 0.005
  while (Math.ceil(width / res) * Math.ceil(height / res) > maxCells) res += 0.005
  return res
}

export function createStock(opts: CreateStockOptions): SimStock {
  if (!(opts.width > 0 && opts.height > 0)) throw new Error('createStock: width and height must be > 0')
  if (!(opts.thickness > 0)) throw new Error('createStock: thickness must be > 0')
  const res =
    opts.resolution && opts.resolution > 0
      ? opts.resolution
      : chooseResolution(opts.width, opts.height, opts.maxCells)
  const nx = Math.max(1, Math.ceil(opts.width / res - 1e-9))
  const ny = Math.max(1, Math.ceil(opts.height / res - 1e-9))
  const n = nx * ny
  if (opts.copperMask && opts.copperMask.length !== n)
    throw new Error(`createStock: copperMask has ${opts.copperMask.length} cells, expected ${n}`)
  const tilesX = Math.ceil(nx / SIM_TILE)
  const tilesY = Math.ceil(ny / SIM_TILE)
  return {
    nx,
    ny,
    res,
    width: opts.width,
    height: opts.height,
    thickness: opts.thickness,
    copperThickness: Math.max(0, Math.min(opts.copperThickness, opts.thickness)),
    top: new Float32Array(n),
    mat: new Uint8Array(n),
    copperMask: opts.copperMask,
    dirty: null,
    minTop: 0,
    tilesX,
    tilesY,
    tileTouched: new Uint8Array(tilesX * tilesY)
  }
}

/** Returns the dirty rect accumulated since the previous call and clears it. */
export function takeDirty(stock: SimStock): CellRect | null {
  const d = stock.dirty
  stock.dirty = null
  return d
}

/** Extends the dirty rect and the touched tiles by an inclusive-exclusive cell rect (assumed clamped). */
export function markChanged(stock: SimStock, x0: number, y0: number, x1: number, y1: number): void {
  if (x1 <= x0 || y1 <= y0) return
  extendDirty(stock, x0, y0, x1, y1)
  const tx0 = Math.floor(x0 / SIM_TILE)
  const tx1 = Math.floor((x1 - 1) / SIM_TILE)
  const ty0 = Math.floor(y0 / SIM_TILE)
  const ty1 = Math.floor((y1 - 1) / SIM_TILE)
  for (let ty = ty0; ty <= ty1; ty++) {
    const row = ty * stock.tilesX
    for (let tx = tx0; tx <= tx1; tx++) stock.tileTouched[row + tx] = 1
  }
}

/** Extends only the dirty rect (no tile bookkeeping). */
export function extendDirty(stock: SimStock, x0: number, y0: number, x1: number, y1: number): void {
  if (x1 <= x0 || y1 <= y0) return
  const d = stock.dirty
  if (d) {
    if (x0 < d.x0) d.x0 = x0
    if (y0 < d.y0) d.y0 = y0
    if (x1 > d.x1) d.x1 = x1
    if (y1 > d.y1) d.y1 = y1
  } else stock.dirty = { x0, y0, x1, y1 }
}

/** Material code for a surface height. */
export function materialAt(stock: SimStock, z: number): number {
  if (z <= -stock.thickness + 1e-6) return MAT_THROUGH
  if (z < -stock.copperThickness + 1e-6) return MAT_FR4
  return MAT_COPPER
}

/** Resets the stock to uncut copper-clad and marks everything dirty. */
export function resetStock(stock: SimStock): void {
  stock.top.fill(0)
  stock.mat.fill(MAT_COPPER)
  stock.minTop = 0
  markChanged(stock, 0, 0, stock.nx, stock.ny)
}

/** Deep copy with fresh (transferable) arrays. The design mask is shared (read-only). */
export function cloneStock(stock: SimStock): SimStock {
  return {
    ...stock,
    top: stock.top.slice(),
    mat: stock.mat.slice(),
    dirty: stock.dirty ? { ...stock.dirty } : null,
    tileTouched: stock.tileTouched.slice()
  }
}

/** Region copy for incremental texture uploads: row-major (x1-x0)×(y1-y0). */
export interface StockRegion extends CellRect {
  top: Float32Array
  mat: Uint8Array
}

export function copyRegion(stock: SimStock, r: CellRect): StockRegion {
  const w = r.x1 - r.x0
  const h = r.y1 - r.y0
  const top = new Float32Array(w * h)
  const mat = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) {
    const src = (r.y0 + j) * stock.nx + r.x0
    top.set(stock.top.subarray(src, src + w), j * w)
    mat.set(stock.mat.subarray(src, src + w), j * w)
  }
  return { ...r, top, mat }
}

/** Writes a region back (used by the runner to undo partial moves). Marks it changed. */
export function writeRegion(stock: SimStock, reg: StockRegion): void {
  const w = reg.x1 - reg.x0
  const h = reg.y1 - reg.y0
  for (let j = 0; j < h; j++) {
    const dst = (reg.y0 + j) * stock.nx + reg.x0
    stock.top.set(reg.top.subarray(j * w, (j + 1) * w), dst)
    stock.mat.set(reg.mat.subarray(j * w, (j + 1) * w), dst)
  }
  markChanged(stock, reg.x0, reg.y0, reg.x1, reg.y1)
}
