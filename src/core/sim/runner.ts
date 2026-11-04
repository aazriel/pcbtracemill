import type { SimMove, Tool } from '../model/types'
import { faceMirrorAffine, invertAffine, type Affine } from './affine'
import { stampMove, type Vec3 } from './stamp'
import {
  cloneStock,
  copyRegion,
  extendDirty,
  resetStock,
  SIM_TILE,
  takeDirty,
  writeRegion,
  type CellRect,
  type SimStock,
  type StockRegion
} from './stock'
import { moveIndexAt, moveStart, positionInMove } from './trail'

export type SimSide = 'top' | 'bottom'

export interface SimRunnerOptions {
  /** Interpreted program, ordered by time (tEnd non-decreasing). Coordinates are WORK coordinates. */
  moves: SimMove[]
  /** Tools by id. Moves whose tool is unknown / null are not stamped (they still move the tool). */
  tools: Record<string, Tool>
  /** Side per CAM step id. Missing step ids (and null) are treated as 'top'. */
  sides: Record<string, SimSide>
  stockTop: SimStock
  stockBottom?: SimStock
  /** Work XY → stock XY of the face being machined, per side. */
  workToStock: { top: Affine; bottom: Affine }
  /**
   * Top-stock XY → bottom-stock XY of the same physical point (used to propagate through-cuts).
   * Default: `faceMirrorAffine(stockTop.width, stockTop.height, 'x')`.
   */
  topToBottom?: Affine
  /** Maximum number of checkpoints kept besides the pristine state. Default 12. */
  maxCheckpoints?: number
  /** Memory budget for checkpoint tile copies (bytes). Default 256 MiB. */
  checkpointBudgetBytes?: number
}

export interface ToolPosition {
  /** Work coordinates. */
  x: number
  y: number
  z: number
  /** Stock coordinates on the face being machined. */
  stockX: number
  stockY: number
  toolId: string | null
  stepId: string | null
  line: number
  side: SimSide
  moveIndex: number
  kind: SimMove['kind']
}

interface Tile {
  top: Float32Array
  mat: Uint8Array
}

type TileRefs = (Tile | null)[]

interface Checkpoint {
  /** Number of moves fully applied. */
  moveIndex: number
  time: number
  refs: { top: TileRefs; bottom: TileRefs | null }
  minTop: { top: number; bottom: number }
}

interface PartialUndo {
  moveIndex: number
  time: number
  top: StockRegion | null
  bottom: StockRegion | null
  minTop: { top: number; bottom: number }
}

/**
 * Drives the heightfield simulation through time. Pure TS — designed to live in a Web Worker.
 *
 * State model: moves [0, committed) are fully stamped; optionally one partial move is stamped on
 * top, with an undo copy of the region it could touch, so the committed state is always exactly
 * "full moves in order" — this makes seeking deterministic regardless of the seek history.
 *
 * Checkpoints: copy-on-write 64×64-cell tiles. A checkpoint stores, for every tile, a reference to
 * an immutable tile copy (or null = pristine). Creating a checkpoint copies only the tiles touched
 * since the previous checkpoint; untouched tiles share the previous checkpoint's copies. Restoring
 * writes back only tiles that differ. Checkpoints are taken every `total / maxCheckpoints` seconds
 * of program time; if the count or memory budget is exceeded every other checkpoint is dropped
 * and the interval doubles.
 */
export class SimRunner {
  readonly moves: SimMove[]
  readonly totalTime: number
  private readonly tools: Record<string, Tool>
  private readonly sides: Record<string, SimSide>
  private readonly stocks: { top: SimStock; bottom: SimStock | null }
  private readonly w2s: { top: Affine; bottom: Affine }
  private readonly faceMap: { top: Affine; bottom: Affine }
  private readonly maxCheckpoints: number
  private readonly budget: number
  private interval: number
  private committed = 0
  private time = Number.NaN
  private partial: PartialUndo | null = null
  private checkpoints: Checkpoint[]
  private refs: { top: TileRefs; bottom: TileRefs | null }

  constructor(opts: SimRunnerOptions) {
    this.moves = opts.moves
    this.tools = opts.tools
    this.sides = opts.sides
    this.stocks = { top: opts.stockTop, bottom: opts.stockBottom ?? null }
    this.w2s = opts.workToStock
    const t2b = opts.topToBottom ?? faceMirrorAffine(opts.stockTop.width, opts.stockTop.height, 'x')
    this.faceMap = { top: t2b, bottom: invertAffine(t2b) }
    this.maxCheckpoints = Math.max(1, opts.maxCheckpoints ?? 12)
    this.budget = opts.checkpointBudgetBytes ?? 256 * 1024 * 1024
    this.totalTime = this.moves.length ? Math.max(0, this.moves[this.moves.length - 1].tEnd) : 0
    this.interval = this.totalTime > 0 ? this.totalTime / this.maxCheckpoints : Infinity
    resetStock(opts.stockTop)
    if (opts.stockBottom) resetStock(opts.stockBottom)
    this.refs = {
      top: new Array<Tile | null>(opts.stockTop.tileTouched.length).fill(null),
      bottom: opts.stockBottom ? new Array<Tile | null>(opts.stockBottom.tileTouched.length).fill(null) : null
    }
    opts.stockTop.tileTouched.fill(0)
    opts.stockBottom?.tileTouched.fill(0)
    this.checkpoints = [
      {
        moveIndex: 0,
        time: 0,
        refs: { top: this.refs.top.slice(), bottom: this.refs.bottom?.slice() ?? null },
        minTop: { top: 0, bottom: 0 }
      }
    ]
  }

  /** Current simulated time (NaN before the first seek). */
  get currentTime(): number {
    return this.time
  }

  /** Direct access to a face's live stock (do not mutate). */
  stock(side: SimSide): SimStock | null {
    return side === 'top' ? this.stocks.top : this.stocks.bottom
  }

  /** Number of checkpoints currently held (including the pristine one) and their tile memory. */
  checkpointStats(): { count: number; bytes: number; interval: number } {
    return { count: this.checkpoints.length, bytes: this.liveBytes(), interval: this.interval }
  }

  /** Brings the stock to the state at `time` (clamped to [0, totalTime]). */
  seek(time: number): void {
    const t = Math.min(this.totalTime, Math.max(0, Number.isFinite(time) ? time : 0))
    if (t === this.time) return
    const moves = this.moves
    const n = moves.length
    // Number of moves fully completed at t.
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (moves[mid].tEnd <= t) lo = mid + 1
      else hi = mid
    }
    const target = lo
    this.undoPartial()
    let best = this.checkpoints[0]
    for (const c of this.checkpoints) if (c.moveIndex <= target && c.moveIndex > best.moveIndex) best = c
    if (target < this.committed || best.moveIndex > this.committed) this.restore(best)
    while (this.committed < target) {
      this.stampIndex(this.committed, 1)
      this.committed++
      this.afterCommit()
    }
    if (target < n && t > moveStart(moves, target)) this.stampPartial(target, t)
    this.time = t
  }

  /** Runs to the end of the program. */
  finish(): void {
    this.seek(this.totalTime)
  }

  /** Interpolated tool position at `time` (not necessarily the seeked time). Null for empty programs. */
  toolPosition(time: number): ToolPosition | null {
    const i = moveIndexAt(this.moves, time)
    if (i < 0) return null
    const m = this.moves[i]
    const p = positionInMove(this.moves, i, time)
    const side = this.sideOf(m)
    const a = this.w2s[side]
    return {
      x: p[0],
      y: p[1],
      z: p[2],
      stockX: a[0] * p[0] + a[1] * p[1] + a[2],
      stockY: a[3] * p[0] + a[4] * p[1] + a[5],
      toolId: m.toolId,
      stepId: m.stepId,
      line: m.line,
      side,
      moveIndex: i,
      kind: m.kind
    }
  }

  /** G-code line index of the move active at `time`, or -1. */
  currentLine(time: number): number {
    const i = moveIndexAt(this.moves, time)
    return i < 0 ? -1 : this.moves[i].line
  }

  /** Full transferable copy of one face (null if that face has no stock). */
  snapshot(side: SimSide): SimStock | null {
    const s = side === 'top' ? this.stocks.top : this.stocks.bottom
    return s ? cloneStock(s) : null
  }

  /** Copy of the cells changed on a face since the previous call (clears the dirty rect). */
  takeDirtyRegion(side: SimSide): StockRegion | null {
    const s = side === 'top' ? this.stocks.top : this.stocks.bottom
    if (!s) return null
    const r = takeDirty(s)
    return r ? copyRegion(s, r) : null
  }

  // ───────────────────────────────────────────── internals

  private sideOf(m: SimMove): SimSide {
    return (m.stepId !== null && this.sides[m.stepId]) || 'top'
  }

  private moveContext(i: number): { stock: SimStock; tool: Tool; side: SimSide } | null {
    const m = this.moves[i]
    const tool = m.toolId !== null ? this.tools[m.toolId] : undefined
    if (!tool) return null
    const side = this.sideOf(m)
    const stock = side === 'top' ? this.stocks.top : this.stocks.bottom
    if (!stock) return null
    return { stock, tool, side }
  }

  private stampIndex(i: number, fraction: number): void {
    const ctx = this.moveContext(i)
    if (!ctx) return
    const m = this.moves[i]
    const a = this.w2s[ctx.side]
    const fx = m.from[0]
    const fy = m.from[1]
    const tx = fraction >= 1 ? m.to[0] : fx + (m.to[0] - fx) * fraction
    const ty = fraction >= 1 ? m.to[1] : fy + (m.to[1] - fy) * fraction
    const tz = fraction >= 1 ? m.to[2] : m.from[2] + (m.to[2] - m.from[2]) * fraction
    const from: Vec3 = [a[0] * fx + a[1] * fy + a[2], a[3] * fx + a[4] * fy + a[5], m.from[2]]
    const to: Vec3 = [a[0] * tx + a[1] * ty + a[2], a[3] * tx + a[4] * ty + a[5], tz]
    const other = ctx.side === 'top' ? this.stocks.bottom : this.stocks.top
    stampMove(ctx.stock, from, to, ctx.tool, other ? { other, toOther: this.faceMap[ctx.side] } : {})
  }

  private stampPartial(i: number, time: number): void {
    const m = this.moves[i]
    const t0 = moveStart(this.moves, i)
    const f = m.tEnd > t0 ? Math.min(1, (time - t0) / (m.tEnd - t0)) : 1
    const undo: PartialUndo = {
      moveIndex: i,
      time,
      top: null,
      bottom: null,
      minTop: { top: this.stocks.top.minTop, bottom: this.stocks.bottom?.minTop ?? 0 }
    }
    const ctx = this.moveContext(i)
    if (ctx && Math.min(m.from[2], m.to[2]) < 0) {
      const a = this.w2s[ctx.side]
      const r = ctx.tool.geometry.diameter / 2 + 2 * ctx.stock.res
      const xs = [m.from[0], m.to[0]]
      const ys = [m.from[1], m.to[1]]
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const x of xs)
        for (const y of ys) {
          const sx = a[0] * x + a[1] * y + a[2]
          const sy = a[3] * x + a[4] * y + a[5]
          minX = Math.min(minX, sx)
          maxX = Math.max(maxX, sx)
          minY = Math.min(minY, sy)
          maxY = Math.max(maxY, sy)
        }
      const own = rectFor(ctx.stock, minX - r, minY - r, maxX + r, maxY + r)
      if (own) undo[ctx.side] = copyRegion(ctx.stock, own)
      const otherSide: SimSide = ctx.side === 'top' ? 'bottom' : 'top'
      const other = this.stocks[otherSide]
      if (other) {
        const fm = this.faceMap[ctx.side]
        let ominX = Infinity
        let ominY = Infinity
        let omaxX = -Infinity
        let omaxY = -Infinity
        for (const x of [minX - r, maxX + r])
          for (const y of [minY - r, maxY + r]) {
            const ox = fm[0] * x + fm[1] * y + fm[2]
            const oy = fm[3] * x + fm[4] * y + fm[5]
            ominX = Math.min(ominX, ox)
            omaxX = Math.max(omaxX, ox)
            ominY = Math.min(ominY, oy)
            omaxY = Math.max(omaxY, oy)
          }
        const or = rectFor(other, ominX, ominY, omaxX, omaxY)
        if (or) undo[otherSide] = copyRegion(other, or)
      }
      this.stampIndex(i, f)
    }
    this.partial = undo
  }

  private undoPartial(): void {
    const p = this.partial
    if (!p) return
    this.partial = null
    if (p.top) writeRegion(this.stocks.top, p.top)
    this.stocks.top.minTop = p.minTop.top
    if (this.stocks.bottom) {
      if (p.bottom) writeRegion(this.stocks.bottom, p.bottom)
      this.stocks.bottom.minTop = p.minTop.bottom
    }
  }

  private afterCommit(): void {
    const k = this.committed
    const last = this.checkpoints[this.checkpoints.length - 1]
    if (k <= last.moveIndex) {
      // Re-entering known territory: adopt an existing checkpoint's tile refs when we land on it.
      for (const c of this.checkpoints)
        if (c.moveIndex === k) {
          this.adopt(c)
          break
        }
      return
    }
    const t = this.moves[k - 1].tEnd
    if (t - last.time < this.interval || k >= this.moves.length) return
    this.createCheckpoint(k, t)
  }

  private adopt(c: Checkpoint): void {
    this.refs = { top: c.refs.top.slice(), bottom: c.refs.bottom?.slice() ?? null }
    this.stocks.top.tileTouched.fill(0)
    this.stocks.bottom?.tileTouched.fill(0)
  }

  private createCheckpoint(moveIndex: number, time: number): void {
    snapshotTiles(this.stocks.top, this.refs.top)
    if (this.stocks.bottom && this.refs.bottom) snapshotTiles(this.stocks.bottom, this.refs.bottom)
    this.checkpoints.push({
      moveIndex,
      time,
      refs: { top: this.refs.top.slice(), bottom: this.refs.bottom?.slice() ?? null },
      minTop: { top: this.stocks.top.minTop, bottom: this.stocks.bottom?.minTop ?? 0 }
    })
    while (
      this.checkpoints.length > this.maxCheckpoints + 1 ||
      (this.checkpoints.length > 2 && this.liveBytes() > this.budget)
    ) {
      // Keep the pristine one and the newest; drop every other one in between.
      const kept: Checkpoint[] = [this.checkpoints[0]]
      for (let i = 2; i < this.checkpoints.length - 1; i += 2) kept.push(this.checkpoints[i])
      kept.push(this.checkpoints[this.checkpoints.length - 1])
      if (kept.length === this.checkpoints.length) break
      this.checkpoints = kept
      this.interval *= 2
    }
  }

  private restore(c: Checkpoint): void {
    restoreTiles(this.stocks.top, this.refs.top, c.refs.top)
    this.stocks.top.minTop = c.minTop.top
    if (this.stocks.bottom && this.refs.bottom && c.refs.bottom) {
      restoreTiles(this.stocks.bottom, this.refs.bottom, c.refs.bottom)
      this.stocks.bottom.minTop = c.minTop.bottom
    }
    this.adopt(c)
    this.committed = c.moveIndex
  }

  private liveBytes(): number {
    const seen = new Set<Tile>()
    let bytes = 0
    const add = (refs: TileRefs | null): void => {
      if (!refs) return
      for (const t of refs)
        if (t && !seen.has(t)) {
          seen.add(t)
          bytes += t.top.byteLength + t.mat.byteLength
        }
    }
    for (const c of this.checkpoints) {
      add(c.refs.top)
      add(c.refs.bottom)
    }
    return bytes
  }
}

function rectFor(s: SimStock, minX: number, minY: number, maxX: number, maxY: number): CellRect | null {
  const x0 = Math.max(0, Math.floor(minX / s.res) - 1)
  const y0 = Math.max(0, Math.floor(minY / s.res) - 1)
  const x1 = Math.min(s.nx, Math.ceil(maxX / s.res) + 1)
  const y1 = Math.min(s.ny, Math.ceil(maxY / s.res) + 1)
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null
}

function tileRect(s: SimStock, t: number): CellRect {
  const tx = t % s.tilesX
  const ty = (t - tx) / s.tilesX
  const x0 = tx * SIM_TILE
  const y0 = ty * SIM_TILE
  return { x0, y0, x1: Math.min(s.nx, x0 + SIM_TILE), y1: Math.min(s.ny, y0 + SIM_TILE) }
}

/** Copies every touched tile into a fresh immutable Tile, updating `refs` in place; clears flags. */
function snapshotTiles(s: SimStock, refs: TileRefs): void {
  const touched = s.tileTouched
  for (let t = 0; t < touched.length; t++) {
    if (!touched[t]) continue
    const reg = copyRegion(s, tileRect(s, t))
    refs[t] = { top: reg.top, mat: reg.mat }
  }
  touched.fill(0)
}

/** Writes back tiles that may differ between the live state (`cur` + touched flags) and `target`. */
function restoreTiles(s: SimStock, cur: TileRefs, target: TileRefs): void {
  const touched = s.tileTouched
  for (let t = 0; t < touched.length; t++) {
    if (!touched[t] && cur[t] === target[t]) continue
    const r = tileRect(s, t)
    const w = r.x1 - r.x0
    const tile = target[t]
    for (let j = r.y0; j < r.y1; j++) {
      const dst = j * s.nx + r.x0
      if (tile) {
        const src = (j - r.y0) * w
        s.top.set(tile.top.subarray(src, src + w), dst)
        s.mat.set(tile.mat.subarray(src, src + w), dst)
      } else {
        s.top.fill(0, dst, dst + w)
        s.mat.fill(0, dst, dst + w)
      }
    }
    extendDirty(s, r.x0, r.y0, r.x1, r.y1)
  }
}
