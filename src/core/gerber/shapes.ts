/**
 * Cheap primitive shape builders used by the Gerber parser. These build polygons directly
 * (no Clipper call) so per-object shapes stay inexpensive; the final layer union happens in batches.
 */
import { circlePath, circleSegments, pathArea, rectPath } from '../geometry'
import type { Path, Polygon, PolygonSet, Vec2 } from '../model/types'

/** Returns `p` oriented CCW (positive area). */
export function ccw(p: Path): Path {
  return pathArea(p) < 0 ? p.slice().reverse() : p
}

/** Returns `p` oriented CW (negative area), as needed for holes. */
export function cw(p: Path): Path {
  return pathArea(p) > 0 ? p.slice().reverse() : p
}

/** Round-capped segment (Minkowski sum of a segment and a disc of radius r), CCW. */
export function stadiumPath(a: Vec2, b: Vec2, r: number): Path {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.hypot(dx, dy) < 1e-12) return circlePath(a.x, a.y, r)
  const th = Math.atan2(dy, dx)
  const half = Math.max(4, Math.ceil(circleSegments(r) / 2))
  const out: Path = []
  for (let i = 0; i <= half; i++) {
    const t = th - Math.PI / 2 + (Math.PI * i) / half
    out.push({ x: b.x + r * Math.cos(t), y: b.y + r * Math.sin(t) })
  }
  for (let i = 0; i <= half; i++) {
    const t = th + Math.PI / 2 + (Math.PI * i) / half
    out.push({ x: a.x + r * Math.cos(t), y: a.y + r * Math.sin(t) })
  }
  return out
}

/** Obround (stadium) of overall size w × h centred at origin, CCW. */
export function obroundPath(w: number, h: number): Path {
  if (Math.abs(w - h) < 1e-12) return circlePath(0, 0, w / 2)
  if (w > h) return stadiumPath({ x: -(w - h) / 2, y: 0 }, { x: (w - h) / 2, y: 0 }, h / 2)
  return stadiumPath({ x: 0, y: -(h - w) / 2 }, { x: 0, y: (h - w) / 2 }, w / 2)
}

/** Regular polygon with n vertices on a circle of diameter d, first vertex at `rotDeg`. CCW. */
export function regularPolygonPath(cx: number, cy: number, d: number, n: number, rotDeg: number): Path {
  const out: Path = []
  const r = d / 2
  const k = Math.max(3, Math.round(n))
  for (let i = 0; i < k; i++) {
    const a = ((rotDeg + (360 * i) / k) * Math.PI) / 180
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  }
  return out
}

/** Convex hull (monotone chain), CCW, without the closing point. */
export function convexHull(pts: Vec2[]): Path {
  const p = pts.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  if (p.length < 3) return p
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Vec2[] = []
  for (const v of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], v) <= 0) lower.pop()
    lower.push(v)
  }
  const upper: Vec2[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const v = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], v) <= 0) upper.pop()
    upper.push(v)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** Polygon with an optional centred circular (or rectangular, legacy) hole. */
export function withHole(outer: Path, hole: number[]): Polygon {
  if (hole.length >= 2 && hole[0] > 0 && hole[1] > 0) {
    return { outer: ccw(outer), holes: [cw(rectPath(0, 0, hole[0], hole[1]))] }
  }
  if (hole.length >= 1 && hole[0] > 0) {
    return { outer: ccw(outer), holes: [cw(circlePath(0, 0, hole[0] / 2))] }
  }
  return { outer: ccw(outer), holes: [] }
}

export function translateSet(set: PolygonSet, dx: number, dy: number): PolygonSet {
  const tp = (p: Path): Path => {
    const out: Path = new Array(p.length)
    for (let i = 0; i < p.length; i++) out[i] = { x: p[i].x + dx, y: p[i].y + dy }
    return out
  }
  return set.map((poly) => ({ outer: tp(poly.outer), holes: poly.holes.map(tp) }))
}
