/**
 * Aperture macros (%AM): parsing of the macro body into statements, arithmetic expressions with
 * variables, and evaluation of primitives into a normalised PolygonSet (mm, macro origin at 0,0).
 */
import {
  circlePath,
  difference,
  rectPath,
  rotate,
  transformPath,
  union,
  unionPaths,
  type Affine
} from '../geometry'
import type { Path, PolygonSet } from '../model/types'
import { ccw, regularPolygonPath } from './shapes'

type Expr = (vars: number[]) => number

export type MacroStatement =
  { kind: 'assign'; index: number; expr: Expr } | { kind: 'primitive'; code: number; args: Expr[] }

export interface MacroDef {
  name: string
  statements: MacroStatement[]
}

// ─────────────────────────────────────────── expressions

/** Compiles a macro arithmetic expression (+ - x X / parentheses, $n variables, unary sign). */
export function compileExpr(src: string): Expr {
  const s = src.replace(/\s+/g, '')
  let pos = 0
  const peek = (): string => s[pos] ?? ''

  function primary(): Expr {
    const c = peek()
    if (c === '(') {
      pos++
      const e = additive()
      if (peek() === ')') pos++
      else throw new Error(`missing ')' in "${src}"`)
      return e
    }
    if (c === '+' || c === '-') {
      pos++
      const e = primary()
      return c === '-' ? (v) => -e(v) : e
    }
    if (c === '$') {
      pos++
      const m = /^\d+/.exec(s.slice(pos))
      if (!m) throw new Error(`bad variable in "${src}"`)
      pos += m[0].length
      const idx = parseInt(m[0], 10)
      return (v) => v[idx] ?? 0
    }
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(pos))
    if (!m) throw new Error(`unexpected "${c}" in "${src}"`)
    pos += m[0].length
    const num = parseFloat(m[0])
    return () => num
  }

  function multiplicative(): Expr {
    let left = primary()
    for (;;) {
      const c = peek()
      if (c === 'x' || c === 'X' || c === '/') {
        pos++
        const l = left
        const r = primary()
        left = c === '/' ? (v) => l(v) / r(v) : (v) => l(v) * r(v)
      } else return left
    }
  }

  function additive(): Expr {
    let left = multiplicative()
    for (;;) {
      const c = peek()
      if (c === '+' || c === '-') {
        pos++
        const l = left
        const r = multiplicative()
        left = c === '+' ? (v) => l(v) + r(v) : (v) => l(v) - r(v)
      } else return left
    }
  }

  if (s === '') return () => 0
  const e = additive()
  if (pos !== s.length) throw new Error(`trailing characters in "${src}"`)
  return e
}

// ─────────────────────────────────────────── parsing

/** Parses the statements of a %AM block (everything after the `AMname` command). */
export function parseMacro(name: string, body: string[], warn: (m: string) => void): MacroDef {
  const statements: MacroStatement[] = []
  for (const raw of body) {
    const st = raw.trim()
    if (!st) continue
    // Primitive 0: comment, rest of the statement is free text.
    if (/^0(?![\d.])/.test(st)) continue
    if (st.startsWith('$')) {
      const m = /^\$(\d+)\s*=(.*)$/.exec(st)
      if (!m) {
        warn(`Macro ${name}: cannot parse statement "${st}"`)
        continue
      }
      try {
        statements.push({ kind: 'assign', index: parseInt(m[1], 10), expr: compileExpr(m[2]) })
      } catch (e) {
        warn(`Macro ${name}: ${(e as Error).message}`)
      }
      continue
    }
    const parts = st.split(',')
    const code = parseInt(parts[0], 10)
    if (!Number.isFinite(code)) {
      warn(`Macro ${name}: cannot parse statement "${st}"`)
      continue
    }
    try {
      statements.push({ kind: 'primitive', code, args: parts.slice(1).map(compileExpr) })
    } catch (e) {
      warn(`Macro ${name}: ${(e as Error).message}`)
    }
  }
  return { name, statements }
}

// ─────────────────────────────────────────── evaluation

function rotated(paths: Path[], deg: number): Path[] {
  if (!deg) return paths
  const m: Affine = rotate(deg)
  return paths.map((p) => transformPath(m, p))
}

/** Vector line: rectangle of width w from s to e (butt ends). */
function vectorLine(w: number, sx: number, sy: number, ex: number, ey: number): Path | null {
  const len = Math.hypot(ex - sx, ey - sy)
  if (len < 1e-12 || w <= 0) return null
  const nx = (-(ey - sy) / len) * (w / 2)
  const ny = ((ex - sx) / len) * (w / 2)
  return ccw([
    { x: sx + nx, y: sy + ny },
    { x: sx - nx, y: sy - ny },
    { x: ex - nx, y: ey - ny },
    { x: ex + nx, y: ey + ny }
  ])
}

/**
 * Evaluates a macro with the given AD parameters ($1..$n, in file units).
 * `f` converts file units to mm. Returns a normalised PolygonSet.
 */
export function evalMacro(def: MacroDef, params: number[], f: number, warn: (m: string) => void): PolygonSet {
  const vars: number[] = [0, ...params]
  let acc: PolygonSet = []
  let dark: PolygonSet[] = []

  const add = (shape: PolygonSet, exposure: number): void => {
    if (shape.length === 0) return
    if (exposure === 0) {
      if (dark.length || acc.length) {
        acc = union(acc, ...dark)
        dark = []
        acc = difference(acc, shape)
      }
    } else dark.push(shape)
  }
  const exposureOf = (v: number, prim: number): number => {
    const e = Math.round(v)
    if (e === 2) {
      warn(`Macro ${def.name}: exposure 2 (toggle) in primitive ${prim} treated as on`)
      return 1
    }
    return e === 0 ? 0 : 1
  }

  for (const st of def.statements) {
    if (st.kind === 'assign') {
      vars[st.index] = st.expr(vars)
      continue
    }
    const a = st.args.map((e) => e(vars))
    const arg = (i: number): number => (Number.isFinite(a[i]) ? a[i] : 0)
    switch (st.code) {
      case 1: {
        // circle: exposure, diameter, cx, cy, [rotation]
        const d = arg(1) * f
        if (d <= 0) break
        const paths = rotated([circlePath(arg(2) * f, arg(3) * f, d / 2)], arg(4))
        add(unionPaths(paths), exposureOf(arg(0), 1))
        break
      }
      case 2:
      case 20: {
        // vector line: exposure, width, sx, sy, ex, ey, rotation
        const p = vectorLine(arg(1) * f, arg(2) * f, arg(3) * f, arg(4) * f, arg(5) * f)
        if (p) add(unionPaths(rotated([p], arg(6))), exposureOf(arg(0), st.code))
        break
      }
      case 21: {
        // center line: exposure, width, height, cx, cy, rotation
        const w = arg(1) * f
        const h = arg(2) * f
        if (w <= 0 || h <= 0) break
        add(unionPaths(rotated([rectPath(arg(3) * f, arg(4) * f, w, h)], arg(5))), exposureOf(arg(0), 21))
        break
      }
      case 22: {
        // lower-left line (deprecated): exposure, width, height, llx, lly, rotation
        warn(`Macro ${def.name}: deprecated primitive 22 (lower-left line)`)
        const w = arg(1) * f
        const h = arg(2) * f
        if (w <= 0 || h <= 0) break
        const r = rectPath(arg(3) * f + w / 2, arg(4) * f + h / 2, w, h)
        add(unionPaths(rotated([r], arg(5))), exposureOf(arg(0), 22))
        break
      }
      case 4: {
        // outline: exposure, n, x0, y0, ..., xn, yn, rotation
        const n = Math.round(arg(1))
        const pts: Path = []
        for (let i = 0; i <= n && 2 + 2 * i + 1 < a.length; i++) {
          pts.push({ x: arg(2 + 2 * i) * f, y: arg(3 + 2 * i) * f })
        }
        const rot = a.length >= 2 * n + 5 ? arg(2 * n + 4) : 0
        if (pts.length > 1) {
          const l = pts[pts.length - 1]
          if (Math.abs(l.x - pts[0].x) < 1e-12 && Math.abs(l.y - pts[0].y) < 1e-12) pts.pop()
        }
        if (pts.length < 3) {
          warn(`Macro ${def.name}: outline primitive with fewer than 3 points ignored`)
          break
        }
        add(unionPaths(rotated([ccw(pts)], rot)), exposureOf(arg(0), 4))
        break
      }
      case 5: {
        // polygon: exposure, n, cx, cy, diameter, rotation
        const d = arg(4) * f
        if (d <= 0) break
        const p = regularPolygonPath(arg(2) * f, arg(3) * f, d, arg(1), 0)
        add(unionPaths(rotated([p], arg(5))), exposureOf(arg(0), 5))
        break
      }
      case 6: {
        // moiré (deprecated): cx, cy, outer dia, ring thickness, gap, max rings, crosshair thickness,
        // crosshair length, rotation
        warn(`Macro ${def.name}: deprecated moiré primitive (6)`)
        const cx = arg(0) * f
        const cy = arg(1) * f
        const t = arg(3) * f
        const g = arg(4) * f
        const maxRings = Math.round(arg(5))
        const ct = arg(6) * f
        const cl = arg(7) * f
        const rot = arg(8)
        let shape: PolygonSet = []
        let od = arg(2) * f
        for (let k = 0; k < maxRings && od > 0; k++) {
          const outer = unionPaths([circlePath(cx, cy, od / 2)])
          const id = od - 2 * t
          const ring = id > 0 ? difference(outer, unionPaths([circlePath(cx, cy, id / 2)])) : outer
          shape = union(shape, ring)
          od -= 2 * (t + g)
        }
        const cross: Path[] = []
        if (ct > 0 && cl > 0) cross.push(rectPath(cx, cy, cl, ct), rectPath(cx, cy, ct, cl))
        shape = union(shape, unionPaths(cross))
        add(
          unionPaths(
            rotated(
              shape.flatMap((p) => [p.outer, ...p.holes]),
              rot
            )
          ),
          1
        )
        break
      }
      case 7: {
        // thermal: cx, cy, outer dia, inner dia, gap, rotation
        const cx = arg(0) * f
        const cy = arg(1) * f
        const od = arg(2) * f
        const id = arg(3) * f
        const gap = arg(4) * f
        const rot = arg(5)
        if (od <= 0) break
        let ring = unionPaths([circlePath(cx, cy, od / 2)])
        if (id > 0) ring = difference(ring, unionPaths([circlePath(cx, cy, id / 2)]))
        if (gap > 0) {
          ring = difference(
            ring,
            unionPaths([rectPath(cx, cy, od * 1.1, gap), rectPath(cx, cy, gap, od * 1.1)])
          )
        }
        add(
          unionPaths(
            rotated(
              ring.flatMap((p) => [p.outer, ...p.holes]),
              rot
            )
          ),
          1
        )
        break
      }
      default:
        warn(`Macro ${def.name}: unsupported primitive code ${st.code} ignored`)
    }
  }
  return dark.length ? union(acc, ...dark) : acc
}
