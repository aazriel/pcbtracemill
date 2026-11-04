import type { HeightMap } from '../model/types'
import { arcPoints } from '../geometry'
import { tokenizeLine, type GcodeWord } from '../gcode/tokenize'
import { fmtNum } from '../post/format'
import { heightMapStats, sampleHeight } from './grid'

export interface ApplyHeightMapOptions {
  /** Longest XY piece after subdivision, mm. Default 1. */
  maxSegmentLength?: number
  /** Only moves with Z below this height (mm, program frame) are adjusted. Default 0.5. */
  onlyBelowZ?: number
}

const INCH = 25.4
const AXIS_LETTERS = new Set(['X', 'Y', 'Z', 'I', 'J', 'K', 'R', 'P'])
type Vec3 = [number, number, number]

/**
 * Apply an auto-level height map to a G-code program.
 *
 * Feed moves (G1, and G2/G3 linearised) whose Z is below `onlyBelowZ` are split into XY pieces of at
 * most `maxSegmentLength` and each piece end gets the interpolated surface height added to Z.
 * Rapids above the board are copied verbatim; rapids below `onlyBelowZ` get their end Z offset.
 * Canned drill cycles (absolute mode) get their Z depth offset per hole. Comments, line numbers on the
 * first piece, units (G20/G21) and distance mode (G90/G91) are preserved.
 */
export function applyHeightMap(gcode: string, map: HeightMap, opts: ApplyHeightMapOptions = {}): string {
  const maxSeg = opts.maxSegmentLength && opts.maxSegmentLength > 0 ? opts.maxSegmentLength : 1
  const below = opts.onlyBelowZ ?? 0.5
  const src = gcode.split(/\r?\n/)
  const trailingNewline = gcode.endsWith('\n')
  if (trailingNewline) src.pop()
  const out: string[] = []

  let scale = 1 // program units → mm
  let absolute = true
  let arcAbsolute = false
  let motion = 0 // program motion mode
  let emittedMotion = -1 // motion mode the controller is in given OUR output
  let retractInitial = true
  // Nominal (program) position in mm; null = unknown.
  let pos: [number | null, number | null, number | null] = [null, null, null]
  // Actual (emitted) Z minus nominal Z at the current position, mm.
  let applied = 0
  let cycleZ: number | null = null
  let cycleR: number | null = null
  let usesSemicolon = false
  let usesParens = false
  let ended = false

  const off = (x: number, y: number): number => sampleHeight(map, x, y)
  const decimals = (): number => (scale === 1 ? 4 : 5)
  const f = (mm: number): string => fmtNum(mm / scale, decimals())

  for (const line of src) {
    if (ended) {
      out.push(line)
      continue
    }
    const tok = tokenizeLine(line)
    if (line.includes(';')) usesSemicolon = true
    if (line.includes('(')) usesParens = true
    if (tok.words.length === 0 || tok.errors.length) {
      out.push(line)
      continue
    }
    const w: Record<string, number> = {}
    const gs: number[] = []
    const ms: number[] = []
    for (const word of tok.words) {
      if (word.letter === 'G') gs.push(Math.round(word.value * 10) / 10)
      else if (word.letter === 'M') ms.push(Math.round(word.value))
      else w[word.letter] = word.value
    }
    let explicitMotion = false
    let nonMotion = false
    for (const g of gs) {
      if (g === 20) scale = INCH
      else if (g === 21) scale = 1
      else if (g === 90) absolute = true
      else if (g === 91) absolute = false
      else if (g === 90.1) arcAbsolute = true
      else if (g === 91.1) arcAbsolute = false
      else if (g === 98) retractInitial = true
      else if (g === 99) retractInitial = false
      else if ([0, 1, 2, 3, 80, 81, 82, 83].includes(g)) {
        motion = g
        explicitMotion = true
      } else if ([38.2, 38.3, 38.4, 38.5, 31].includes(g)) {
        motion = -2
        explicitMotion = true
      } else if ([4, 10, 28, 30, 53, 92].includes(g)) nonMotion = true
    }
    if (ms.includes(2) || ms.includes(30)) ended = true
    const hasAxis = 'X' in w || 'Y' in w || 'Z' in w

    if (!hasAxis || nonMotion || motion === 80) {
      if (nonMotion && hasAxis) {
        // Homing / offsets: position becomes unknown.
        pos = [null, null, null]
        applied = 0
      }
      if (explicitMotion) emittedMotion = motion
      out.push(line)
      continue
    }

    const target = (): Vec3 => {
      const t: Vec3 = [pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0]
      const axes: [string, number][] = [
        ['X', 0],
        ['Y', 1],
        ['Z', 2]
      ]
      for (const [a, k] of axes) {
        if (a in w) t[k] = absolute ? w[a] * scale : (pos[k] ?? 0) + w[a] * scale
        else if (pos[k] === null && k === 2) t[k] = Infinity
      }
      return t
    }

    // Probe moves and unknown modes: copy, position unknown afterwards.
    if (motion === -2) {
      out.push(line)
      emittedMotion = motion
      pos = [null, null, null]
      applied = 0
      continue
    }

    if (motion === 81 || motion === 82 || motion === 83) {
      if ('Z' in w) cycleZ = absolute ? w.Z * scale : null
      if ('R' in w) cycleR = absolute ? w.R * scale : null
      const t = target()
      const hx = 'X' in w || pos[0] === null ? t[0] : pos[0]
      const hy = 'Y' in w || pos[1] === null ? t[1] : pos[1]
      if (!absolute || cycleZ === null) {
        out.push(line)
      } else {
        const z = cycleZ + off(hx, hy)
        const zw = `Z${f(z)}`
        const words = tok.words.map((x) => (x.letter === 'Z' ? zw : x.raw.trim()))
        if (!('Z' in w)) words.push(zw)
        out.push(withComments(words.join(' '), tok.comments, usesSemicolon && !usesParens))
      }
      const startZ = pos[2] ?? 0
      pos = [hx, hy, retractInitial ? Math.max(startZ, cycleR ?? startZ) : (cycleR ?? startZ)]
      applied = 0
      emittedMotion = motion
      continue
    }

    const start: [number | null, number | null, number | null] = [...pos]
    const end = target()
    const startZ = start[2] ?? end[2]
    const isRapid = motion === 0
    const adjust = isRapid ? end[2] < below : end[2] < below || startZ < below
    const verbatimOk = !adjust && (absolute || Math.abs(applied) < 1e-12)

    if (verbatimOk) {
      let l = line
      if (!explicitMotion && emittedMotion !== motion) l = insertMotion(line, motion)
      out.push(l)
      emittedMotion = motion
      pos = [end[0], end[1], Number.isFinite(end[2]) ? end[2] : null]
      if ('Z' in w) applied = 0
      continue
    }

    // Build the list of nominal piece end points.
    const pieces: Vec3[] = []
    const sx = start[0]
    const sy = start[1]
    const known = sx !== null && sy !== null && Number.isFinite(startZ)
    if (!known || isRapid) {
      pieces.push(end)
    } else if (motion === 1) {
      pushSubdivided(pieces, [sx, sy, startZ], end, maxSeg)
    } else {
      // G2 / G3
      let center: [number, number] | null = null
      if ('R' in w) center = arcCenterR([sx, sy], [end[0], end[1]], w.R * scale, motion === 2)
      else if ('I' in w || 'J' in w) {
        const ii = ('I' in w ? w.I : 0) * scale
        const jj = ('J' in w ? w.J : 0) * scale
        center = arcAbsolute ? [ii, jj] : [sx + ii, sy + jj]
      }
      if (!center) pushSubdivided(pieces, [sx, sy, startZ], end, maxSeg)
      else {
        const pts = arcPoints(
          { x: sx, y: sy },
          { x: end[0], y: end[1] },
          { x: center[0], y: center[1] },
          motion === 2,
          0.01
        )
        const nn = pts.length - 1
        let prev: Vec3 = [sx, sy, startZ]
        for (let k = 1; k <= nn; k++) {
          const p: Vec3 = [pts[k].x, pts[k].y, startZ + ((end[2] - startZ) * k) / nn]
          pushSubdivided(pieces, prev, p, maxSeg)
          prev = p
        }
      }
    }

    const code = isRapid ? 'G0' : 'G1'
    let curActualZ = startZ + applied
    let curX = sx ?? end[0]
    let curY = sy ?? end[1]
    let lastApplied = applied
    pieces.forEach((p, k) => {
      const o = p[2] < below ? off(p[0], p[1]) : 0
      const az = p[2] + o
      let words: string[]
      if (absolute) {
        words = [`X${f(p[0])}`, `Y${f(p[1])}`, `Z${f(az)}`]
        if (k === 0 && !known) {
          words = []
          if ('X' in w) words.push(`X${f(p[0])}`)
          if ('Y' in w) words.push(`Y${f(p[1])}`)
          words.push(`Z${f(az)}`)
        }
      } else {
        words = [`X${f(p[0] - curX)}`, `Y${f(p[1] - curY)}`, `Z${f(az - curActualZ)}`]
      }
      if (k === 0) {
        const kept = tok.words.filter(
          (x) => !AXIS_LETTERS.has(x.letter) && !(x.letter === 'G' && isMotionCode(x.value))
        )
        out.push(joinLine(kept, [code, ...words], tok.comments, usesSemicolon && !usesParens))
      } else out.push(`${code} ${words.join(' ')}`)
      curActualZ = az
      curX = p[0]
      curY = p[1]
      lastApplied = o
    })
    emittedMotion = isRapid ? 0 : 1
    pos = [end[0], end[1], end[2]]
    applied = lastApplied
  }

  const st = heightMapStats(map)
  const c = map.config
  const note = `TraceMill: auto-levelled with ${c.countX}x${c.countY} height map, range ${fmtNum(st.range, 3)} mm, max segment ${fmtNum(maxSeg, 3)} mm, applied below Z${fmtNum(below, 3)} mm`
  const header = usesSemicolon && !usesParens ? `; ${note}` : `(${note})`
  let insertAt = 0
  while (insertAt < out.length && out[insertAt].trim() === '%') insertAt++
  out.splice(insertAt, 0, header)
  return out.join('\n') + (trailingNewline ? '\n' : '')
}

function isMotionCode(v: number): boolean {
  const g = Math.round(v * 10) / 10
  return g === 0 || g === 1 || g === 2 || g === 3
}

function pushSubdivided(out: Vec3[], a: Vec3, b: Vec3, maxSeg: number): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const n = Math.max(1, Math.ceil(len / maxSeg - 1e-9))
  for (let k = 1; k <= n; k++) {
    const t = k / n
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
  }
}

function arcCenterR(
  s: [number, number],
  e: [number, number],
  r: number,
  cw: boolean
): [number, number] | null {
  const dx = e[0] - s[0]
  const dy = e[1] - s[1]
  const d = Math.hypot(dx, dy)
  if (d < 1e-9) return null
  const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2))
  const sgn = (cw ? -1 : 1) * (r >= 0 ? 1 : -1)
  return [s[0] + dx / 2 + (sgn * h * -dy) / d, s[1] + dy / 2 + (sgn * h * dx) / d]
}

function joinLine(kept: GcodeWord[], extra: string[], comments: string[], semicolon: boolean): string {
  const n = kept.filter((w) => w.letter === 'N').map((w) => w.raw.trim())
  const gWords = kept.filter((w) => w.letter === 'G').map((w) => w.raw.trim())
  const rest = kept.filter((w) => w.letter !== 'N' && w.letter !== 'G').map((w) => w.raw.trim())
  const parts = [...n, ...gWords, ...extra, ...rest]
  return withComments(parts.join(' '), comments, semicolon)
}

function withComments(code: string, comments: string[], semicolon: boolean): string {
  if (!comments.length) return code
  return code + (semicolon ? ` ; ${comments.join(' ')}` : ' ' + comments.map((c) => `(${c})`).join(' '))
}

/** Insert an explicit motion code (after a leading N word) into a verbatim line. */
function insertMotion(line: string, motion: number): string {
  const m = /^(\s*[Nn]\s*\d+\s*)/.exec(line)
  if (m) return `${m[1]}G${motion} ${line.slice(m[1].length)}`
  return `G${motion} ${line}`
}
