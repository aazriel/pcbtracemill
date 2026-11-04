/**
 * Excellon (NC drill) parser.
 *
 * Independent implementation from the public Excellon / IPC-NC-349 descriptions and from
 * observing real KiCad, Altium, Eagle and EasyEDA outputs. Produces a `ParsedLayer` whose
 * `drills` contain holes and slots in millimetres and whose `geometry` is the union of hole
 * circles and slot strokes (so drill layers can be rendered like any other layer).
 *
 * Coordinate-format decisions (see docs/DECISIONS.md):
 *  - Coordinates containing a decimal point are always read literally.
 *  - Integer coordinates use the format digits (explicit `INCH,LZ,00.0000`, `;FILE_FORMAT=a:b`,
 *    KiCad `;FORMAT={a:b/...}`), defaulting to 2.4 for inch and 3.3 for metric.
 *  - `LZ` (leading zeros kept, trailing suppressed) pads on the right to int+dec digits;
 *    `TZ` (trailing zeros kept) and unspecified are read as "value / 10^dec".
 *  - Units default to inch (the Excellon default) unless every tool diameter is implausibly
 *    large for inches (> 0.25"), in which case metric is assumed and a warning is emitted.
 */
import type {
  DrillData,
  DrillHole,
  DrillSlot,
  GerberObject,
  ParsedLayer,
  Path,
  PolygonSet,
  Vec2
} from '../model/types'
import { arcPoints, circlePath, bboxExtend, emptyBBox, strokePaths, union, unionPaths } from '../geometry'

export interface ExcellonOptions {
  fileName?: string
  /** Fallback plating when neither file content nor file name tells. */
  plated?: boolean
}

export type Plating = 'pth' | 'npth' | 'mixed'

type Units = 'mm' | 'inch'
type ZeroMode = 'LZ' | 'TZ' | null

interface ToolDef {
  diameter: number // mm
  plated: boolean | null // from TA.AperFunction; null = use file-level
}

const INCH = 25.4
/** M codes with no geometric effect (program stop, pattern markers, tool change, ...). */
const IGNORED_M = new Set([0, 1, 2, 6, 8, 9, 25, 31, 47, 50, 51, 52, 60, 70, 97, 98, 99])

// ─────────────────────────────────────────── detection helpers

/** True when the text looks like an Excellon drill file (and not a Gerber file). */
export function isExcellon(text: string): boolean {
  const head = text.slice(0, 200000)
  if (/%FS[LT]?[AI]?X\d\dY\d\d/.test(head) || /%MO(?:MM|IN)\*%/.test(head)) return false
  // Gerber statements end with '*'; Excellon never uses '*'.
  const starLines = (head.match(/\*\s*$/gm) ?? []).length
  if (starLines > 3) return false
  if (/^\s*M48\s*$/m.test(head)) return true
  const toolDef = /^\s*T\d+(?:[FSBHZ][-+]?[\d.]+)*C[\d.]+/m.test(head)
  const toolSel = /^\s*T\d+\s*$/m.test(head)
  const coords = /^\s*(?:G0[0-5])?X[-+]?[\d.]+(?:Y[-+]?[\d.]+)?\s*$|^\s*Y[-+]?[\d.]+\s*$/m.test(head)
  const units = /^\s*(?:METRIC|INCH|M71|M72)\b/m.test(head)
  return coords && (toolDef || (toolSel && units))
}

/** Plating classification of a single attribute / comment value, or null if not a plating hint. */
function platingFromFunction(value: string): boolean | 'mixed' | null {
  const v = value.trim().toLowerCase()
  if (v.startsWith('nonplated') || v.startsWith('non_plated') || v.startsWith('non-plated')) return false
  if (v.startsWith('mixedplating')) return 'mixed'
  if (v.startsWith('plated')) return true
  return null
}

/** Plating hint from a file name: `-NPTH`, `_npth`, `NonPlated` → false; `-PTH`, `Plated` → true. */
export function platingFromFileName(fileName: string | undefined): boolean | null {
  if (!fileName) return null
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  if (/npth|non[-_ ]?plated|unplated/i.test(base)) return false
  if (/(?:^|[^a-z])pth(?:[^a-z]|$)|plated/i.test(base)) return true
  return null
}

/**
 * Quick content-only plating scan (no geometry). Uses `TF.FileFunction`, `;TYPE=...` and
 * per-tool `TA.AperFunction` comments. Returns null when the content says nothing.
 */
export function scanExcellonPlating(text: string): Plating | null {
  const ff = /TF\.FileFunction,([^\r\n*]*)/.exec(text)
  if (ff) {
    const p = platingFromFunction(ff[1])
    if (p === 'mixed') {
      // Refine with per-tool attributes when present.
      const per = scanToolAttrs(text)
      return per ?? 'mixed'
    }
    if (p !== null) return p ? 'pth' : 'npth'
  }
  const type = /^\s*;\s*TYPE\s*=\s*(NON[_-]?PLATED|PLATED)/im.exec(text)
  if (type) return /^non/i.test(type[1]) ? 'npth' : 'pth'
  return scanToolAttrs(text)
}

function scanToolAttrs(text: string): Plating | null {
  let plated = false
  let non = false
  const re = /TA\.AperFunction,([^\r\n*]*)/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const p = platingFromFunction(m[1])
    if (p === true) plated = true
    else if (p === false) non = true
  }
  if (plated && non) return 'mixed'
  if (plated) return 'pth'
  if (non) return 'npth'
  return null
}

// ─────────────────────────────────────────── parser

interface State {
  units: Units
  unitsExplicit: boolean
  zeros: ZeroMode
  intDigits: number | null
  decDigits: number | null
  absolute: boolean
  inHeader: boolean
  tools: Map<number, ToolDef>
  tool: number
  pos: Vec2
  /** 'drill' (G05/G81) or 'rout' (G00/G01 after G00). */
  mode: 'drill' | 'rout'
  toolDown: boolean
  /** Current interpolation in rout mode: 0 move, 1 linear, 2 cw arc, 3 ccw arc. */
  interp: 0 | 1 | 2 | 3
  pendingToolPlating: boolean | null
  filePlating: boolean | 'mixed' | null
}

interface RawHit {
  x: number // file units, absolute
  y: number
  tool: number
}
interface RawSlot {
  a: Vec2
  b: Vec2
  tool: number
}

/** Parse an Excellon file into a ParsedLayer (format 'excellon'). Geometry in mm. */
export function parseExcellon(text: string, opts: ExcellonOptions = {}): ParsedLayer {
  const warnings: string[] = []
  const fileAttributes: Record<string, string> = {}
  const st: State = {
    units: 'inch',
    unitsExplicit: false,
    zeros: null,
    intDigits: null,
    decDigits: null,
    absolute: true,
    inHeader: false,
    tools: new Map(),
    tool: 0,
    pos: { x: 0, y: 0 },
    mode: 'drill',
    toolDown: false,
    interp: 0,
    pendingToolPlating: null,
    filePlating: null
  }

  // Unit sanity: no declared units and every tool diameter is implausibly large for inches → metric.
  if (!/^\s*(?:METRIC|INCH|M71|M72)\b/m.test(text) && !/FORMAT\s*=\s*\{[^}]*(?:metric|inch)/i.test(text)) {
    const dias = [...text.matchAll(/^\s*T\d+[A-BD-Z\d.+-]*C([\d.]+)/gm)].map((m) => parseFloat(m[1]))
    if (dias.length > 0 && dias.every((d) => d > 0.25)) {
      st.units = 'mm'
      warnings.push('No units specified; tool sizes suggest millimetres')
    } else warnings.push('No units specified; assuming inch')
  }

  // Holes and slots are collected in mm immediately (units may change mid-file via M71/M72).
  const hits: RawHit[] = []
  const slots: RawSlot[] = []
  const unknown = new Set<string>()

  const scaleNow = (): number => (st.units === 'inch' ? INCH : 1)

  const parseNumber = (s: string): number => {
    const neg = s.startsWith('-')
    const body = s.replace(/^[-+]/, '')
    if (body === '') return 0
    let v: number
    if (body.includes('.')) v = parseFloat(body)
    else {
      const dec = st.decDigits ?? (st.units === 'inch' ? 4 : 3)
      const int = st.intDigits ?? (st.units === 'inch' ? 2 : 3)
      let digits = body
      if (st.zeros === 'LZ' && digits.length < int + dec) digits = digits.padEnd(int + dec, '0')
      v = parseInt(digits, 10) / Math.pow(10, dec)
    }
    return (neg ? -v : v) * scaleNow()
  }

  const defineTool = (num: number, params: string): void => {
    const re = /([A-Z])([-+]?[\d.]*)/g
    let dia: number | null = null
    for (let m = re.exec(params); m; m = re.exec(params)) {
      if (m[1] === 'C') dia = parseFloat(m[2]) * scaleNow()
    }
    if (dia === null || !Number.isFinite(dia)) {
      if (!st.tools.has(num)) warnings.push(`Tool T${num} defined without a diameter`)
      return
    }
    st.tools.set(num, { diameter: dia, plated: st.pendingToolPlating })
  }

  const handleComment = (raw: string): void => {
    const c = raw.replace(/^;\s*/, '')
    const attr = /^#@!\s*(T[FAOD])\.?([^,\s]*)\s*,?(.*)$/.exec(c)
    if (attr) {
      const [, kind, name, value] = attr
      if (kind === 'TF') {
        fileAttributes['.' + name] = value.trim()
        if (name === 'FileFunction') {
          const p = platingFromFunction(value)
          if (p !== null) st.filePlating = p
        }
      } else if (kind === 'TA' && name === 'AperFunction') {
        const p = platingFromFunction(value)
        st.pendingToolPlating = p === 'mixed' ? null : p
      } else if (kind === 'TD') {
        st.pendingToolPlating = null
      }
      return
    }
    const type = /^TYPE\s*=\s*(NON[_-]?PLATED|PLATED)/i.exec(c)
    if (type) {
      st.filePlating = !/^non/i.test(type[1])
      return
    }
    const ff = /FILE_FORMAT\s*=\s*(\d+)\s*:\s*(\d+)/i.exec(c)
    if (ff) {
      st.intDigits = parseInt(ff[1], 10)
      st.decDigits = parseInt(ff[2], 10)
      return
    }
    const kf = /FORMAT\s*=\s*\{\s*([-\d]+)\s*:\s*([-\d]+)\s*\/([^}]*)\}/i.exec(c)
    if (kf) {
      if (/^\d+$/.test(kf[1]) && /^\d+$/.test(kf[2])) {
        st.intDigits = parseInt(kf[1], 10)
        st.decDigits = parseInt(kf[2], 10)
      }
      const rest = kf[3].toLowerCase()
      if (rest.includes('suppress trailing')) st.zeros = 'LZ'
      else if (rest.includes('suppress leading')) st.zeros = 'TZ'
      if (rest.includes('metric')) setUnits('mm', false)
      else if (rest.includes('inch')) setUnits('inch', false)
    }
  }

  const setUnits = (u: Units, explicit = true): void => {
    if (explicit || !st.unitsExplicit) st.units = u
    if (explicit) st.unitsExplicit = true
  }

  const handleUnitsLine = (line: string): boolean => {
    const m = /^(METRIC|INCH)(?:,(.*))?$/.exec(line)
    if (!m) return false
    setUnits(m[1] === 'METRIC' ? 'mm' : 'inch')
    for (const part of (m[2] ?? '').split(',')) {
      const p = part.trim()
      if (p === 'LZ' || p === 'TZ') st.zeros = p
      else if (/^0*\.0*$/.test(p) && p.includes('.')) {
        const [a, b] = p.split('.')
        st.intDigits = a.length
        st.decDigits = b.length
      }
    }
    return true
  }

  /** Reads X/Y words from a token list and returns the new absolute position (mm). */
  const readXY = (words: Map<string, string>, base: Vec2): Vec2 | null => {
    const xs = words.get('X')
    const ys = words.get('Y')
    if (xs === undefined && ys === undefined) return null
    if (st.absolute) {
      return {
        x: xs !== undefined ? parseNumber(xs) : base.x,
        y: ys !== undefined ? parseNumber(ys) : base.y
      }
    }
    return {
      x: base.x + (xs !== undefined ? parseNumber(xs) : 0),
      y: base.y + (ys !== undefined ? parseNumber(ys) : 0)
    }
  }

  const addHit = (p: Vec2): void => {
    if (st.tool === 0) {
      warnings.push('Hole outside of any tool selection ignored')
      return
    }
    hits.push({ x: p.x, y: p.y, tool: st.tool })
  }

  const addSlot = (a: Vec2, b: Vec2): void => {
    if (st.tool === 0) return
    slots.push({ a: { ...a }, b: { ...b }, tool: st.tool })
  }

  const lines = text.split(/\r\n|\r|\n/)
  let ended = false
  for (const rawLine of lines) {
    if (ended) break
    const line = rawLine.trim()
    if (line === '') continue
    if (line.startsWith(';')) {
      handleComment(line)
      continue
    }
    // Strip parenthesised comments.
    const ln = line
      .replace(/\([^)]*\)/g, '')
      .trim()
      .toUpperCase()
    if (ln === '') continue
    if (ln === 'M48') {
      st.inHeader = true
      continue
    }
    if (ln === '%' || ln === 'M95') {
      st.inHeader = false
      continue
    }
    if (handleUnitsLine(ln)) continue
    if (
      /^(FMAT|VER|ICI|DETECT|ATC|BLKD|SBK|SG|TCST|AFS|CCW|CP|DN|DTMDIST|FSB|HBCK|NCSL|OM48|OSTOP|OTCLMP|PCKPARAM|PF|PPR|PVS|R,|RC|RD|RH|RT|SI|TCLMP|TOFF|UP|ZA|ZC|ZS|Z\+|Z-)/.test(
        ln
      )
    ) {
      if (/^ICI,ON/.test(ln)) st.absolute = false
      else if (/^ICI,OFF/.test(ln)) st.absolute = true
      else if (/^FMAT,1/.test(ln))
        warnings.push('FMAT,1 (Excellon format 1) commands are not fully supported')
      continue
    }
    // Tool definition / selection.
    const t = /^T(\d+)(.*)$/.exec(ln)
    if (t) {
      const num = parseInt(t[1], 10)
      const rest = t[2]
      if (/C[\d.]/.test(rest)) defineTool(num, rest)
      if (!st.inHeader) {
        st.tool = num
        if (num !== 0 && !st.tools.has(num)) warnings.push(`Tool T${num} used but never defined`)
        st.toolDown = false
      }
      continue
    }
    if (st.inHeader && /^M7[12]$/.test(ln)) {
      setUnits(ln === 'M71' ? 'mm' : 'inch')
      continue
    }

    // Body statement: split at G85 for slot syntax.
    const g85 = ln.indexOf('G85')
    if (g85 >= 0) {
      const startWords = tokenize(ln.slice(0, g85))
      const endWords = tokenize(ln.slice(g85 + 3))
      const start = readXY(startWords, st.pos) ?? { ...st.pos }
      const end = readXY(endWords, start) ?? { ...start }
      addSlot(start, end)
      st.pos = end
      continue
    }

    const words = tokenize(ln)
    const mcode = words.get('M')
    if (mcode !== undefined) {
      const m = parseInt(mcode, 10)
      if (m === 30) {
        ended = true
        continue
      } else if (m === 15) st.toolDown = true
      else if (m === 16 || m === 17) st.toolDown = false
      else if (m === 71) setUnits('mm')
      else if (m === 72) setUnits('inch')
      else if (!IGNORED_M.has(m)) unknown.add(`M${m}`)
      if (!words.has('X') && !words.has('Y')) continue
    }
    const gcode = words.get('G')
    if (gcode !== undefined) {
      const g = parseInt(gcode, 10)
      if (g === 90) st.absolute = true
      else if (g === 91) st.absolute = false
      else if (g === 5 || g === 81) {
        st.mode = 'drill'
        st.toolDown = false
      } else if (g === 0) {
        st.mode = 'rout'
        st.interp = 0
        st.toolDown = false
      } else if (g === 1 || g === 2 || g === 3) {
        st.mode = 'rout'
        st.interp = g
      } else if (g === 93) {
        // Zero set: G93X..Y.. offsets the origin. Rare; we only warn.
        warnings.push('G93 zero set ignored')
        continue
      } else unknown.add(`G${g}`)
    }
    const repeat = words.get('R')
    const target = readXY(words, st.pos)
    if (repeat !== undefined && target) {
      // Repeat hole: R<n>X<dx>Y<dy> — n holes stepping by the given increment from current position.
      const n = parseInt(repeat, 10)
      const dx = words.has('X') ? parseNumber(words.get('X') ?? '0') : 0
      const dy = words.has('Y') ? parseNumber(words.get('Y') ?? '0') : 0
      let p = { ...st.pos }
      for (let i = 0; i < n; i++) {
        p = { x: p.x + dx, y: p.y + dy }
        addHit(p)
      }
      st.pos = p
      continue
    }
    if (!target) {
      if (gcode === undefined && mcode === undefined && !/^[A-Z]{2,}/.test(ln)) unknown.add(ln.slice(0, 12))
      continue
    }
    if (st.mode === 'drill') {
      addHit(target)
    } else if (st.toolDown && st.interp === 1) {
      addSlot(st.pos, target)
    } else if (st.toolDown && (st.interp === 2 || st.interp === 3)) {
      const center = arcCenter(st.pos, target, words, st.interp === 2, parseNumber)
      if (center) {
        const pts = arcPoints(st.pos, target, center, st.interp === 2, 0.02)
        for (let i = 1; i < pts.length; i++) addSlot(pts[i - 1], pts[i])
      } else addSlot(st.pos, target)
    }
    st.pos = target
  }

  for (const u of unknown) warnings.push(`Unsupported Excellon command ignored: ${u}`)

  // Resolve plating.
  const fromName = platingFromFileName(opts.fileName)
  const fileLevel: boolean =
    st.filePlating === true || st.filePlating === false
      ? st.filePlating
      : fromName !== null
        ? fromName
        : opts.plated !== undefined
          ? opts.plated
          : true
  const toolPlated = (n: number): boolean => st.tools.get(n)?.plated ?? fileLevel
  const toolDia = (n: number): number => st.tools.get(n)?.diameter ?? 0

  const holes: DrillHole[] = hits.map((h) => ({
    x: h.x,
    y: h.y,
    diameter: toolDia(h.tool),
    plated: toolPlated(h.tool),
    toolNumber: h.tool
  }))
  const drillSlots: DrillSlot[] = slots.map((s) => ({
    start: s.a,
    end: s.b,
    diameter: toolDia(s.tool),
    plated: toolPlated(s.tool),
    toolNumber: s.tool
  }))

  const zeroDia =
    holes.filter((h) => !(h.diameter > 0)).length + drillSlots.filter((s) => !(s.diameter > 0)).length
  if (zeroDia > 0) warnings.push(`${zeroDia} hole(s)/slot(s) use a tool without a diameter`)

  // Geometry.
  const objects: GerberObject[] = []
  const circles: Path[] = []
  let id = 0
  for (const h of holes) {
    if (!(h.diameter > 0)) continue
    const c = circlePath(h.x, h.y, h.diameter / 2)
    circles.push(c)
    objects.push({
      id: id++,
      kind: 'flash',
      polarity: 'dark',
      aperture: h.toolNumber,
      attributes: { plated: String(h.plated) },
      shape: [{ outer: c, holes: [] }],
      center: { x: h.x, y: h.y },
      width: 0
    })
  }
  const strokes: { path: Path; width: number }[] = []
  const slotShapes: PolygonSet[] = []
  for (const s of drillSlots) {
    if (!(s.diameter > 0)) continue
    const path = [s.start, s.end]
    const shape = strokePaths([path], s.diameter, 'round')
    slotShapes.push(shape)
    strokes.push({ path, width: s.diameter })
    objects.push({
      id: id++,
      kind: 'draw',
      polarity: 'dark',
      aperture: s.toolNumber,
      attributes: { plated: String(s.plated) },
      shape,
      path,
      width: s.diameter
    })
  }
  const geometry = union(unionPaths(circles), ...slotShapes)
  // Exact bbox from the analytic shapes (polygonised circles may miss the extremes slightly).
  const bbox = emptyBBox()
  for (const h of holes) {
    if (!(h.diameter > 0)) continue
    const r = h.diameter / 2
    bboxExtend(bbox, { x: h.x - r, y: h.y - r })
    bboxExtend(bbox, { x: h.x + r, y: h.y + r })
  }
  for (const s of drillSlots) {
    if (!(s.diameter > 0)) continue
    const r = s.diameter / 2
    for (const p of [s.start, s.end]) {
      bboxExtend(bbox, { x: p.x - r, y: p.y - r })
      bboxExtend(bbox, { x: p.x + r, y: p.y + r })
    }
  }
  const drills: DrillData = { holes, slots: drillSlots }

  return {
    format: 'excellon',
    geometry,
    objects,
    strokes,
    drills,
    bbox,
    fileAttributes,
    sourceUnits: st.units,
    warnings
  }
}

function tokenize(s: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /([A-Z])([-+]?[\d.]*)/g
  for (let m = re.exec(s); m; m = re.exec(s)) {
    // First occurrence wins for G/M (e.g. "G00X..."), last for coordinates.
    if ((m[1] === 'G' || m[1] === 'M') && out.has(m[1])) continue
    out.set(m[1], m[2])
  }
  return out
}

/** Arc centre from I/J (incremental from start) or A (radius, shorter arc). */
function arcCenter(
  a: Vec2,
  b: Vec2,
  words: Map<string, string>,
  cw: boolean,
  num: (s: string) => number
): Vec2 | null {
  const I = words.get('I')
  const J = words.get('J')
  if (I !== undefined || J !== undefined) {
    return { x: a.x + (I !== undefined ? num(I) : 0), y: a.y + (J !== undefined ? num(J) : 0) }
  }
  const A = words.get('A')
  if (A === undefined) return null
  const r = num(A)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  if (d === 0 || r < d / 2) return null
  const h = Math.sqrt(r * r - (d * d) / 4)
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  // Perpendicular unit vector (left of a→b).
  const px = -dy / d
  const py = dx / d
  // For a CW minor arc the centre lies to the right of a→b; CCW to the left.
  const s = cw ? -1 : 1
  return { x: mx + s * h * px, y: my + s * h * py }
}

/** Overall plating of parsed drill data. Returns undefined when there are no drills. */
export function drillPlating(drills: DrillData | undefined): Plating | undefined {
  if (!drills) return undefined
  const all = [...drills.holes.map((h) => h.plated), ...drills.slots.map((s) => s.plated)]
  if (all.length === 0) return undefined
  const p = all.filter(Boolean).length
  if (p === all.length) return 'pth'
  if (p === 0) return 'npth'
  return 'mixed'
}
