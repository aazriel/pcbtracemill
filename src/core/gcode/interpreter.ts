import type { GcodeLineMeta, SimMove } from '../model/types'
import { arcPoints } from '../geometry'
import { tokenizeLine } from './tokenize'

export interface InterpretOptions {
  /** Per-line metadata (from a post) to tag moves with tool/step ids. */
  lineMeta?: GcodeLineMeta[]
  /** Start position in mm. Default [0,0,0]. */
  initial?: [number, number, number]
  /** Rapid rate used for time estimation, mm/min. Default 3000. */
  rapidFeed?: number
  /** Chordal tolerance for arc linearisation, mm. Default 0.01. */
  arcTolerance?: number
}

export interface InterpretBounds {
  min: [number, number, number]
  max: [number, number, number]
}

export interface InterpretResult {
  /** Motion in mm (inch programs are converted), one entry per straight piece. */
  moves: SimMove[]
  totalSeconds: number
  bounds: InterpretBounds
  warnings: string[]
  /** 0-based line indexes of M6 tool changes. */
  toolChanges: { line: number; tool: number }[]
  /** 0-based line indexes of M0/M1 program pauses with their comment (if any). */
  pauses: { line: number; comment: string }[]
}

type Motion = 0 | 1 | 2 | 3 | 38.2 | 31 | 80 | 81 | 82 | 83
type Vec3 = [number, number, number]

const DEFAULT_RAPID = 3000
const INCH = 25.4
/** LinuxCNC-style clearance above the previous peck depth when re-entering a G83 hole (mm). */
const PECK_CLEARANCE = 0.254

const codeKey = (v: number): number => Math.round(v * 10) / 10

/**
 * Interpret a G-code program into straight-line motion for simulation, bounds and time
 * estimation. Arcs and canned cycles are expanded; every expanded piece keeps the line
 * index it originated from.
 */
export function interpretGcode(text: string, opts: InterpretOptions = {}): InterpretResult {
  const rapidFeed = opts.rapidFeed && opts.rapidFeed > 0 ? opts.rapidFeed : DEFAULT_RAPID
  const arcTol = opts.arcTolerance && opts.arcTolerance > 0 ? opts.arcTolerance : 0.01
  const metaByLine = new Map<number, GcodeLineMeta>()
  for (const m of opts.lineMeta ?? []) metaByLine.set(m.line, m)

  const moves: SimMove[] = []
  const warnings: string[] = []
  const toolChanges: { line: number; tool: number }[] = []
  const pauses: { line: number; comment: string }[] = []
  const warnedOnce = new Set<string>()
  const warnOnce = (key: string, msg: string): void => {
    if (warnedOnce.has(key)) return
    warnedOnce.add(key)
    warnings.push(msg)
  }

  // Modal state (lengths stored in mm).
  let pos: Vec3 = opts.initial ? [...opts.initial] : [0, 0, 0]
  let scale = 1 // program units → mm
  let absolute = true
  let arcAbsolute = false
  let plane: 17 | 18 | 19 = 17
  let motion: Motion = 0
  let feed = 0 // mm/min
  let tool = 0
  let spindleOn = false
  let retractToInitial = true // G98
  const cycle = { z: 0, r: 0, q: 0, p: 0 } // mm / seconds, absolute values
  let time = 0
  let lastCommentOnlyText = ''

  const lines = text.split(/\r?\n/)

  const push = (line: number, kind: 'rapid' | 'feed', to: Vec3, f: number): void => {
    const from = pos
    const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])
    if (len < 1e-9) {
      pos = to
      return
    }
    let rate = kind === 'rapid' ? rapidFeed : f
    if (kind === 'feed' && !(rate > 0)) {
      warnOnce('nofeed', `Line ${line + 1}: feed move without a feed rate (F); estimated at rapid rate`)
      rate = rapidFeed
    }
    time += (len / rate) * 60
    const meta = metaByLine.get(line)
    moves.push({
      line,
      kind,
      from,
      to,
      feed: kind === 'rapid' ? rapidFeed : rate,
      toolId: meta?.toolId ?? null,
      stepId: meta?.stepId ?? null,
      tEnd: time
    })
    pos = to
  }

  const checkSpindle = (line: number): void => {
    if (!spindleOn) warnOnce('spindle', `Line ${line + 1}: cutting move while the spindle is off`)
  }

  // G-code parameters (#500 = ...). Values the program reads but never sets (probe results such as
  // #5213, heights left by a probe program) count as 0, so moves land on the nominal Z.
  const params = new Map<number, number>()
  for (let li = 0; li < lines.length; li++) {
    const tok = tokenizeLine(lines[li], params)
    for (const e of tok.errors) warnings.push(`Line ${li + 1}: ${e}`)
    for (const a of tok.assigns) params.set(a.param, a.value)
    if (tok.words.length === 0) {
      if (tok.comments.length) lastCommentOnlyText = tok.comments.join(' ')
      continue
    }
    const lineComment = tok.comments.join(' ')
    const gs: number[] = []
    const ms: number[] = []
    const w: Record<string, number> = {}
    for (const word of tok.words) {
      if (word.letter === 'G') gs.push(codeKey(word.value))
      else if (word.letter === 'M') ms.push(Math.round(word.value))
      else if (word.letter !== 'N') {
        if (word.letter in w) warnings.push(`Line ${li + 1}: duplicate ${word.letter} word`)
        w[word.letter] = word.value
      }
    }

    // 1. Units and other non-motion modal codes.
    let nonMotionAxisUser = false
    let motionThisLine: Motion | null = null
    for (const g of gs) {
      switch (g) {
        case 20:
          scale = INCH
          break
        case 21:
          scale = 1
          break
        case 90:
          absolute = true
          break
        case 91:
          absolute = false
          break
        case 90.1:
          arcAbsolute = true
          break
        case 91.1:
          arcAbsolute = false
          break
        case 17:
        case 18:
        case 19:
          plane = g
          if (g !== 17) warnOnce('plane', `Line ${li + 1}: only the XY plane (G17) is supported for arcs`)
          break
        case 98:
          retractToInitial = true
          break
        case 99:
          retractToInitial = false
          break
        case 0:
        case 1:
        case 2:
        case 3:
        case 80:
        case 81:
        case 82:
        case 83:
        case 31:
        case 38.2:
          motionThisLine = g as Motion
          break
        case 38.3:
        case 38.4:
        case 38.5:
          motionThisLine = 38.2
          break
        case 4:
        case 10:
        case 28:
        case 30:
        case 92:
        case 92.1:
          nonMotionAxisUser = true
          break
        case 93:
          warnOnce('g93', `Line ${li + 1}: inverse time feed (G93) is not supported; times are approximate`)
          break
        default:
          break
      }
    }

    // 2. Feed / speed / tool.
    if ('F' in w) feed = w.F * scale
    if ('T' in w) tool = Math.round(w.T)

    // 3. Tool change and spindle.
    for (const m of ms) {
      if (m === 6) toolChanges.push({ line: li, tool })
      else if (m === 3 || m === 4) spindleOn = true
      else if (m === 5) spindleOn = false
    }

    // 4. Non-motion G codes that consume axis words.
    if (gs.includes(4)) {
      const sec = 'P' in w ? w.P : 0
      if (sec > 0) time += sec
    }
    if (gs.includes(28) || gs.includes(30)) {
      warnings.push(`Line ${li + 1}: G${gs.includes(28) ? 28 : 30} (go home) ignored - home position unknown`)
    }
    if (gs.includes(92))
      warnOnce('g92', `Line ${li + 1}: G92 coordinate offsets are ignored by the simulator`)
    if (gs.includes(53))
      warnOnce('g53', `Line ${li + 1}: G53 machine coordinates treated as work coordinates`)

    if (motionThisLine !== null) motion = motionThisLine

    // 5. Motion.
    const hasAxis = 'X' in w || 'Y' in w || 'Z' in w
    if (!nonMotionAxisUser && hasAxis && motion !== 80) {
      const target = (): Vec3 => {
        const t: Vec3 = [...pos]
        const axes: [string, number][] = [
          ['X', 0],
          ['Y', 1],
          ['Z', 2]
        ]
        for (const [ax, idx] of axes) {
          if (ax in w) t[idx] = absolute ? w[ax] * scale : pos[idx] + w[ax] * scale
        }
        return t
      }
      if (motion === 0) push(li, 'rapid', target(), feed)
      else if (motion === 1) {
        checkSpindle(li)
        push(li, 'feed', target(), feed)
      } else if (motion === 31 || motion === 38.2) push(li, 'feed', target(), feed)
      else if (motion === 2 || motion === 3) {
        checkSpindle(li)
        const end = target()
        if (plane !== 17) {
          push(li, 'feed', end, feed)
        } else {
          const start = pos
          let center: [number, number] | null = null
          if ('R' in w) {
            const r = w.R * scale
            const dx = end[0] - start[0]
            const dy = end[1] - start[1]
            const d = Math.hypot(dx, dy)
            if (d < 1e-9) {
              warnings.push(`Line ${li + 1}: R-form arc with identical start and end point`)
            } else {
              const half = d / 2
              let h2 = r * r - half * half
              if (h2 < 0) {
                if (h2 < -1e-3) warnings.push(`Line ${li + 1}: arc radius too small for the chord; adjusted`)
                h2 = 0
              }
              const h = Math.sqrt(h2)
              const nx = -dy / d
              const ny = dx / d
              const s = (motion === 2 ? -1 : 1) * (r >= 0 ? 1 : -1)
              center = [start[0] + dx / 2 + s * h * nx, start[1] + dy / 2 + s * h * ny]
            }
          } else if ('I' in w || 'J' in w) {
            const ii = ('I' in w ? w.I : 0) * scale
            const jj = ('J' in w ? w.J : 0) * scale
            center = arcAbsolute ? [ii, jj] : [start[0] + ii, start[1] + jj]
          } else {
            warnings.push(`Line ${li + 1}: arc without I/J or R; treated as a straight move`)
          }
          if (!center) push(li, 'feed', end, feed)
          else {
            const r0 = Math.hypot(start[0] - center[0], start[1] - center[1])
            const r1 = Math.hypot(end[0] - center[0], end[1] - center[1])
            if (Math.abs(r0 - r1) > 0.01 + 1e-3 * r0)
              warnings.push(
                `Line ${li + 1}: arc start and end radius differ by ${Math.abs(r0 - r1).toFixed(4)} mm`
              )
            const pts = arcPoints(
              { x: start[0], y: start[1] },
              { x: end[0], y: end[1] },
              { x: center[0], y: center[1] },
              motion === 2,
              arcTol
            )
            const z0 = start[2]
            const n = pts.length - 1
            for (let k = 1; k <= n; k++) {
              push(li, 'feed', [pts[k].x, pts[k].y, z0 + ((end[2] - z0) * k) / n], feed)
            }
            pos = end
          }
        }
      } else {
        // Canned drilling cycles.
        checkSpindle(li)
        const initialZ = pos[2]
        let x = pos[0]
        let y = pos[1]
        if (absolute) {
          if ('X' in w) x = w.X * scale
          if ('Y' in w) y = w.Y * scale
          if ('R' in w) cycle.r = w.R * scale
          if ('Z' in w) cycle.z = w.Z * scale
        } else {
          if ('X' in w) x += w.X * scale
          if ('Y' in w) y += w.Y * scale
          if ('R' in w) cycle.r = initialZ + w.R * scale
          if ('Z' in w) cycle.z = cycle.r + w.Z * scale
        }
        if ('Q' in w) cycle.q = Math.abs(w.Q * scale)
        if ('P' in w) cycle.p = w.P
        const r = cycle.r
        const zb = cycle.z
        if (pos[2] < r) push(li, 'rapid', [pos[0], pos[1], r], feed)
        push(li, 'rapid', [x, y, pos[2]], feed)
        push(li, 'rapid', [x, y, r], feed)
        if (motion === 83 && cycle.q > 0) {
          let cur = r
          let first = true
          while (cur > zb + 1e-9) {
            const next = Math.max(cur - cycle.q, zb)
            if (!first) push(li, 'rapid', [x, y, Math.min(r, cur + PECK_CLEARANCE)], feed)
            push(li, 'feed', [x, y, next], feed)
            push(li, 'rapid', [x, y, r], feed)
            cur = next
            first = false
          }
        } else {
          if (motion === 83) warnOnce('g83q', `Line ${li + 1}: G83 without Q peck; drilled in one pass`)
          push(li, 'feed', [x, y, zb], feed)
          if (motion === 82 && cycle.p > 0) time += cycle.p
          push(li, 'rapid', [x, y, r], feed)
        }
        const clearZ = retractToInitial ? Math.max(initialZ, r) : r
        push(li, 'rapid', [x, y, clearZ], feed)
      }
    }

    // 6. Program control.
    for (const m of ms) {
      if (m === 0 || m === 1) {
        pauses.push({ line: li, comment: lineComment || lastCommentOnlyText })
      }
    }
    lastCommentOnlyText = ''
    if (ms.includes(2) || ms.includes(30)) {
      const rest = lines.slice(li + 1).some((l) => tokenizeLine(l).words.length > 0)
      if (rest) warnings.push(`Line ${li + 1}: program end (M${ms.includes(2) ? 2 : 30}) before end of file`)
      break
    }
  }

  const bounds: InterpretBounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  }
  for (const m of moves) {
    for (const p of [m.from, m.to]) {
      for (let k = 0; k < 3; k++) {
        if (p[k] < bounds.min[k]) bounds.min[k] = p[k]
        if (p[k] > bounds.max[k]) bounds.max[k] = p[k]
      }
    }
  }
  if (!moves.length) {
    bounds.min = [0, 0, 0]
    bounds.max = [0, 0, 0]
  }
  return { moves, totalSeconds: time, bounds, warnings, toolChanges, pauses }
}
