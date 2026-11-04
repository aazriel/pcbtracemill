/**
 * Gerber RS-274X (incl. X2 attributes) parser. Written from the Ucamco Gerber Layer Format
 * specification. Produces a ParsedLayer in millimetres.
 */
import {
  IDENTITY,
  applyAffine,
  arcPoints,
  circlePath,
  compose,
  difference,
  emptyBBox,
  bboxIsEmpty,
  pathsBBox,
  polygonSetBBox,
  rectPath,
  rotate,
  scale,
  strokePaths,
  transformPath,
  transformPolygonSet,
  translate,
  union,
  unionPaths,
  type Affine
} from '../geometry'
import type { BBox, GerberObject, ParsedLayer, Path, PolygonSet, Vec2 } from '../model/types'
import { evalMacro, parseMacro, type MacroDef } from './macro'
import { convexHull, obroundPath, regularPolygonPath, stadiumPath, translateSet, withHole } from './shapes'
import { tokenize } from './tokenizer'

export interface ParseGerberOptions {
  fileName?: string
}

type Polarity = 'dark' | 'clear'
type Attrs = Record<string, string>

/** Object before it reaches the output (coordinates in mm, before image transform). */
interface RawObject {
  kind: GerberObject['kind']
  polarity: Polarity
  aperture: number
  attributes?: Attrs
  shape: PolygonSet
  center?: Vec2
  path?: Path
  width: number
}

interface Aperture {
  code: number
  type: 'C' | 'R' | 'O' | 'P' | 'macro' | 'block'
  /** Shape centred at origin, mm, without load transforms. */
  shape: PolygonSet
  /** Circle diameter (type C), mm. */
  diameter: number
  /** Equivalent stroke width, mm. */
  width: number
  attributes: Attrs
  block?: RawObject[]
  cache: Map<string, PolygonSet>
}

interface CoordFormat {
  zeros: 'L' | 'T'
  xi: number
  xd: number
  yi: number
  yd: number
}

type Sink =
  | { kind: 'sr'; objects: RawObject[]; x: number; y: number; i: number; j: number }
  | { kind: 'ab'; code: number; objects: RawObject[] }

const isIdentity = (m: Affine): boolean =>
  m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0

function transformObject(o: RawObject, m: Affine, invert: boolean): RawObject {
  const det = Math.abs(m[0] * m[3] - m[1] * m[2])
  const out: RawObject = {
    kind: o.kind,
    polarity: invert ? (o.polarity === 'dark' ? 'clear' : 'dark') : o.polarity,
    aperture: o.aperture,
    attributes: o.attributes,
    shape:
      m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1
        ? translateSet(o.shape, m[4], m[5])
        : transformPolygonSet(m, o.shape),
    width: o.width * Math.sqrt(det)
  }
  if (o.center) out.center = applyAffine(m, o.center)
  if (o.path) out.path = transformPath(m, o.path)
  return out
}

const num = (s: string | undefined, def = 0): number => {
  if (s === undefined) return def
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : def
}

class GerberParser {
  readonly warnings: string[] = []
  private readonly warned = new Set<string>()

  // format / units
  private fmt: CoordFormat = { zeros: 'L', xi: 3, xd: 6, yi: 3, yd: 6 }
  private fsSeen = false
  private unitFactor = 25.4
  private units: 'mm' | 'inch' | null = null
  private unitsWarned = false

  // graphics state
  private cur: Vec2 = { x: 0, y: 0 }
  private interp: 'linear' | 'cw' | 'ccw' = 'linear'
  private quadrant: 'single' | 'multi' | null = null
  private region = false
  private contour: Path = []
  private regionContours: Path[] = []
  private polarity: Polarity = 'dark'
  private aperture: Aperture | null = null
  private lastOp = 1
  private ended = false

  // load transforms
  private loadMirror: 'N' | 'X' | 'Y' | 'XY' = 'N'
  private loadRotation = 0
  private loadScale = 1
  private loadMatrix: Affine = IDENTITY
  private loadKey = ''

  // image transforms (deprecated %MI %SF %OF %IR %AS)
  private mirrorA = false
  private mirrorB = false
  private scaleA = 1
  private scaleB = 1
  private offA = 0
  private offB = 0
  private imageRot = 0
  private swapAxes = false
  private image: Affine = IDENTITY

  // dictionaries
  private readonly apertures = new Map<number, Aperture>()
  private readonly macros = new Map<string, MacroDef>()
  readonly fileAttributes: Attrs = {}
  private apAttrs: Attrs = {}
  private objAttrs: Attrs = {}
  private attrVersion = 0
  private readonly attrCache = new Map<
    number,
    { version: number; ap: Aperture | null; attrs: Attrs | undefined }
  >()

  // output
  private readonly sinks: Sink[] = []
  readonly objects: GerberObject[] = []
  readonly strokes: { path: Path; width: number }[] = []
  private acc: PolygonSet = []
  private batch: PolygonSet[] = []
  private batchPolarity: Polarity = 'dark'

  warn(msg: string): void {
    if (this.warned.has(msg)) return
    this.warned.add(msg)
    this.warnings.push(msg)
  }

  parse(text: string): ParsedLayer {
    const blocks = tokenize(text)
    for (const b of blocks) {
      if (this.ended) break
      try {
        if (b.type === 'ext') this.handleExtBlock(b.commands)
        else this.handleWord(b.text)
      } catch (e) {
        this.warn(`Line ${b.line}: ${(e as Error).message}`)
      }
    }
    if (!this.ended) this.warn('Missing M02 end-of-file command')
    if (this.region) {
      this.warn('Unterminated region (G36 without G37)')
      this.endRegion()
    }
    while (this.sinks.length) {
      const s = this.sinks[this.sinks.length - 1]
      this.warn(s.kind === 'sr' ? 'Unterminated %SR block' : 'Unterminated %AB block')
      if (s.kind === 'sr') this.closeStepRepeat()
      else this.closeBlock()
    }
    this.flush()
    let bbox: BBox = polygonSetBBox(this.acc)
    if (bboxIsEmpty(bbox)) bbox = pathsBBox(this.strokes.map((s) => s.path))
    if (bboxIsEmpty(bbox)) bbox = emptyBBox()
    return {
      format: 'gerber',
      geometry: this.acc,
      objects: this.objects,
      strokes: this.strokes,
      bbox,
      fileAttributes: this.fileAttributes,
      sourceUnits: this.units ?? 'inch',
      warnings: this.warnings
    }
  }

  // ─────────────────────────────────────────── extended commands

  private handleExtBlock(cmds: string[]): void {
    if (cmds[0].startsWith('AM')) {
      const name = cmds[0].slice(2).trim()
      this.macros.set(
        name,
        parseMacro(name, cmds.slice(1), (m) => this.warn(m))
      )
      return
    }
    for (const c of cmds) this.handleExt(c)
  }

  private handleExt(c: string): void {
    const code = c.slice(0, 2)
    const rest = c.slice(2)
    switch (code) {
      case 'FS':
        return this.handleFS(rest)
      case 'MO':
        if (rest.startsWith('MM')) return this.setUnits('mm')
        if (rest.startsWith('IN')) return this.setUnits('inch')
        return this.warn(`Unknown unit mode %MO${rest}`)
      case 'AD':
        return this.handleAD(rest)
      case 'LP':
        if (rest === 'D' || rest === 'C') this.polarity = rest === 'D' ? 'dark' : 'clear'
        else this.warn(`Unknown polarity %LP${rest}`)
        return
      case 'LM':
        if (rest === 'N' || rest === 'X' || rest === 'Y' || rest === 'XY') this.loadMirror = rest
        else this.warn(`Unknown mirroring %LM${rest}`)
        return this.updateLoad()
      case 'LR':
        this.loadRotation = num(rest)
        return this.updateLoad()
      case 'LS':
        this.loadScale = num(rest, 1)
        return this.updateLoad()
      case 'SR':
        return this.handleSR(rest)
      case 'AB':
        return this.handleAB(rest)
      case 'TF':
      case 'TA':
      case 'TO':
      case 'TD':
        return this.handleAttribute(c)
      case 'IP':
        if (rest.startsWith('NEG')) this.warn('Negative image polarity (%IPNEG) is not supported; ignored')
        return
      case 'IN':
      case 'LN':
        return
      case 'OF': {
        const a = /A([+-]?[\d.]+)/.exec(rest)
        const b = /B([+-]?[\d.]+)/.exec(rest)
        this.offA = num(a?.[1]) * this.unitFactor
        this.offB = num(b?.[1]) * this.unitFactor
        if (this.offA || this.offB) this.warn('Deprecated %OF image offset applied')
        return this.updateImage()
      }
      case 'SF': {
        const a = /A([+-]?[\d.]+)/.exec(rest)
        const b = /B([+-]?[\d.]+)/.exec(rest)
        this.scaleA = num(a?.[1], 1)
        this.scaleB = num(b?.[1], 1)
        if (this.scaleA !== 1 || this.scaleB !== 1) this.warn('Deprecated %SF scale factor applied')
        return this.updateImage()
      }
      case 'MI': {
        this.mirrorA = /A1/.test(rest)
        this.mirrorB = /B1/.test(rest)
        if (this.mirrorA || this.mirrorB) this.warn('Deprecated %MI image mirroring applied')
        return this.updateImage()
      }
      case 'IR':
        this.imageRot = num(rest)
        if (this.imageRot) this.warn('Deprecated %IR image rotation applied')
        return this.updateImage()
      case 'AS':
        this.swapAxes = rest.startsWith('AY')
        if (this.swapAxes) this.warn('Deprecated %AS axis select applied')
        return this.updateImage()
      case 'IJ':
      case 'IO':
      case 'KO':
      case 'SM':
      case 'MC':
        return this.warn(`Unsupported deprecated command %${code} ignored`)
      default:
        if (/^[GDM]\d/.test(c)) return this.handleWord(c)
        this.warn(`Unknown extended command %${c.slice(0, 16)} ignored`)
    }
  }

  private setUnits(u: 'mm' | 'inch'): void {
    if (this.units && this.units !== u) this.warn('Unit mode changed mid-file')
    if (!this.units) this.units = u
    this.unitFactor = u === 'mm' ? 1 : 25.4
    this.unitsWarned = true
  }

  private handleFS(rest: string): void {
    const m = /^([LTD])?([AI])?(?:N\d+)?(?:G\d+)?X(\d)(\d)Y(\d)(\d)/.exec(rest)
    if (!m) {
      this.warn(`Cannot parse format specification %FS${rest}`)
      return
    }
    this.fsSeen = true
    const zeros = m[1] === 'T' ? 'T' : 'L'
    if (m[1] === 'T') this.warn('Deprecated trailing-zero omission format')
    if (m[2] === 'I') this.warn('Deprecated incremental coordinate notation; coordinates treated as absolute')
    this.fmt = { zeros, xi: +m[3], xd: +m[4], yi: +m[5], yd: +m[6] }
  }

  private updateLoad(): void {
    let m: Affine = IDENTITY
    if (this.loadMirror === 'X' || this.loadMirror === 'XY') m = compose(scale(-1, 1), m)
    if (this.loadMirror === 'Y' || this.loadMirror === 'XY') m = compose(scale(1, -1), m)
    if (this.loadRotation) m = compose(rotate(this.loadRotation), m)
    if (this.loadScale !== 1) m = compose(scale(this.loadScale), m)
    this.loadMatrix = m
    this.loadKey = isIdentity(m) ? '' : m.join(',')
  }

  private updateImage(): void {
    let m: Affine = IDENTITY
    if (this.swapAxes) m = [0, 1, 1, 0, 0, 0]
    if (this.mirrorA) m = compose(scale(-1, 1), m)
    if (this.mirrorB) m = compose(scale(1, -1), m)
    if (this.scaleA !== 1 || this.scaleB !== 1) m = compose(scale(this.scaleA, this.scaleB), m)
    if (this.imageRot) m = compose(rotate(this.imageRot), m)
    if (this.offA || this.offB) m = compose(translate(this.offA, this.offB), m)
    this.image = m
  }

  private handleAD(rest: string): void {
    const m = /^D(\d+)([^,]+?)(?:,(.*))?$/.exec(rest)
    if (!m) {
      this.warn(`Cannot parse aperture definition %AD${rest}`)
      return
    }
    const code = parseInt(m[1], 10)
    const name = m[2].trim()
    const params = m[3] ? m[3].split(/X/).map((s) => parseFloat(s)) : []
    for (const p of params) if (!Number.isFinite(p)) throw new Error(`bad aperture parameter in %AD${rest}`)
    const f = this.unitFactor
    if (!this.units && !this.unitsWarned) {
      this.unitsWarned = true
      this.warn('No unit mode (%MO) before first use; assuming inches')
    }
    const ap: Aperture = {
      code,
      type: 'C',
      shape: [],
      diameter: 0,
      width: 0,
      attributes: { ...this.apAttrs },
      cache: new Map()
    }
    const hole = (from: number): number[] => params.slice(from).map((v) => v * f)
    if (name === 'C' && !this.macros.has(name)) {
      const d = (params[0] ?? 0) * f
      ap.diameter = d
      ap.width = d
      ap.shape = d > 0 ? [withHole(circlePath(0, 0, d / 2), hole(1))] : []
    } else if (name === 'R' && !this.macros.has(name)) {
      const w = (params[0] ?? 0) * f
      const h = (params[1] ?? 0) * f
      ap.type = 'R'
      ap.width = Math.min(w, h)
      ap.shape = w > 0 && h > 0 ? [withHole(rectPath(0, 0, w, h), hole(2))] : []
    } else if (name === 'O' && !this.macros.has(name)) {
      const w = (params[0] ?? 0) * f
      const h = (params[1] ?? 0) * f
      ap.type = 'O'
      ap.width = Math.min(w, h)
      ap.shape = w > 0 && h > 0 ? [withHole(obroundPath(w, h), hole(2))] : []
    } else if (name === 'P' && !this.macros.has(name)) {
      const d = (params[0] ?? 0) * f
      const n = params[1] ?? 3
      ap.type = 'P'
      ap.width = d
      ap.shape = d > 0 ? [withHole(regularPolygonPath(0, 0, d, n, params[2] ?? 0), hole(3))] : []
    } else {
      const macro = this.macros.get(name)
      if (!macro) {
        this.warn(`Aperture D${code} uses undefined macro "${name}"`)
        ap.type = 'macro'
      } else {
        ap.type = 'macro'
        ap.shape = evalMacro(macro, params, f, (msg) => this.warn(msg))
        const b = polygonSetBBox(ap.shape)
        ap.width = bboxIsEmpty(b) ? 0 : Math.min(b.maxX - b.minX, b.maxY - b.minY)
      }
    }
    this.apertures.set(code, ap)
  }

  private handleSR(rest: string): void {
    const top = this.sinks[this.sinks.length - 1]
    if (top && top.kind === 'sr') this.closeStepRepeat()
    if (!rest) return
    const x = Math.round(num(/X(\d+)/.exec(rest)?.[1], 1))
    const y = Math.round(num(/Y(\d+)/.exec(rest)?.[1], 1))
    const i = num(/I([+-]?[\d.]+)/.exec(rest)?.[1]) * this.unitFactor
    const j = num(/J([+-]?[\d.]+)/.exec(rest)?.[1]) * this.unitFactor
    if (x <= 1 && y <= 1) return
    this.sinks.push({ kind: 'sr', objects: [], x: Math.max(1, x), y: Math.max(1, y), i, j })
  }

  private closeStepRepeat(): void {
    const s = this.sinks.pop()
    if (!s || s.kind !== 'sr') return
    for (let iy = 0; iy < s.y; iy++) {
      for (let ix = 0; ix < s.x; ix++) {
        const m = translate(ix * s.i, iy * s.j)
        for (const o of s.objects) this.emit(ix === 0 && iy === 0 ? o : transformObject(o, m, false))
      }
    }
  }

  private handleAB(rest: string): void {
    if (!rest) {
      const top = this.sinks[this.sinks.length - 1]
      if (!top || top.kind !== 'ab') return this.warn('%AB close without open block')
      return this.closeBlock()
    }
    const m = /^D(\d+)/.exec(rest)
    if (!m) return this.warn(`Cannot parse %AB${rest}`)
    this.sinks.push({ kind: 'ab', code: parseInt(m[1], 10), objects: [] })
  }

  private closeBlock(): void {
    const s = this.sinks.pop()
    if (!s || s.kind !== 'ab') return
    this.apertures.set(s.code, {
      code: s.code,
      type: 'block',
      shape: [],
      diameter: 0,
      width: 0,
      attributes: { ...this.apAttrs },
      block: s.objects,
      cache: new Map()
    })
  }

  private handleAttribute(c: string): void {
    const cmd = c.slice(0, 2)
    const body = c.slice(2)
    const comma = body.indexOf(',')
    const name = (comma < 0 ? body : body.slice(0, comma)).trim()
    const value = comma < 0 ? '' : body.slice(comma + 1)
    if (cmd === 'TF') {
      if (name) this.fileAttributes[name] = value
    } else if (cmd === 'TA') {
      if (name) this.apAttrs[name] = value
    } else if (cmd === 'TO') {
      if (name) this.objAttrs[name] = value
    } else {
      if (!name) {
        this.apAttrs = {}
        this.objAttrs = {}
      } else {
        delete this.apAttrs[name]
        delete this.objAttrs[name]
      }
    }
    this.attrVersion++
  }

  // ─────────────────────────────────────────── data words

  private handleWord(text: string): void {
    if (/^G0*4(?!\d)/.test(text)) {
      // Comment. KiCad (pre-X2) embeds attributes as "G04 #@! TF.FileFunction,...".
      const m = /^G0*4\s*#@!\s*(T[FAOD].*)$/.exec(text)
      if (m) this.handleAttribute(m[1].trim())
      return
    }
    const w = text.replace(/\s+/g, '')
    const re = /([A-Z])([+-]?[\d.]*)/g
    let x: string | undefined
    let y: string | undefined
    let i: string | undefined
    let j: string | undefined
    let d: number | undefined
    let m: RegExpExecArray | null
    let consumed = 0
    while ((m = re.exec(w))) {
      if (m.index !== consumed) throw new Error(`cannot parse "${text.slice(0, 40)}"`)
      consumed = m.index + m[0].length
      if (m[0].length === 0) break
      const letter = m[1]
      const val = m[2]
      switch (letter) {
        case 'G':
          this.handleG(parseInt(val, 10))
          break
        case 'M': {
          const mc = parseInt(val, 10)
          if (mc === 2 || mc === 0 || mc === 1) {
            if (mc !== 2) this.warn(`Deprecated M0${mc} treated as end of file`)
            this.ended = true
          } else this.warn(`Unknown M${val} ignored`)
          break
        }
        case 'X':
          x = val
          break
        case 'Y':
          y = val
          break
        case 'I':
          i = val
          break
        case 'J':
          j = val
          break
        case 'D':
          d = parseInt(val, 10)
          break
        case 'N':
          break // legacy sequence number
        default:
          this.warn(`Unknown word ${letter}${val} ignored`)
      }
    }
    if (consumed !== w.length) throw new Error(`cannot parse "${text.slice(0, 40)}"`)

    if (d !== undefined && d >= 10) {
      const ap = this.apertures.get(d)
      if (!ap) this.warn(`Aperture D${d} selected but not defined`)
      this.aperture = ap ?? null
      return
    }
    const hasCoord = x !== undefined || y !== undefined || i !== undefined || j !== undefined
    if (d === undefined) {
      if (!hasCoord) return
      this.warn('Coordinate data without D code (deprecated modal D01/D02/D03)')
      d = this.lastOp
    }
    if (d < 1 || d > 3) {
      this.warn(`Unknown operation D${d}`)
      return
    }
    this.lastOp = d
    const target: Vec2 = {
      x: x !== undefined ? this.coord(x, 'x') : this.cur.x,
      y: y !== undefined ? this.coord(y, 'y') : this.cur.y
    }
    const off: Vec2 = {
      x: i !== undefined ? this.coord(i, 'x') : 0,
      y: j !== undefined ? this.coord(j, 'y') : 0
    }
    if (d === 1) this.opInterpolate(target, off)
    else if (d === 2) this.opMove()
    else this.opFlash(target)
    this.cur = target
  }

  private handleG(g: number): void {
    switch (g) {
      case 1:
        this.interp = 'linear'
        return
      case 2:
        this.interp = 'cw'
        return
      case 3:
        this.interp = 'ccw'
        return
      case 74:
        this.quadrant = 'single'
        return
      case 75:
        this.quadrant = 'multi'
        return
      case 36:
        if (this.region) this.warn('G36 inside region')
        this.region = true
        this.contour = []
        this.regionContours = []
        return
      case 37:
        if (!this.region) return this.warn('G37 without G36')
        return this.endRegion()
      case 70:
        this.warn('Deprecated G70 (inch) unit command')
        return this.setUnits('inch')
      case 71:
        this.warn('Deprecated G71 (mm) unit command')
        return this.setUnits('mm')
      case 90:
        return
      case 91:
        return this.warn('Deprecated G91 incremental mode; coordinates treated as absolute')
      case 54:
      case 55:
        return
      case 10:
      case 11:
      case 12:
        this.warn(`Deprecated G${g} (scaled linear interpolation) treated as G01`)
        this.interp = 'linear'
        return
      default:
        this.warn(`Unknown G${g} ignored`)
    }
  }

  private coord(s: string, axis: 'x' | 'y'): number {
    if (s === '' || s === '+' || s === '-') return 0
    if (s.includes('.')) return parseFloat(s) * this.unitFactor
    if (!this.fsSeen) {
      this.fsSeen = true
      this.warn('No format specification (%FS); assuming leading-zero omission, 3.6 digits')
    }
    if (!this.units && !this.unitsWarned) {
      this.unitsWarned = true
      this.warn('No unit mode (%MO) before first use; assuming inches')
    }
    const neg = s[0] === '-'
    let digits = s[0] === '-' || s[0] === '+' ? s.slice(1) : s
    const int = axis === 'x' ? this.fmt.xi : this.fmt.yi
    const dec = axis === 'x' ? this.fmt.xd : this.fmt.yd
    if (this.fmt.zeros === 'T') digits = digits.padEnd(int + dec, '0')
    const v = parseInt(digits, 10) / Math.pow(10, dec)
    return (neg ? -v : v) * this.unitFactor
  }

  // ─────────────────────────────────────────── operations

  private arcPath(start: Vec2, end: Vec2, off: Vec2): Path {
    const cwDir = this.interp === 'cw'
    let mode = this.quadrant
    if (!mode) {
      mode = off.x < 0 || off.y < 0 ? 'multi' : 'single'
      this.warn(`Arc without G74/G75; assuming ${mode === 'multi' ? 'multi' : 'single'}-quadrant mode`)
    }
    if (mode === 'multi') {
      return arcPoints(start, end, { x: start.x + off.x, y: start.y + off.y }, cwDir)
    }
    // Single quadrant: unsigned offsets; choose the centre giving a sweep ≤ 90° with matching radii.
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-9) return [start, end]
    const ai = Math.abs(off.x)
    const aj = Math.abs(off.y)
    let best: Vec2 | null = null
    let bestErr = Infinity
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        const c = { x: start.x + sx * ai, y: start.y + sy * aj }
        const r1 = Math.hypot(start.x - c.x, start.y - c.y)
        const r2 = Math.hypot(end.x - c.x, end.y - c.y)
        const a0 = Math.atan2(start.y - c.y, start.x - c.x)
        const a1 = Math.atan2(end.y - c.y, end.x - c.x)
        let sweep = cwDir ? a0 - a1 : a1 - a0
        while (sweep < 0) sweep += Math.PI * 2
        while (sweep >= Math.PI * 2) sweep -= Math.PI * 2
        if (sweep > Math.PI / 2 + 1e-6) continue
        const err = Math.abs(r1 - r2)
        if (err < bestErr) {
          bestErr = err
          best = c
        }
      }
    }
    if (!best) {
      this.warn('Single-quadrant arc with no valid centre; drawn as straight line')
      return [start, end]
    }
    return arcPoints(start, end, best, cwDir)
  }

  private opInterpolate(target: Vec2, off: Vec2): void {
    const start = this.cur
    const isArc = this.interp !== 'linear'
    const path = isArc ? this.arcPath(start, target, off) : [start, target]
    if (this.region) {
      if (this.contour.length === 0) this.contour.push(start)
      for (let k = 1; k < path.length; k++) this.contour.push(path[k])
      return
    }
    const ap = this.aperture
    if (!ap) {
      this.warn('D01 draw without an aperture selected; ignored')
      return
    }
    if (ap.type === 'block') {
      this.warn('Draw with a block aperture is not allowed; ignored')
      return
    }
    const s = this.loadScale
    let shape: PolygonSet
    let width: number
    if (ap.type === 'C') {
      width = ap.diameter * Math.abs(s)
      const r = width / 2
      if (r <= 0) shape = []
      else if (!isArc) shape = [{ outer: stadiumPath(start, target, r), holes: [] }]
      else shape = strokePaths([path], width)
    } else {
      if (ap.type !== 'R')
        this.warn(`Draw with ${ap.type === 'macro' ? 'macro' : ap.type} aperture approximated by convex hull`)
      width = ap.width * Math.abs(s)
      const apShape = this.apertureShape(ap)
      const outer = apShape.length ? apShape[0].outer : []
      if (outer.length < 3) shape = []
      else {
        const hulls: Path[] = []
        for (let k = 1; k < path.length; k++) {
          const a = path[k - 1]
          const b = path[k]
          const pts: Vec2[] = []
          for (const v of outer) {
            pts.push({ x: v.x + a.x, y: v.y + a.y }, { x: v.x + b.x, y: v.y + b.y })
          }
          hulls.push(convexHull(pts))
        }
        shape = hulls.length === 1 ? [{ outer: hulls[0], holes: [] }] : unionPaths(hulls)
      }
    }
    this.emit({
      kind: isArc ? 'arc' : 'draw',
      polarity: this.polarity,
      aperture: ap.code,
      attributes: this.attrsFor(ap),
      shape,
      path,
      width
    })
  }

  private opMove(): void {
    if (this.region) this.closeContour()
  }

  private opFlash(target: Vec2): void {
    if (this.region) {
      this.warn('D03 flash inside a region is not allowed; ignored')
      return
    }
    const ap = this.aperture
    if (!ap) {
      this.warn('D03 flash without an aperture selected; ignored')
      return
    }
    if (ap.type === 'block') {
      const m = compose(translate(target.x, target.y), this.loadMatrix)
      const invert = this.polarity === 'clear'
      for (const o of ap.block ?? []) this.emit(transformObject(o, m, invert))
      return
    }
    this.emit({
      kind: 'flash',
      polarity: this.polarity,
      aperture: ap.code,
      attributes: this.attrsFor(ap),
      shape: translateSet(this.apertureShape(ap), target.x, target.y),
      center: { x: target.x, y: target.y },
      width: 0
    })
  }

  private apertureShape(ap: Aperture): PolygonSet {
    if (!this.loadKey) return ap.shape
    let s = ap.cache.get(this.loadKey)
    if (!s) {
      s = transformPolygonSet(this.loadMatrix, ap.shape)
      ap.cache.set(this.loadKey, s)
    }
    return s
  }

  private closeContour(): void {
    if (this.contour.length >= 3) this.regionContours.push(this.contour)
    else if (this.contour.length > 0) this.warn('Region contour with fewer than 3 points ignored')
    this.contour = []
  }

  private endRegion(): void {
    this.closeContour()
    this.region = false
    const attrs = this.attrsFor(null)
    for (const c of this.regionContours) {
      this.emit({
        kind: 'region',
        polarity: this.polarity,
        aperture: -1,
        attributes: attrs,
        shape: unionPaths([c], true),
        path: c,
        width: 0
      })
    }
    this.regionContours = []
  }

  private attrsFor(ap: Aperture | null): Attrs | undefined {
    const key = ap ? ap.code : -1
    // Merged records are shared between objects until an attribute or the aperture changes.
    const hit = this.attrCache.get(key)
    if (hit && hit.version === this.attrVersion && hit.ap === ap) return hit.attrs
    const base = ap ? ap.attributes : this.apAttrs
    const merged: Attrs = { ...base, ...this.objAttrs }
    const attrs = Object.keys(merged).length ? merged : undefined
    this.attrCache.set(key, { version: this.attrVersion, ap, attrs })
    return attrs
  }

  // ─────────────────────────────────────────── output

  private emit(o: RawObject): void {
    const top = this.sinks[this.sinks.length - 1]
    if (top) {
      top.objects.push(o)
      return
    }
    const f = isIdentity(this.image) ? o : transformObject(o, this.image, false)
    const obj: GerberObject = {
      id: this.objects.length,
      kind: f.kind,
      polarity: f.polarity,
      aperture: f.aperture,
      shape: f.shape,
      width: f.width
    }
    if (f.attributes) obj.attributes = f.attributes
    if (f.center) obj.center = f.center
    if (f.path) obj.path = f.path
    this.objects.push(obj)
    if ((f.kind === 'draw' || f.kind === 'arc') && f.path) this.strokes.push({ path: f.path, width: f.width })
    if (f.shape.length === 0) return
    if (f.polarity !== this.batchPolarity) this.flush()
    this.batchPolarity = f.polarity
    this.batch.push(f.shape)
  }

  /** Merges the pending same-polarity batch into the accumulated geometry. */
  private flush(): void {
    if (this.batch.length === 0) return
    if (this.batchPolarity === 'dark') this.acc = union(this.acc, ...this.batch)
    else if (this.acc.length) this.acc = difference(this.acc, ([] as PolygonSet).concat(...this.batch))
    this.batch = []
  }
}

export function parseGerberText(text: string, _opts?: ParseGerberOptions): ParsedLayer {
  return new GerberParser().parse(text)
}
