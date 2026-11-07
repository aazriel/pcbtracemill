/**
 * Isolation routing.
 *
 * Pass i follows the boundary of offset(copper, w/2 + extraClearance + i·w·(1 − overlap)), where
 * w = effectiveCutWidth(tool, cutDepth).
 *
 * Direction (spindle clockwise seen from above, M3): climb milling keeps the material on the RIGHT
 * of the direction of travel (equivalent to G41 + M3). Clipper-normalised rings (outer CCW, holes CW)
 * of offset(copper) always have the copper on their LEFT, so climb = reversed normalised rings
 * (the tool travels clockwise around each copper island), conventional = normalised rings.
 * Geometry is transformed to work coordinates (with transformPolygonSet re-normalising orientation)
 * BEFORE the direction is chosen, so bottom-side mirroring cannot flip climb into conventional.
 */
import type { BBox, Path, PolygonSet, ToolpathSegment, Vec2 } from '../model/types'
import {
  applyAffine,
  clipLinesOutside,
  countPoints,
  offset,
  pathArea,
  pointInPolygonSet,
  union,
  polygonSetBBox,
  rings
} from '../geometry'
import { effectiveCutWidth } from '../tools/geometry'
import { fmt, selectedGeometry, selectedLayers, toWork, ToolpathError, type StepContext } from './context'
import { stockRectInWork } from './frame'
import { findNarrowGaps, problemId, tileRegion } from './gaps'
import { gapMiddles } from './centerline'
import { closedLoopSegment, depthLevels, openPathSegment } from './moves'
import { orderPaths } from './order'
import { bboxInside, bboxOfPath, clipPolylineToRect, simplifyPath } from './pathUtils'
import { activeSkips, skippedIslands } from './skip'

/** Default widest gap that gets the single middle groove with smart clearance (mm). */
const SMART_MAX_GAP = 1 // = cam SMART_MAX_GAP (toolpath does not import cam)

export interface LoopItem {
  path: Path
  closed: boolean
}

/** Board bbox corners transformed to work coordinates. */
export function workBBox(ctx: StepContext, b: BBox): BBox {
  const pts = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY }
  ].map((p) => applyAffine(ctx.m, p))
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y))
  }
}

/** Ring list → loop items clipped to `clip` (open pieces where a ring leaves the rectangle). */
export function clipRings(ringsIn: Path[], clip: BBox): LoopItem[] {
  const out: LoopItem[] = []
  for (const ring of ringsIn) {
    if (ring.length < 3) continue
    if (bboxInside(bboxOfPath(ring), clip)) {
      out.push({ path: ring, closed: true })
      continue
    }
    const pieces = clipPolylineToRect(ring.concat([ring[0]]), clip)
    if (pieces.length > 1) {
      const first = pieces[0]
      const last = pieces[pieces.length - 1]
      const s = ring[0]
      if (
        first[0].x === s.x &&
        first[0].y === s.y &&
        last[last.length - 1].x === s.x &&
        last[last.length - 1].y === s.y
      ) {
        pieces[0] = last.concat(first.slice(1))
        pieces.pop()
      }
    }
    for (const p of pieces) out.push({ path: p, closed: false })
  }
  return out
}

export function isolationOffsets(width: number, passes: number, overlap: number, extra: number): number[] {
  const n = Math.max(1, Math.round(passes))
  const ov = Math.min(0.9, Math.max(0, overlap))
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(width / 2 + extra + i * width * (1 - ov))
  return out
}

/** Emit segments for ordered loop items, starting from `pos`. */
export function emitLoops(
  items: LoopItem[],
  depths: number[],
  ctx: StepContext,
  pos: Vec2
): { segments: ToolpathSegment[]; end: Vec2 } {
  const ordered = orderPaths(items, pos)
  const segments = ordered.items.map((it) =>
    it.closed ? closedLoopSegment(it.path, depths, ctx.cut) : openPathSegment(it.path, depths, ctx.cut)
  )
  return { segments, end: ordered.end }
}

/** Removes the parts of the loops that lie inside `region` (closed loops become open pieces). */
export function withoutRegion(items: LoopItem[], region: ReturnType<typeof offset>): LoopItem[] {
  if (!region.length) return items
  // a big region (smart clearance zone) is cut into tiles: each loop is clipped only by its neighbours
  const tiles =
    countPoints(region) > 2000 ? tileRegion(region) : [{ bbox: polygonSetBBox(region), set: region }]
  const out: LoopItem[] = []
  for (const it of items) {
    const b = bboxOfPath(it.path)
    const near: PolygonSet = []
    for (const t of tiles)
      if (!(b.maxX < t.bbox.minX || b.minX > t.bbox.maxX || b.maxY < t.bbox.minY || b.minY > t.bbox.maxY))
        near.push(...t.set)
    if (!near.length) {
      out.push(it)
      continue
    }
    const line = it.closed ? it.path.concat([it.path[0]]) : it.path
    const pieces = clipLinesOutside([line], near).filter((p) => p.length >= 2)
    if (pieces.length === 1 && it.closed && pieces[0].length >= line.length) {
      out.push(it)
      continue
    }
    for (const p of pieces) out.push({ path: p, closed: false })
  }
  return out
}

export function generateIsolation(ctx: StepContext): ToolpathSegment[] {
  const { step, tool, material, boardBBox } = ctx.input
  if (selectedLayers(ctx.input).length === 0) throw new ToolpathError('No parsed source layer selected.')
  const copperBoard = selectedGeometry(ctx.input)
  if (copperBoard.length === 0) {
    ctx.warnings.push('Selected layers contain no copper.')
    return []
  }
  const p = step.params.isolation
  const depth = Math.max(0, step.cutDepth)
  const w = effectiveCutWidth(tool, depth)
  const extra = Math.max(0, p.extraClearance)
  const offsets = isolationOffsets(w, p.passes, p.overlap, extra)

  // Advanced "skip parts": copper areas the user chose not to isolate
  const skip = skippedIslands(copperBoard, activeSkips(step))
  const skipBand = skip.islands.length ? offset(skip.islands, offsets[offsets.length - 1] + w) : []
  if (skip.islands.length)
    ctx.warnings.push(
      `${skip.islands.length} copper area${skip.islands.length === 1 ? ' is' : 's are'} skipped as you chose: ` +
        `${skip.islands.length === 1 ? 'it is' : 'they are'} not isolated and stay connected to the copper around ${skip.islands.length === 1 ? 'it' : 'them'}.`
    )
  if (skip.missed)
    ctx.warnings.push(
      `${skip.missed} skipped part${skip.missed === 1 ? ' is' : 's are'} no longer on the copper of this step (the board changed?).`
    )

  const smart = !!p.smart
  const smartGap = p.smartMaxGap && p.smartMaxGap > 0 ? p.smartMaxGap : SMART_MAX_GAP
  // with smart clearance a gap only needs room for the groove itself (it is cut in the middle)
  const gaps = findNarrowGaps(copperBoard, smart ? w / 2 : w / 2 + extra)
  const ignoreBelow = Math.max(0, p.ignoreGapsBelow ?? 0)
  const ignored = new Set(step.ignoredProblems ?? [])
  gaps.locations.forEach((loc, i) => {
    const gap = gaps.widths[i]
    const id = problemId('gap', loc)
    if (ignored.has(id) || (ignoreBelow > 0 && gap < ignoreBelow)) return
    if (skipBand.length && pointInPolygonSet(loc, skipBand)) return
    ctx.problems.push({ id, kind: 'narrow-gap', x: loc.x, y: loc.y, gap, needed: smart ? w : w + 2 * extra })
  })
  const shown = ctx.problems.length
  if (shown > 0) {
    const what = extra > 0 ? `${fmt(w)} mm tool (+${fmt(extra)} mm clearance)` : `${fmt(w)} mm tool`
    ctx.warnings.push(
      `${shown} place${shown === 1 ? '' : 's'} where copper is closer than the ${what} can fit — ` +
        `${shown === 1 ? 'it' : 'they'} will not be isolated. Use “Show on board” to see ${shown === 1 ? 'it' : 'them'}.`
    )
  }

  const copper = toWork(ctx, copperBoard)
  const stock = stockRectInWork(material, boardBBox)
  const bb = workBBox(ctx, boardBBox)
  const grow = offsets[offsets.length - 1] + w
  const clip: BBox = {
    minX: Math.max(stock.minX, bb.minX - grow),
    minY: Math.max(stock.minY, bb.minY - grow),
    maxX: Math.min(stock.maxX, bb.maxX + grow),
    maxY: Math.min(stock.maxY, bb.maxY + grow)
  }
  if (!(clip.minX < clip.maxX && clip.minY < clip.maxY)) {
    ctx.warnings.push('The board does not lie inside the stock — nothing to cut.')
    return []
  }

  const depths = depthLevels(depth, tool.feeds.stepDown)
  const climb = p.direction === 'climb'
  let pos: Vec2 = { x: 0, y: 0 }
  const segments: ToolpathSegment[] = []
  let clipped = 0
  const skipWork = skip.islands.length ? toWork(ctx, skip.islands) : []
  // Smart clearance: narrow gaps get one groove along their middle instead of the passes
  const gapsMid = smart ? gapMiddles(copper, { maxGap: smartGap }) : { lines: [], zone: [] }
  const zone = gapsMid.zone
  const middle = smart ? joinOpenPaths(smartCenterlines(gapsMid.lines, copper, w, clip, skipWork)) : []
  const middleEnds = middle.flatMap((m) => [m[0], m[m.length - 1]])
  // pockets are filled only where they touch the narrow zone (see fillPockets)
  const nearZone = zoneProximity(zone, 0.02)
  for (const d of offsets) {
    // smart: the outline of (copper grown by d ∪ narrow zone) - the usual pass in open areas,
    // crossing the gap where a narrow gap ends (the middle groove ends on that crossing)
    const grown = offset(copper, d)
    const passSet = zone.length ? fillPockets(union(grown, zone), smartGap, middleEnds, w, nearZone) : grown
    const passRings = rings(passSet)
    // smart: the extra clearance only where it fits - a slot inside the copper (thermal relief)
    // or a hole it would close is cut at the plain distance instead
    if (smart && extra > 0 && d === offsets[0])
      passRings.push(...closedByExtra(copper, d - extra, passSet, nearZone))
    const ringsW = passRings.map((r) => {
      const s = simplifyPath(r, undefined, true)
      return climb ? s.reverse() : s
    })
    let items = clipRings(ringsW, clip)
    // the parts of this pass that run around a skipped copper area are left out
    if (skipWork.length) items = withoutRegion(items, offset(skipWork, d + 0.02))
    clipped += items.filter((i) => !i.closed).length
    const res = emitLoops(items, depths, ctx, pos)
    segments.push(...res.segments)
    pos = res.end
  }
  if (clipped > 0) ctx.warnings.push(`${clipped} isolation path piece(s) were clipped at the stock edge.`)
  if (smart) {
    const items: LoopItem[] = middle.map((path) => ({ path, closed: false }))
    if (items.length) segments.push(...emitLoops(items, depths, ctx, pos).segments)
  }
  return segments
}

/**
 * Smart clearance: holes in (grown copper + narrow zone) that touch the zone and are smaller than half the gap limit squared
 * are pockets inside narrow gaps the zone did not cover, not open areas (an open area wider than
 * the limit is at least about 0.8 x limit^2). A pocket a middle groove passes through is filled, so
 * it is not cut as a loop of its own; one where middle grooves END (where three features meet)
 * is kept - its outline is what joins those grooves.
 */
function fillPockets(
  set: PolygonSet,
  maxGap: number,
  ends: Vec2[],
  w: number,
  nearZone: (p: Vec2) => boolean
): PolygonSet {
  const min = 0.5 * maxGap * maxGap
  const keep = (h: Path): boolean => {
    if (Math.abs(pathArea(h)) >= min) return true
    const b = bboxOfPath(h)
    // a hole that does not touch the narrow zone is a slot inside one feature (a thermal relief)
    // or an open area - it is milled as usual
    if (!h.some(nearZone)) return true
    const near = ends.filter(
      (e) => e.x >= b.minX - w && e.x <= b.maxX + w && e.y >= b.minY - w && e.y <= b.maxY + w
    )
    if (!near.length) return false
    // an end inside the pocket or within w of its outline
    const ring = { outer: h, holes: [] }
    return near.some((e) => pointInPolygonSet(e, [ring]) || distToRing(e, h) <= w)
  }
  return set.map((poly) => ({ outer: poly.outer, holes: poly.holes.filter(keep) }))
}

/**
 * Holes of the copper grown by `tight` that the pass set (grown by tight + extra clearance) no
 * longer has - thermal-relief slots and small openings the extra clearance closes. Holes that touch
 * the narrow zone are gaps between different features and are handled by the middle groove.
 */
function closedByExtra(
  copper: PolygonSet,
  tight: number,
  passSet: PolygonSet,
  nearZone: (p: Vec2) => boolean
): Path[] {
  const looseHoles = passSet.flatMap((p) => p.holes).map((h) => ({ b: bboxOfPath(h), v: h[0] }))
  const out: Path[] = []
  for (const poly of offset(copper, tight))
    for (const h of poly.holes) {
      const b = bboxOfPath(h)
      const asPoly = [{ outer: [...h].reverse(), holes: [] }]
      const kept = looseHoles.some(
        (l) =>
          l.b.minX >= b.minX &&
          l.b.maxX <= b.maxX &&
          l.b.minY >= b.minY &&
          l.b.maxY <= b.maxY &&
          pointInPolygonSet(l.v, asPoly)
      )
      if (kept) continue
      if (h.some(nearZone)) continue
      out.push(h)
    }
  return out
}

/** A test "is this point within `tol` of the zone's outline", backed by an edge grid. */
function zoneProximity(zone: PolygonSet, tol: number): (p: Vec2) => boolean {
  if (!zone.length) return () => false
  const cell = 0.5
  const grid = new Map<string, [Vec2, Vec2][]>()
  for (const r of rings(zone))
    for (let i = 0; i < r.length; i++) {
      const a = r[i]
      const b = r[(i + 1) % r.length]
      for (
        let gx = Math.floor((Math.min(a.x, b.x) - tol) / cell);
        gx <= Math.floor((Math.max(a.x, b.x) + tol) / cell);
        gx++
      )
        for (
          let gy = Math.floor((Math.min(a.y, b.y) - tol) / cell);
          gy <= Math.floor((Math.max(a.y, b.y) + tol) / cell);
          gy++
        ) {
          const k = `${gx},${gy}`
          const l = grid.get(k)
          if (l) l.push([a, b])
          else grid.set(k, [[a, b]])
        }
    }
  return (p) => {
    for (const [a, b] of grid.get(`${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`) ?? [])
      if (distToRing(p, [a, b]) <= tol) return true
    // (hole corners never lie strictly inside the zone: the holes are outside it)
    return false
  }
}

function distToRing(p: Vec2, r: Path): number {
  let best = Infinity
  for (let i = 0; i < r.length; i++) {
    const a = r[i]
    const b = r[(i + 1) % r.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l = dx * dx + dy * dy
    const t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0
    best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y))
  }
  return best
}

const ptKey = (p: Vec2): string => `${p.x.toFixed(4)},${p.y.toFixed(4)}`

/**
 * Smart clearance: the middle of every gap up to `maxGap` wide, inside the area being isolated,
 * not where the groove would cut into copper (gaps narrower than the groove are reported instead).
 */
function smartCenterlines(
  middles: Path[],
  copper: PolygonSet,
  w: number,
  clip: BBox,
  skip: PolygonSet
): Path[] {
  let lines = middles.map((l) => simplifyPath(l, 0.002))
  lines = clipLinesOutside(lines, offset(copper, (w / 2) * 0.999))
  if (skip.length) lines = clipLinesOutside(lines, offset(skip, w))
  const out: Path[] = []
  for (const l of lines)
    for (const piece of clipPolylineToRect(l, clip)) if (piece.length >= 2) out.push(simplifyPath(piece))
  return out
}

/** Joins open paths that meet end to end into longer ones (fewer plunges). */
export function joinOpenPaths(paths: Path[]): Path[] {
  const ends = new Map<string, number[]>()
  const add = (k: string, i: number): void => {
    const l = ends.get(k)
    if (l) l.push(i)
    else ends.set(k, [i])
  }
  paths.forEach((p, i) => {
    add(ptKey(p[0]), i)
    add(ptKey(p[p.length - 1]), i)
  })
  const used = new Uint8Array(paths.length)
  const out: Path[] = []
  const extend = (path: Path): Path => {
    for (;;) {
      const k = ptKey(path[path.length - 1])
      const next = (ends.get(k) ?? []).find((j) => !used[j])
      if (next === undefined) return path
      used[next] = 1
      const q = paths[next]
      path = ptKey(q[0]) === k ? path.concat(q.slice(1)) : path.concat(q.slice(0, -1).reverse())
    }
  }
  for (let i = 0; i < paths.length; i++) {
    if (used[i]) continue
    used[i] = 1
    let path = extend(paths[i].slice())
    path = extend(path.reverse())
    out.push(path)
  }
  return out
}
