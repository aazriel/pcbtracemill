/**
 * Simulation playback engine (UI thread side).
 *
 * The material removal runs in the sim worker; this module only:
 *  - drives program time (play / pause / speed / seek / markers),
 *  - serialises seek calls (never more than one in flight; the latest request wins),
 *  - uploads the dirty regions the worker returns to the WebGL textures of the matching face.
 *
 * UI-facing state lives in a small zustand store (`useSim`); heavy static data (moves, markers)
 * is stored once per loaded program in `useSim.getState().data`.
 */
import { create } from 'zustand'
import type { SimMarker } from '@core/pipeline/sim'
import type { Tool } from '@core/model/types'
import { simWorkerApi, type SimFieldInit, type SimInitRequest, type SimMoveData } from '@workers/index'
import type { SimFace, SimGL } from './SimGL'
import { stepColor, toolColor } from './colors'

export const SPEEDS = [1, 2, 5, 10, 20, 50, 100, 200] as const

export interface SimStepInfo {
  id: string
  name: string
  kind: string
  side: SimFace
  color: string
  /** Tools used by this step, in order of use. */
  toolIds: string[]
  /** Program time span. */
  t0: number
  t1: number
}

export interface SimToolInfo {
  id: string
  name: string
  color: string
  tool: Tool | null
}

export interface SimData {
  totalTime: number
  markers: SimMarker[]
  warnings: string[]
  moves: SimMoveData
  /** Start time of each G-code line (lines without motion take the next motion's time). */
  lineStart: Float64Array
  steps: SimStepInfo[]
  stepById: Map<string, SimStepInfo>
  tools: Map<string, SimToolInfo>
  faces: SimFace[]
  /** Work origin in stock coordinates (work = stock − origin). */
  origin: { x: number; y: number }
  stock: { width: number; height: number; thickness: number; copperThickness: number; res: number }
}

export interface SimState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  /** camVersion the loaded program belongs to. */
  version: number
  data: SimData | null
  /** Program time whose material state is displayed (s). */
  time: number
  /** Latest requested time (s) — leads `time` while the worker computes. */
  target: number
  playing: boolean
  speed: number
  /** A long seek (e.g. "jump to end") is being computed. */
  busy: boolean
  side: SimFace
  follow: boolean
  showTool: boolean
  showTrail: boolean
  showDesign: boolean
  showRapids: boolean
  /** 3D orbit view (true) or flat top view (false). */
  view3d: boolean
  /** Sun direction: azimuth (deg, counter-clockwise from +X) and elevation above the board (deg). */
  lightAz: number
  lightEl: number
  set(patch: Partial<SimState>): void
}

export const useSim = create<SimState>()((set) => ({
  status: 'idle',
  error: null,
  version: -1,
  data: null,
  time: 0,
  target: 0,
  playing: false,
  speed: 10,
  busy: false,
  side: 'top',
  follow: false,
  showTool: true,
  showTrail: true,
  showDesign: false,
  showRapids: false,
  view3d: true,
  lightAz: 130,
  lightEl: 50,
  set: (patch) => set(patch)
}))

// ───────────────────────────────────────── move helpers (pure, UI thread)

/** Index of the move active at `time` (first with tEnd > time; last when past the end). */
export function moveIndexAt(m: SimMoveData, time: number): number {
  const n = m.count
  if (!n) return -1
  if (time >= m.tEnd[n - 1]) return n - 1
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (m.tEnd[mid] > time) hi = mid
    else lo = mid + 1
  }
  return lo
}

export interface ToolState {
  index: number
  /** Stock coordinates of the face being machined + work Z. */
  x: number
  y: number
  z: number
  kind: 'rapid' | 'feed'
  /** Vertical-only motion: 'down' = plunging, 'up' = lifting, null = moving sideways. */
  vertical: 'down' | 'up' | null
  stepId: string | null
  toolId: string | null
  line: number
  side: SimFace
}

export function toolStateAt(d: SimData, time: number): ToolState | null {
  const m = d.moves
  const i = moveIndexAt(m, time)
  if (i < 0) return null
  const t0 = i > 0 ? m.tEnd[i - 1] : 0
  const t1 = m.tEnd[i]
  const f = t1 > t0 ? Math.min(1, Math.max(0, (time - t0) / (t1 - t0))) : time >= t1 ? 1 : 0
  const o = i * 6
  const stepId = m.step[i] >= 0 ? m.stepIds[m.step[i]] : null
  return {
    index: i,
    x: m.xyz[o] + (m.xyz[o + 3] - m.xyz[o]) * f,
    y: m.xyz[o + 1] + (m.xyz[o + 4] - m.xyz[o + 1]) * f,
    z: m.xyz[o + 2] + (m.xyz[o + 5] - m.xyz[o + 2]) * f,
    kind: m.kind[i] ? 'feed' : 'rapid',
    vertical:
      Math.hypot(m.xyz[o + 3] - m.xyz[o], m.xyz[o + 4] - m.xyz[o + 1]) > 1e-4
        ? null
        : m.xyz[o + 5] < m.xyz[o + 2]
          ? 'down'
          : m.xyz[o + 5] > m.xyz[o + 2]
            ? 'up'
            : null,
    stepId,
    toolId: m.tool[i] >= 0 ? m.toolIds[m.tool[i]] : null,
    line: m.line[i],
    side: (stepId && d.stepById.get(stepId)?.side) || 'top'
  }
}

export function lineAt(d: SimData, time: number): number {
  const i = moveIndexAt(d.moves, time)
  return i < 0 ? -1 : d.moves.line[i]
}

// ───────────────────────────────────────── data preparation

export interface LoadInput {
  request: SimInitRequest
  lineCount: number
  stepNames: Record<string, { name: string; kind: string }>
  tools: Tool[]
  origin: { x: number; y: number }
}

function buildData(
  init: Awaited<ReturnType<ReturnType<typeof simWorkerApi>['init']>>,
  input: LoadInput
): SimData {
  const m = init.moves
  // Line start times.
  const lineStart = new Float64Array(Math.max(1, input.lineCount)).fill(-1)
  for (let i = 0; i < m.count; i++) {
    const ln = m.line[i]
    if (ln >= 0 && ln < lineStart.length && lineStart[ln] < 0) lineStart[ln] = i > 0 ? m.tEnd[i - 1] : 0
  }
  let next = init.totalTime
  for (let i = lineStart.length - 1; i >= 0; i--) {
    if (lineStart[i] < 0) lineStart[i] = next
    else next = lineStart[i]
  }
  // Steps in order of appearance with their spans and tools.
  const steps: SimStepInfo[] = []
  const stepById = new Map<string, SimStepInfo>()
  for (let i = 0; i < m.count; i++) {
    const si = m.step[i]
    if (si < 0) continue
    const id = m.stepIds[si]
    let s = stepById.get(id)
    const t0 = i > 0 ? m.tEnd[i - 1] : 0
    if (!s) {
      const meta = input.stepNames[id]
      s = {
        id,
        name: meta?.name ?? 'Step',
        kind: meta?.kind ?? '',
        side: init.sides[id] ?? 'top',
        color: stepColor(steps.length),
        toolIds: [],
        t0,
        t1: m.tEnd[i]
      }
      steps.push(s)
      stepById.set(id, s)
    }
    s.t1 = m.tEnd[i]
    const ti = m.tool[i]
    if (ti >= 0 && m.kind[i]) {
      const tid = m.toolIds[ti]
      if (!s.toolIds.includes(tid)) s.toolIds.push(tid)
    }
  }
  const tools = new Map<string, SimToolInfo>()
  m.toolIds.forEach((id, k) => {
    const t = input.tools.find((x) => x.id === id) ?? null
    tools.set(id, { id, name: t ? `T${t.number} · ${t.name}` : id, color: toolColor(k), tool: t })
  })
  const anyField = init.fields.top ?? init.fields.bottom
  return {
    totalTime: init.totalTime,
    markers: init.markers,
    warnings: init.warnings,
    moves: m,
    lineStart,
    steps,
    stepById,
    tools,
    faces: (['top', 'bottom'] as SimFace[]).filter((f) => !!init.fields[f]),
    origin: input.origin,
    stock: {
      width: anyField?.width ?? 0,
      height: anyField?.height ?? 0,
      thickness: anyField?.thickness ?? 1.6,
      copperThickness: anyField?.copperThickness ?? 0.035,
      res: anyField?.res ?? 0.05
    }
  }
}

// ───────────────────────────────────────── engine

class SimEngine {
  private gl: SimGL | null = null
  private loadToken = 0
  private inflight = false
  private pending: number | null = null
  private raf = 0
  private lastWall = 0
  private busyTimer: ReturnType<typeof setTimeout> | null = null
  /** Set whenever the GL textures changed; the viewport clears it after drawing. */
  glDirty = true

  async load(version: number, input: LoadInput): Promise<void> {
    const token = ++this.loadToken
    this.pause()
    // Any seek still running belongs to the previous program; its result is discarded.
    this.inflight = false
    this.pending = null
    useSim.getState().set({ status: 'loading', error: null, version, data: null, time: 0, target: 0 })
    this.gl?.clearFaces()
    try {
      const init = await simWorkerApi().init(input.request)
      if (token !== this.loadToken) return
      const data = buildData(init, input)
      this.pending = null
      this.uploadFields(init.fields)
      const firstSide = data.steps[0]?.side ?? 'top'
      useSim.getState().set({ status: 'ready', data, time: 0, target: 0, side: firstSide })
      this.requestSeek(0)
    } catch (e) {
      if (token !== this.loadToken) return
      useSim.getState().set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Attach a renderer; when a program is already loaded its current state is fetched. */
  async attach(gl: SimGL): Promise<void> {
    this.gl = gl
    this.glDirty = true
    if (useSim.getState().status !== 'ready') return
    const token = this.loadToken
    const fields = await simWorkerApi().fields()
    if (token !== this.loadToken || this.gl !== gl) return
    this.uploadFields(fields)
  }

  detach(gl: SimGL): void {
    if (this.gl === gl) this.gl = null
    this.pause()
  }

  private uploadFields(fields: Partial<Record<SimFace, SimFieldInit>>): void {
    const gl = this.gl
    if (!gl) return
    for (const side of ['top', 'bottom'] as SimFace[]) {
      const f = fields[side]
      if (f) gl.setField(side, f)
    }
    this.glDirty = true
  }

  // ─────────── seeking

  /** Requests the material state at `t`; coalesces requests while the worker is busy. */
  requestSeek(t: number): void {
    const s = useSim.getState()
    if (s.status !== 'ready' || !s.data) return
    const tt = Math.max(0, Math.min(s.data.totalTime, t))
    this.pending = tt
    if (s.target !== tt) s.set({ target: tt })
    if (!this.inflight) void this.pump()
  }

  private async pump(): Promise<void> {
    this.inflight = true
    const token = this.loadToken
    try {
      while (this.pending !== null) {
        const t = this.pending
        this.pending = null
        const before = useSim.getState().time
        // A long jump may take a moment: show a spinner if it does.
        if (Math.abs(t - before) > 60 && !this.busyTimer)
          this.busyTimer = setTimeout(() => useSim.getState().set({ busy: true }), 250)
        const frame = await simWorkerApi().seek(t)
        if (token !== this.loadToken) return
        const gl = this.gl
        if (gl)
          for (const r of frame.regions) {
            if (!gl.hasFace(r.side)) continue
            gl.updateRect(r.side, r.x0, r.y0, r.x1, r.y1, r.top, r.mat)
          }
        if (frame.regions.length) this.glDirty = true
        const st = useSim.getState()
        const patch: Partial<SimState> = { time: t }
        if (st.follow && st.data) {
          const ts = toolStateAt(st.data, t)
          if (ts && ts.side !== st.side && st.data.faces.includes(ts.side)) {
            patch.side = ts.side
            this.glDirty = true
          }
        }
        st.set(patch)
      }
    } catch (e) {
      useSim.getState().set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      if (this.busyTimer) clearTimeout(this.busyTimer)
      this.busyTimer = null
      if (useSim.getState().busy) useSim.getState().set({ busy: false })
      if (token === this.loadToken) this.inflight = false
    }
  }

  // ─────────── playback

  play(): void {
    const s = useSim.getState()
    if (s.status !== 'ready' || !s.data || s.playing) return
    if (s.time >= s.data.totalTime - 1e-6) this.requestSeek(0)
    s.set({ playing: true })
    this.lastWall = performance.now()
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.tick)
  }

  pause(): void {
    cancelAnimationFrame(this.raf)
    if (useSim.getState().playing) useSim.getState().set({ playing: false })
  }

  toggle(): void {
    if (useSim.getState().playing) this.pause()
    else this.play()
  }

  private tick = (now: number): void => {
    const s = useSim.getState()
    if (!s.playing || !s.data) return
    if (!this.inflight) {
      const dt = Math.min(0.5, (now - this.lastWall) / 1000)
      this.lastWall = now
      const base = this.pending ?? s.target
      const t = Math.min(s.data.totalTime, base + dt * s.speed)
      this.requestSeek(t)
      if (t >= s.data.totalTime) {
        this.pause()
        return
      }
    }
    this.raf = requestAnimationFrame(this.tick)
  }

  setSpeed(speed: number): void {
    useSim.getState().set({ speed })
  }

  seek(t: number): void {
    this.requestSeek(t)
  }

  restart(): void {
    this.pause()
    this.requestSeek(0)
  }

  end(): void {
    this.pause()
    const d = useSim.getState().data
    if (d) this.requestSeek(d.totalTime)
  }

  /** Jumps to the previous (-1) / next (+1) timeline marker. */
  stepMarker(dir: -1 | 1): void {
    const s = useSim.getState()
    const d = s.data
    if (!d) return
    const times = [...new Set([0, ...d.markers.map((m) => m.t), d.totalTime])].sort((a, b) => a - b)
    const cur = s.target
    let t: number | undefined
    if (dir > 0) t = times.find((x) => x > cur + 1e-6)
    else t = [...times].reverse().find((x) => x < cur - 0.25)
    if (t === undefined) t = dir > 0 ? d.totalTime : 0
    this.requestSeek(t)
  }
}

export const simEngine = new SimEngine()
