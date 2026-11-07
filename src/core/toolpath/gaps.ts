/** Detection of places where separate copper features are too close for the tool to pass between. */
import type { BBox, ClearanceInfo, Path, Polygon, PolygonSet, Vec2 } from '../model/types'
import {
  countPoints,
  intersection,
  offset,
  polygonSetArea,
  polygonSetBBox,
  rectPath,
  union
} from '../geometry'
import { bboxOverlap } from './pathUtils'

interface Tile {
  bbox: BBox
  set: PolygonSet
}

const MAX_TILE_POINTS = 400

function rectSet(b: BBox): PolygonSet {
  return [
    {
      outer: rectPath((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, b.maxX - b.minX, b.maxY - b.minY),
      holes: []
    }
  ]
}

/** Recursively bisect a big polygon set so every tile has few vertices (keeps pairwise booleans cheap). */
function tile(set: PolygonSet, bbox: BBox, depth = 0): Tile[] {
  if (set.length === 0) return []
  if (countPoints(set) <= MAX_TILE_POINTS || depth >= 14) return [{ bbox: polygonSetBBox(set), set }]
  const w = bbox.maxX - bbox.minX
  const h = bbox.maxY - bbox.minY
  const a: BBox = { ...bbox }
  const b: BBox = { ...bbox }
  if (w >= h) {
    a.maxX = b.minX = bbox.minX + w / 2
  } else {
    a.maxY = b.minY = bbox.minY + h / 2
  }
  return [
    ...tile(intersection(set, rectSet(a)), a, depth + 1),
    ...tile(intersection(set, rectSet(b)), b, depth + 1)
  ]
}

export interface GapReport {
  /** Number of distinct narrow places. */
  count: number
  /** Approximate centre of each narrow place (same coordinates as the input). */
  locations: Vec2[]
  /** Actual distance between the two copper features at each place (same order as locations). */
  widths: number[]
  /** The closest points of the two features at each place, and the two polygon indexes. */
  ends: { a: Vec2; b: Vec2; i: number; j: number }[]
}

function segDist2(a: Vec2, b: Vec2, p: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l = dx * dx + dy * dy
  const t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0
  const x = a.x + t * dx - p.x
  const y = a.y + t * dy - p.y
  return x * x + y * y
}

function closestOn(a: Vec2, b: Vec2, p: Vec2): Vec2 {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l = dx * dx + dy * dy
  const t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0
  return { x: a.x + t * dx, y: a.y + t * dy }
}

/** Distance between two segments (they never cross: the polygons are separate features) and the closest points. */
function segSegClosest(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { d: number; p: Vec2; q: Vec2 } {
  const cands: [number, Vec2, Vec2][] = [
    [segDist2(a, b, c), closestOn(a, b, c), c],
    [segDist2(a, b, d), closestOn(a, b, d), d],
    [segDist2(c, d, a), a, closestOn(c, d, a)],
    [segDist2(c, d, b), b, closestOn(c, d, b)]
  ]
  let best = cands[0]
  for (const k of cands) if (k[0] < best[0]) best = k
  return { d: Math.sqrt(best[0]), p: best[1], q: best[2] }
}

function edgesNear(poly: Polygon, box: BBox): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = []
  const ringsOf: Path[] = [poly.outer, ...poly.holes]
  for (const r of ringsOf)
    for (let i = 0; i < r.length; i++) {
      const a = r[i]
      const b = r[(i + 1) % r.length]
      if (
        Math.max(a.x, b.x) >= box.minX &&
        Math.min(a.x, b.x) <= box.maxX &&
        Math.max(a.y, b.y) >= box.minY &&
        Math.min(a.y, b.y) <= box.maxY
      )
        out.push([a, b])
    }
  return out
}

/** Smallest distance between two polygons, looking only at edges inside `box`, and its end points. */
function distanceNear(pa: Polygon, pb: Polygon, box: BBox): { d: number; p: Vec2; q: Vec2 } {
  const ea = edgesNear(pa, box)
  const eb = edgesNear(pb, box)
  let best = { d: Infinity, p: { x: 0, y: 0 }, q: { x: 0, y: 0 } }
  for (const [a, b] of ea)
    for (const [c, d] of eb) {
      const k = segSegClosest(a, b, c, d)
      if (k.d < best.d) best = k
    }
  return best
}

/**
 * Finds places where two DIFFERENT copper polygons are closer than 2·`radius`: each polygon is grown
 * by `radius` individually and pairwise overlaps of the grown shapes are the narrow places.
 * Narrow slots inside a single polygon (e.g. a U-shaped trace) are not reported.
 */
export function findNarrowGaps(copper: PolygonSet, radius: number): GapReport {
  const report: GapReport = { count: 0, locations: [], widths: [], ends: [] }
  if (copper.length < 2 || radius <= 0) return report
  const r = radius * (1 - 1e-3) // features exactly 2r apart are fine
  const items = copper.map((poly) => {
    const b = polygonSetBBox([poly])
    return { poly, bbox: { minX: b.minX - r, minY: b.minY - r, maxX: b.maxX + r, maxY: b.maxY + r } }
  })
  const grownCache = new Map<number, Tile[]>()
  const tilesOf = (i: number): Tile[] => {
    let t = grownCache.get(i)
    if (!t) {
      const g = offset([items[i].poly], r)
      t = tile(g, polygonSetBBox(g))
      grownCache.set(i, t)
    }
    return t
  }
  const order = items.map((_, i) => i).sort((a, b) => items[a].bbox.minX - items[b].bbox.minX)
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi]
    const bi = items[i].bbox
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj]
      const bj = items[j].bbox
      if (bj.minX > bi.maxX) break
      if (!bboxOverlap(bi, bj)) continue
      const ti = tilesOf(i)
      const tj = tilesOf(j)
      const pieces: PolygonSet = []
      for (const a of ti) {
        const clip: PolygonSet = []
        for (const b of tj) if (bboxOverlap(a.bbox, b.bbox)) clip.push(...b.set)
        if (clip.length) pieces.push(...intersection(a.set, clip))
      }
      if (pieces.length === 0) continue
      const merged = ti.length > 1 || tj.length > 1 ? union(pieces) : pieces
      for (const p of merged) {
        if (polygonSetArea([p]) < 1e-6) continue
        const b = polygonSetBBox([p])
        report.count++
        report.locations.push({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 })
        const near = { minX: b.minX - r, minY: b.minY - r, maxX: b.maxX + r, maxY: b.maxY + r }
        const dist = distanceNear(items[i].poly, items[j].poly, near)
        report.widths.push(Number.isFinite(dist.d) ? dist.d : 0)
        report.ends.push({ a: dist.p, b: dist.q, i, j })
      }
    }
  }
  return report
}

/** Stable id of a problem place: kind + position rounded to 0.01 mm. */
export function problemId(kind: string, p: Vec2): string {
  return `${kind}:${p.x.toFixed(2)},${p.y.toFixed(2)}`
}

/** Gaps narrower than this are drawing slivers between touching copper, not gaps to isolate. */
const MIN_REAL_GAP = 0.02

/**
 * The narrowest distance between two different copper features, if any are closer than `limit`
 * mm (null when everything is at least `limit` apart). Places narrower than `ignoreBelow` are
 * skipped, like the isolation step does.
 */
export function narrowestGap(copper: PolygonSet, limit = 1, ignoreBelow = 0): number | null {
  const r = findNarrowGaps(copper, limit / 2)
  let best = Infinity
  // Slivers under MIN_REAL_GAP are copper that touches (a trace ending on a pad), not a real gap.
  const floor = Math.max(ignoreBelow, MIN_REAL_GAP)
  for (const w of r.widths) if (w >= floor && w < best) best = w
  return Number.isFinite(best) ? best : null
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = o(a, b, c)
  const d2 = o(a, b, d)
  const d3 = o(c, d, a)
  const d4 = o(c, d, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

function insideRing(p: Vec2, r: Path): boolean {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]
    const b = r[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Does segment a-b cross or lie inside polygon `poly`? */
function segmentHitsPolygon(a: Vec2, b: Vec2, poly: Polygon): boolean {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  if (insideRing(mid, poly.outer) && !poly.holes.some((h) => insideRing(mid, h))) return true
  for (const r of [poly.outer, ...poly.holes])
    for (let k = 0; k < r.length; k++) if (segmentsCross(a, b, r[k], r[(k + 1) % r.length])) return true
  return false
}

/** Gaps narrower than this cannot be milled by any PCB bit: copper meant to touch, or slivers. */
export const MILLABLE_GAP = 0.1
/** Gaps up to this wide are measured; wider ones only count as "at least this". */
export const CLEARANCE_LIMIT = 1.5

export type { ClearanceInfo }

/**
 * Measures the copper spacing of one copper layer, the way a DRC report reads: every place where
 * two different copper features come closer than {@link CLEARANCE_LIMIT} with nothing between
 * them is a measurement. Gaps under {@link MILLABLE_GAP} are copper meant to touch (counted as
 * `tiny`); the narrowest of the rest is what the isolation has to get through.
 */
export function analyzeClearance(copper: PolygonSet): ClearanceInfo {
  let perimeter = 0
  for (const poly of copper)
    for (const r of [poly.outer, ...poly.holes])
      for (let i = 0; i < r.length; i++) {
        const a = r[i]
        const b = r[(i + 1) % r.length]
        perimeter += Math.hypot(b.x - a.x, b.y - a.y)
      }
  const rep = findNarrowGaps(copper, CLEARANCE_LIMIT / 2)
  const boxes = copper.map((p) => polygonSetBBox([p]))
  // a gap is the empty space between two features: one measured across a third feature is not one
  const open = (k: number): boolean => {
    const { a, b, i, j } = rep.ends[k]
    const box = {
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y)
    }
    for (let n = 0; n < copper.length; n++) {
      if (n === i || n === j || !bboxOverlap(boxes[n], box)) continue
      if (segmentHitsPolygon(a, b, copper[n])) return false
    }
    return true
  }
  const widths = rep.widths
    .filter((w, k) => w >= MIN_REAL_GAP && w < CLEARANCE_LIMIT && open(k))
    .sort((a, b) => a - b)
  const tiny = widths.filter((w) => w < MILLABLE_GAP).length
  const millable = widths.filter((w) => w >= MILLABLE_GAP)
  const BAND = 0.03
  // drawn arcs make a 0.2 mm design gap measure 0.1995: report gaps on a 0.005 mm step
  const step = (v: number): number => Math.round(Math.round(v / 0.005) * 0.005 * 1000) / 1000
  if (!millable.length)
    return { clearance: null, atClearance: 0, typical: null, tiny, places: widths.length, perimeter }
  const c = millable[0]
  // the design rule: the narrowest width shared by at least 2 places and 3 % of all places
  const need = Math.max(2, Math.ceil(0.03 * millable.length))
  let typical: number | null = null
  for (let i = 0, j = 0; i < millable.length; i++) {
    while (j < millable.length && millable[j] <= millable[i] + BAND) j++
    if (j - i >= need) {
      typical = step(millable[i])
      break
    }
  }
  return {
    clearance: step(c),
    atClearance: millable.filter((w) => w <= c + BAND).length,
    typical,
    tiny,
    places: widths.length,
    perimeter
  }
}
