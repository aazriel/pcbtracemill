/**
 * Geometry kernel: thin, typed wrapper around Clipper2 (clipper2-js).
 * All public functions take and return millimetre float geometry; integer scaling is internal.
 */
import {
  Clipper,
  Clipper64,
  ClipperOffset,
  ClipType,
  EndType,
  FillRule,
  JoinType,
  PointInPolygonResult,
  type Path64,
  type Paths64
} from 'clipper2-ts'
import type { BBox, Path, Polygon, PolygonSet, Vec2 } from '../model/types'

/** Integer units per mm (0.1 µm resolution). */
export const SCALE = 10000
/** Default chord tolerance for arc/circle discretisation, mm. */
export const ARC_TOLERANCE = 0.005

// ─────────────────────────────────────────── conversions

function toPath64(p: Path): Path64 {
  const out: Path64 = new Array(p.length)
  for (let i = 0; i < p.length; i++) out[i] = { x: Math.round(p[i].x * SCALE), y: Math.round(p[i].y * SCALE) }
  return out
}

function fromPath64(p: Path64): Path {
  const out: Path = new Array(p.length)
  for (let i = 0; i < p.length; i++) out[i] = { x: p[i].x / SCALE, y: p[i].y / SCALE }
  return out
}

function toPaths64(ps: Path[]): Paths64 {
  const out: Paths64 = []
  for (const p of ps) if (p.length >= 2) out.push(toPath64(p))
  return out
}

function polySetToPaths64(set: PolygonSet): Paths64 {
  const out: Paths64 = []
  for (const poly of set) {
    if (poly.outer.length >= 3) out.push(toPath64(poly.outer))
    for (const h of poly.holes) if (h.length >= 3) out.push(toPath64(h))
  }
  return out
}

/**
 * Rebuilds polygon nesting from flat Clipper output. Clipper emits outers with positive
 * orientation and holes negative; each hole is assigned to the smallest outer containing it.
 */
function flatToPolygonSet(paths: Paths64): PolygonSet {
  const outers: { path: Path64; area: number; poly: Polygon }[] = []
  const holes: { path: Path64; area: number }[] = []
  for (const p of paths) {
    if (p.length < 3) continue
    const a = Clipper.area(p)
    if (a > 0) outers.push({ path: p, area: a, poly: { outer: fromPath64(p), holes: [] } })
    else if (a < 0) holes.push({ path: p, area: -a })
  }
  outers.sort((x, y) => x.area - y.area)
  for (const h of holes) {
    for (const o of outers) {
      if (o.area < h.area) continue
      // Use a vertex strictly inside if possible: test every vertex until not "on".
      let res = PointInPolygonResult.IsOn
      for (const v of h.path) {
        res = Clipper.pointInPolygon(v, o.path)
        if (res !== PointInPolygonResult.IsOn) break
      }
      if (res !== PointInPolygonResult.IsOutside) {
        o.poly.holes.push(fromPath64(h.path))
        break
      }
    }
  }
  return outers.reverse().map((o) => o.poly)
}

function runOp(type: ClipType, subject: Paths64, clip: Paths64 | null, fillRule: FillRule): PolygonSet {
  const c = new Clipper64()
  c.addSubject(subject)
  if (clip) c.addClip(clip)
  const out: Paths64 = []
  c.execute(type, fillRule, out)
  return flatToPolygonSet(out)
}

/** Builds a normalised PolygonSet (outer CCW, holes CW, nested correctly) from loose closed paths. */
function pathsToPolygonSet(paths: Paths64, fillRule: FillRule = FillRule.NonZero): PolygonSet {
  return runOp(ClipType.Union, paths, null, fillRule)
}

// ─────────────────────────────────────────── public API

export const emptyBBox = (): BBox => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })

export function bboxIsEmpty(b: BBox): boolean {
  return !(b.minX <= b.maxX && b.minY <= b.maxY)
}

export function bboxExtend(b: BBox, p: Vec2): BBox {
  if (p.x < b.minX) b.minX = p.x
  if (p.y < b.minY) b.minY = p.y
  if (p.x > b.maxX) b.maxX = p.x
  if (p.y > b.maxY) b.maxY = p.y
  return b
}

export function bboxUnion(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  }
}

export function pathsBBox(paths: Path[]): BBox {
  const b = emptyBBox()
  for (const p of paths) for (const v of p) bboxExtend(b, v)
  return b
}

export function polygonSetBBox(set: PolygonSet): BBox {
  const b = emptyBBox()
  for (const poly of set) for (const v of poly.outer) bboxExtend(b, v)
  return b
}

/** Signed area of a path (positive = CCW). */
export function pathArea(p: Path): number {
  let a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j].x + p[i].x) * (p[j].y - p[i].y)
  return -a / 2
}

/** Net area of a polygon set (outer minus holes), mm². */
export function polygonSetArea(set: PolygonSet): number {
  let a = 0
  for (const poly of set) {
    a += Math.abs(pathArea(poly.outer))
    for (const h of poly.holes) a -= Math.abs(pathArea(h))
  }
  return a
}

export function polygonArea(poly: Polygon): number {
  return polygonSetArea([poly])
}

export function countPoints(set: PolygonSet): number {
  let n = 0
  for (const poly of set) {
    n += poly.outer.length
    for (const h of poly.holes) n += h.length
  }
  return n
}

/** Number of segments to approximate a full circle of radius r within ARC_TOLERANCE. */
export function circleSegments(r: number, tol = ARC_TOLERANCE): number {
  if (r <= tol) return 8
  const n = Math.ceil(Math.PI / Math.acos(1 - tol / r))
  return Math.max(12, Math.min(720, n))
}

/** CCW circle polygon path. */
export function circlePath(cx: number, cy: number, r: number, segments = circleSegments(r)): Path {
  const out: Path = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  }
  return out
}

/** CCW axis-aligned rectangle centred at (cx,cy). */
export function rectPath(cx: number, cy: number, w: number, h: number): Path {
  const x0 = cx - w / 2
  const y0 = cy - h / 2
  return [
    { x: x0, y: y0 },
    { x: x0 + w, y: y0 },
    { x: x0 + w, y: y0 + h },
    { x: x0, y: y0 + h }
  ]
}

/**
 * Discretise an arc from `start` to `end` about `center`. `clockwise` selects direction.
 * If start == end (within eps) a full circle is produced. Returns points including both endpoints.
 */
export function arcPoints(
  start: Vec2,
  end: Vec2,
  center: Vec2,
  clockwise: boolean,
  tol = ARC_TOLERANCE
): Path {
  const r = Math.hypot(start.x - center.x, start.y - center.y)
  const a0 = Math.atan2(start.y - center.y, start.x - center.x)
  let a1 = Math.atan2(end.y - center.y, end.x - center.x)
  const full = Math.hypot(start.x - end.x, start.y - end.y) < 1e-9
  let sweep: number
  if (full) sweep = clockwise ? -Math.PI * 2 : Math.PI * 2
  else {
    if (clockwise) {
      while (a1 >= a0) a1 -= Math.PI * 2
    } else {
      while (a1 <= a0) a1 += Math.PI * 2
    }
    sweep = a1 - a0
  }
  const segs = Math.max(2, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * circleSegments(r, tol)))
  const out: Path = []
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (sweep * i) / segs
    out.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) })
  }
  if (!full) out[out.length - 1] = { x: end.x, y: end.y }
  return out
}

/** Union of loose closed paths (NonZero fill unless evenOdd). */
export function unionPaths(paths: Path[], evenOdd = false): PolygonSet {
  return pathsToPolygonSet(toPaths64(paths), evenOdd ? FillRule.EvenOdd : FillRule.NonZero)
}

export function union(...sets: PolygonSet[]): PolygonSet {
  const all: Paths64 = []
  for (const s of sets) for (const p of polySetToPaths64(s)) all.push(p)
  return pathsToPolygonSet(all)
}

export function difference(subject: PolygonSet, clip: PolygonSet): PolygonSet {
  return runOp(ClipType.Difference, polySetToPaths64(subject), polySetToPaths64(clip), FillRule.NonZero)
}

export function intersection(subject: PolygonSet, clip: PolygonSet): PolygonSet {
  return runOp(ClipType.Intersection, polySetToPaths64(subject), polySetToPaths64(clip), FillRule.NonZero)
}

export function xor(subject: PolygonSet, clip: PolygonSet): PolygonSet {
  return runOp(ClipType.Xor, polySetToPaths64(subject), polySetToPaths64(clip), FillRule.NonZero)
}

/**
 * Offset (grow > 0 / shrink < 0) a polygon set by `delta` mm with round joins.
 * Result is normalised (unioned).
 */
export function offset(
  set: PolygonSet,
  delta: number,
  join: 'round' | 'miter' | 'square' = 'round'
): PolygonSet {
  if (set.length === 0) return []
  if (delta === 0) return union(set)
  const co = new ClipperOffset(2, ARC_TOLERANCE * SCALE)
  const jt = join === 'round' ? JoinType.Round : join === 'miter' ? JoinType.Miter : JoinType.Square
  co.addPaths(polySetToPaths64(set), jt, EndType.Polygon)
  const out: Paths64 = []
  co.execute(delta * SCALE, out)
  return pathsToPolygonSet(out)
}

/**
 * Stroke open polylines with a round-capped pen of the given width (Gerber circular aperture draw).
 */
export function strokePaths(
  paths: Path[],
  width: number,
  cap: 'round' | 'square' | 'butt' = 'round'
): PolygonSet {
  if (paths.length === 0 || width <= 0) return []
  const co = new ClipperOffset(2, ARC_TOLERANCE * SCALE)
  const et = cap === 'round' ? EndType.Round : cap === 'square' ? EndType.Square : EndType.Butt
  const jt = cap === 'round' ? JoinType.Round : JoinType.Miter
  const open: Paths64 = []
  const dots: Paths64 = []
  for (const p of paths) {
    if (p.length === 1 || (p.length === 2 && p[0].x === p[1].x && p[0].y === p[1].y)) {
      dots.push(toPath64(circlePath(p[0].x, p[0].y, width / 2)))
    } else if (p.length >= 2) open.push(toPath64(p))
  }
  const out: Paths64 = []
  if (open.length) {
    co.addPaths(open, jt, et)
    co.execute((width / 2) * SCALE, out)
  }
  for (const d of dots) out.push(d)
  return pathsToPolygonSet(out)
}

/** Remove polygons whose net area is below `minArea` mm². */
export function removeSmall(set: PolygonSet, minArea: number): PolygonSet {
  return set.filter((p) => polygonArea(p) >= minArea)
}

/** Simplify (Ramer–Douglas–Peucker) closed polygons with tolerance mm. */
export function simplify(set: PolygonSet, tol: number): PolygonSet {
  const paths = Clipper.simplifyPaths(polySetToPaths64(set), tol * SCALE, true)
  return pathsToPolygonSet(paths)
}

/** All rings (outer + holes) as closed paths. Outer rings CCW, holes CW. */
export function rings(set: PolygonSet): Path[] {
  const out: Path[] = []
  for (const p of set) {
    out.push(p.outer)
    for (const h of p.holes) out.push(h)
  }
  return out
}

/** Clip open polylines by a polygon set; returns pieces INSIDE the set. */
export function clipLinesInside(lines: Path[], region: PolygonSet): Path[] {
  const c = new Clipper64()
  c.addOpenSubject(toPaths64(lines))
  c.addClip(polySetToPaths64(region))
  const closed: Paths64 = []
  const open: Paths64 = []
  c.execute(ClipType.Intersection, FillRule.NonZero, closed, open)
  return open.map(fromPath64)
}

/** Clip open polylines by a polygon set; returns pieces OUTSIDE the set. */
export function clipLinesOutside(lines: Path[], region: PolygonSet): Path[] {
  const c = new Clipper64()
  c.addOpenSubject(toPaths64(lines))
  c.addClip(polySetToPaths64(region))
  const closed: Paths64 = []
  const open: Paths64 = []
  c.execute(ClipType.Difference, FillRule.NonZero, closed, open)
  return open.map(fromPath64)
}

export function pointInPolygonSet(pt: Vec2, set: PolygonSet): boolean {
  const p = { x: Math.round(pt.x * SCALE), y: Math.round(pt.y * SCALE) }
  for (const poly of set) {
    if (Clipper.pointInPolygon(p, toPath64(poly.outer)) === PointInPolygonResult.IsOutside) continue
    let inHole = false
    for (const h of poly.holes) {
      if (Clipper.pointInPolygon(p, toPath64(h)) === PointInPolygonResult.IsInside) {
        inHole = true
        break
      }
    }
    if (!inHole) return true
  }
  return false
}

// ─────────────────────────────────────────── affine transforms

/** 2D affine matrix [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Affine = [number, number, number, number, number, number]

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0]

export function compose(m2: Affine, m1: Affine): Affine {
  // returns m2 ∘ m1 (apply m1 first)
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [
    a2 * a1 + c2 * b1,
    b2 * a1 + d2 * b1,
    a2 * c1 + c2 * d1,
    b2 * c1 + d2 * d1,
    a2 * e1 + c2 * f1 + e2,
    b2 * e1 + d2 * f1 + f2
  ]
}

export const translate = (tx: number, ty: number): Affine => [1, 0, 0, 1, tx, ty]
export const scale = (sx: number, sy = sx): Affine => [sx, 0, 0, sy, 0, 0]
export function rotate(deg: number): Affine {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  // snap tiny values for exact 90° multiples
  const cs = Math.abs(c) < 1e-12 ? 0 : c
  const sn = Math.abs(s) < 1e-12 ? 0 : s
  return [cs, sn, -sn, cs, 0, 0]
}

export function applyAffine(m: Affine, p: Vec2): Vec2 {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

export function isMirroring(m: Affine): boolean {
  return m[0] * m[3] - m[1] * m[2] < 0
}

export function transformPath(m: Affine, p: Path): Path {
  const out = p.map((v) => applyAffine(m, v))
  return out
}

/** Transform a polygon set; fixes ring orientation when the transform mirrors. */
export function transformPolygonSet(m: Affine, set: PolygonSet): PolygonSet {
  const mir = isMirroring(m)
  return set.map((poly) => {
    const outer = transformPath(m, poly.outer)
    const holes = poly.holes.map((h) => transformPath(m, h))
    if (mir) {
      outer.reverse()
      holes.forEach((h) => h.reverse())
    }
    return { outer, holes }
  })
}

export function pathLength(p: Path, closed = false): number {
  let len = 0
  for (let i = 1; i < p.length; i++) len += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)
  if (closed && p.length > 1) len += Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y)
  return len
}

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)
