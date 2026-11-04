/** Detection of places where separate copper features are too close for the tool to pass between. */
import type { BBox, Path, Polygon, PolygonSet, Vec2 } from '../model/types'
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

/** Distance between two segments (they never cross: the polygons are separate features). */
function segSegDist(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  return Math.sqrt(Math.min(segDist2(a, b, c), segDist2(a, b, d), segDist2(c, d, a), segDist2(c, d, b)))
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

/** Smallest distance between two polygons, looking only at edges inside `box`. */
function distanceNear(pa: Polygon, pb: Polygon, box: BBox): number {
  const ea = edgesNear(pa, box)
  const eb = edgesNear(pb, box)
  let best = Infinity
  for (const [a, b] of ea) for (const [c, d] of eb) best = Math.min(best, segSegDist(a, b, c, d))
  return best
}

/**
 * Finds places where two DIFFERENT copper polygons are closer than 2·`radius`: each polygon is grown
 * by `radius` individually and pairwise overlaps of the grown shapes are the narrow places.
 * Narrow slots inside a single polygon (e.g. a U-shaped trace) are not reported.
 */
export function findNarrowGaps(copper: PolygonSet, radius: number): GapReport {
  const report: GapReport = { count: 0, locations: [], widths: [] }
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
        report.widths.push(Number.isFinite(dist) ? dist : 0)
      }
    }
  }
  return report
}

/** Stable id of a problem place: kind + position rounded to 0.01 mm. */
export function problemId(kind: string, p: Vec2): string {
  return `${kind}:${p.x.toFixed(2)},${p.y.toFixed(2)}`
}
