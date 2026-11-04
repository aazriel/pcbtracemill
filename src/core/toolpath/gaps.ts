/** Detection of places where separate copper features are too close for the tool to pass between. */
import type { BBox, PolygonSet, Vec2 } from '../model/types'
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
}

/**
 * Finds places where two DIFFERENT copper polygons are closer than 2·`radius`: each polygon is grown
 * by `radius` individually and pairwise overlaps of the grown shapes are the narrow places.
 * Narrow slots inside a single polygon (e.g. a U-shaped trace) are not reported.
 */
export function findNarrowGaps(copper: PolygonSet, radius: number): GapReport {
  const report: GapReport = { count: 0, locations: [] }
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
      }
    }
  }
  return report
}

export function formatLocations(locs: Vec2[], max = 5): string {
  const s = locs
    .slice(0, max)
    .map((p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`)
    .join(', ')
  return locs.length > max ? `${s}, …` : s
}
