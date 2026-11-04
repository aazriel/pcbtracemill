import type { GcodeLineMeta, MachineProfile, Move, Tool, ToolpathSegment } from '../model/types'
import { arcPoints } from '../geometry'
import type { PostOptions } from './dialects'
import { fmtNum, sanitizeComment } from './format'

const EPS = 1e-6
const INCH = 25.4
/** Chordal tolerance used when arcs must be linearised for the controller (mm). */
const LINEARIZE_TOL = 0.005

interface Pos {
  x: number | null
  y: number | null
  z: number | null
}

type DrillInfo = NonNullable<ToolpathSegment['drill']>

/**
 * Line-oriented G-code writer that tracks machine state so the safety rules hold:
 *  - Z is raised to safe height before any XY rapid,
 *  - the spindle is running before any cutting move,
 *  - rapids never descend below the copper (they become plunges).
 * All inputs are mm; unit conversion happens at formatting time.
 */
export class ProgramWriter {
  readonly lines: string[] = []
  readonly meta: { stepId: string | null; toolId: string | null }[] = []
  private ctx: { stepId: string | null; toolId: string | null } = { stepId: null, toolId: null }
  private pos: Pos = { x: null, y: null, z: null }
  private lastFeed: string | null = null
  spindleRpm: number | null = null
  tool: Tool | null = null

  constructor(
    readonly opts: PostOptions,
    readonly machine: MachineProfile
  ) {}

  /** Z at or above which XY rapids are allowed without an extra lift. */
  get clearZ(): number {
    const t = this.machine.travelZ
    return t > 0 ? Math.min(t, this.machine.safeZ) : this.machine.safeZ
  }

  setContext(stepId: string | null, toolId: string | null): void {
    this.ctx = { stepId, toolId }
  }

  // ───────────────────────────────────────────── formatting

  len(mm: number): string {
    return fmtNum(this.opts.inch ? mm / INCH : mm, this.opts.decimals)
  }

  feedWord(mmPerMin: number): string {
    const v = this.opts.inch ? mmPerMin / INCH : mmPerMin
    return fmtNum(v, this.opts.inch ? 2 : 1)
  }

  commentText(text: string): string {
    const t = sanitizeComment(text)
    return this.opts.comment === 'parens' ? `(${t})` : `; ${t}`
  }

  /** Push one raw line under the current context. */
  raw(line: string): void {
    this.lines.push(line)
    this.meta.push({ ...this.ctx })
  }

  comment(text: string): void {
    this.raw(this.commentText(text))
  }

  /** Code followed by an inline comment, e.g. "M0 (Insert tool)". */
  codeWithComment(code: string, text: string): void {
    this.raw(`${code} ${this.commentText(text)}`)
  }

  // ───────────────────────────────────────────── state helpers

  /** Forget the position (after a manual intervention). */
  invalidatePosition(): void {
    this.pos = { x: null, y: null, z: null }
    this.lastFeed = null
  }

  get z(): number | null {
    return this.pos.z
  }

  private axisWords(x: number | null, y: number | null, z: number | null, force = false): string[] {
    const w: string[] = []
    if (x !== null && (force || this.pos.x === null || this.len(x) !== this.len(this.pos.x)))
      w.push(`X${this.len(x)}`)
    if (y !== null && (force || this.pos.y === null || this.len(y) !== this.len(this.pos.y)))
      w.push(`Y${this.len(y)}`)
    if (z !== null && (force || this.pos.z === null || this.len(z) !== this.len(this.pos.z)))
      w.push(`Z${this.len(z)}`)
    return w
  }

  private setPos(x: number | null, y: number | null, z: number | null): void {
    if (x !== null) this.pos.x = x
    if (y !== null) this.pos.y = y
    if (z !== null) this.pos.z = z
  }

  private feedFor(xyMove: boolean, requested: number | undefined): number {
    const t = this.tool
    let f = requested ?? (xyMove ? (t?.feeds.feedXY ?? 0) : (t?.feeds.feedZ ?? 0))
    const max = xyMove ? this.machine.maxFeedXY : this.machine.maxFeedZ
    if (max > 0 && f > max) f = max
    if (!(f > 0)) f = xyMove ? (t?.feeds.feedXY ?? 100) : (t?.feeds.feedZ ?? 50)
    return f
  }

  private feedSuffix(f: number): string[] {
    const fw = this.feedWord(f)
    if (fw === this.lastFeed) return []
    this.lastFeed = fw
    return [`F${fw}`]
  }

  // ───────────────────────────────────────────── spindle

  spindleOn(rpm: number): void {
    const { spindleMin, spindleMax } = this.machine
    let s = rpm
    if (spindleMax > 0) s = Math.min(spindleMax, s)
    if (spindleMin > 0) s = Math.max(spindleMin, s)
    s = Math.round(s)
    if (this.spindleRpm === s) return
    const wasOff = this.spindleRpm === null
    this.raw(this.opts.spindleSpeed ? `M3 S${s}` : 'M3')
    this.spindleRpm = s
    if (wasOff && this.opts.spinUpSec > 0) this.raw(`G4 P${fmtNum(this.opts.spinUpSec, 2)}`)
  }

  /** M5 (skipped when already off unless `force`). */
  spindleOff(force = false): void {
    if (this.spindleRpm === null && !force) return
    this.raw('M5')
    this.spindleRpm = null
  }

  private ensureSpindle(): void {
    if (this.spindleRpm === null) this.spindleOn(this.tool?.feeds.spindleRpm ?? this.machine.spindleMax)
  }

  // ───────────────────────────────────────────── motion primitives

  /** Rapid Z only (no safety logic; caller guarantees direction is safe). */
  rapidZ(z: number): void {
    const w = this.axisWords(null, null, z)
    if (!w.length) return
    this.raw(`G0 ${w.join(' ')}`)
    this.setPos(null, null, z)
  }

  /** Raise to at least `z` (never lowers). Unknown Z is always raised. */
  liftTo(z: number): void {
    if (this.pos.z === null || this.pos.z < z - EPS) {
      this.raw(`G0 Z${this.len(z)}`)
      this.setPos(null, null, z)
    }
  }

  /** Safe rapid to (x,y,z): lift first, travel at height, then descend (plunge into material). */
  rapidTo(x: number, y: number, z: number): void {
    const xyChange =
      this.pos.x === null ||
      this.pos.y === null ||
      Math.abs(this.pos.x - x) > EPS ||
      Math.abs(this.pos.y - y) > EPS
    if (xyChange) {
      if (this.pos.z === null || this.pos.z < this.clearZ - EPS) {
        this.liftTo(Math.max(z, this.machine.safeZ))
      } else if (z > this.pos.z + EPS) {
        this.liftTo(z)
      }
      const w = this.axisWords(x, y, null)
      if (w.length) this.raw(`G0 ${w.join(' ')}`)
      this.setPos(x, y, null)
    }
    this.descendTo(z)
  }

  /** Z-only move to z; downward into material (z < 0) becomes a G1 plunge. */
  private descendTo(z: number, feed?: number): void {
    const cur = this.pos.z
    if (cur !== null && Math.abs(cur - z) <= EPS) return
    if (cur === null || z > cur) {
      this.rapidZ(z)
      return
    }
    if (z > 0) {
      this.rapidZ(z)
      return
    }
    // Never rapid into material: rapid down to clearance height, then feed.
    if (cur > this.clearZ && this.clearZ >= 0) this.rapidZ(this.clearZ)
    this.linear(null, null, z, feed)
  }

  linear(x: number | null, y: number | null, z: number | null, feed?: number): void {
    if (x !== null && y !== null && (this.pos.x === null || this.pos.y === null)) {
      // Unknown XY (start of program / after a pause): never feed from an unknown place.
      this.rapidTo(x, y, Math.max(this.clearZ, z ?? this.clearZ))
    }
    this.ensureSpindle()
    const xy =
      (x !== null && (this.pos.x === null || Math.abs(this.pos.x - x) > EPS)) ||
      (y !== null && (this.pos.y === null || Math.abs(this.pos.y - y) > EPS))
    const w = this.axisWords(x, y, z)
    if (!w.length) return
    const f = this.feedFor(xy, feed)
    this.raw(['G1', ...w, ...this.feedSuffix(f)].join(' '))
    this.setPos(x, y, z)
  }

  arc(m: Move): void {
    const cw = m.kind === 'arc-cw'
    if (
      this.pos.x === null ||
      this.pos.y === null ||
      this.pos.z === null ||
      m.cx === undefined ||
      m.cy === undefined
    ) {
      this.linear(m.x, m.y, m.z, m.feed)
      return
    }
    this.ensureSpindle()
    const sx = this.pos.x
    const sy = this.pos.y
    const sz = this.pos.z
    if (this.opts.arcs) {
      const f = this.feedFor(true, m.feed)
      const w = [cw ? 'G2' : 'G3']
      const end = this.axisWords(m.x, m.y, m.z)
      // A full circle has no changed X/Y words; keep X/Y explicit for clarity.
      if (!end.some((e) => e.startsWith('X'))) end.unshift(`X${this.len(m.x)}`)
      if (!end.some((e) => e.startsWith('Y'))) end.splice(1, 0, `Y${this.len(m.y)}`)
      w.push(...end, `I${this.len(m.cx - sx)}`, `J${this.len(m.cy - sy)}`, ...this.feedSuffix(f))
      this.raw(w.join(' '))
      this.setPos(m.x, m.y, m.z)
      return
    }
    const pts = arcPoints({ x: sx, y: sy }, { x: m.x, y: m.y }, { x: m.cx, y: m.cy }, cw, LINEARIZE_TOL)
    const n = pts.length - 1
    for (let k = 1; k <= n; k++) {
      this.linear(pts[k].x, pts[k].y, sz + ((m.z - sz) * k) / n, m.feed)
    }
  }

  dwell(sec: number): void {
    if (sec > 0) this.raw(`G4 P${fmtNum(sec, 2)}`)
  }

  /** Emit one toolpath move following the safety rules. */
  move(m: Move): void {
    switch (m.kind) {
      case 'rapid':
        this.rapidTo(m.x, m.y, m.z)
        break
      case 'retract':
        if (m.feed !== undefined && m.z >= (this.pos.z ?? -Infinity)) this.linear(m.x, m.y, m.z, m.feed)
        else this.rapidTo(m.x, m.y, m.z)
        break
      case 'plunge':
      case 'feed':
        this.linear(m.x, m.y, m.z, m.feed)
        break
      case 'arc-cw':
      case 'arc-ccw':
        this.arc(m)
        break
      case 'dwell':
        this.dwell(m.seconds ?? 0)
        break
    }
  }

  // ───────────────────────────────────────────── canned drilling

  /** Emit a run of drill cycles (G81 / G83 with G98 retract to the initial level), then G80. */
  drillCycles(drills: DrillInfo[]): void {
    if (!drills.length) return
    this.ensureSpindle()
    const maxR = Math.max(...drills.map((d) => d.retract))
    this.liftTo(Math.max(this.clearZ, maxR))
    const initialZ = this.pos.z ?? this.machine.safeZ
    let last: string | null = null
    let first = true
    for (const d of drills) {
      const peck = d.peck > 0 && d.peck < Math.abs(d.depth)
      const code = peck ? 'G83' : 'G81'
      const f = this.feedFor(false, d.feed)
      const params = [
        `Z${this.len(-Math.abs(d.depth))}`,
        `R${this.len(d.retract)}`,
        ...(peck ? [`Q${this.len(d.peck)}`] : []),
        `F${this.feedWord(f)}`
      ]
      const key = `${code} ${params.join(' ')}`
      const xy = [`X${this.len(d.x)}`, `Y${this.len(d.y)}`]
      if (key !== last) {
        this.raw([...(first ? ['G98'] : []), code, ...xy, ...params].join(' '))
        this.lastFeed = this.feedWord(f)
        last = key
      } else {
        this.raw(xy.join(' '))
      }
      first = false
      this.setPos(d.x, d.y, initialZ)
    }
    this.raw('G80')
  }

  lineMeta(): GcodeLineMeta[] {
    return this.meta.map((m, i) => ({ line: i, stepId: m.stepId, toolId: m.toolId }))
  }
}
