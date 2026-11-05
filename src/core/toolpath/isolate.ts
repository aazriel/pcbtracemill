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
import type { BBox, Path, ToolpathSegment, Vec2 } from '../model/types'
import { applyAffine, clipLinesOutside, offset, pointInPolygonSet, polygonSetBBox, rings } from '../geometry'
import { effectiveCutWidth } from '../tools/geometry'
import { fmt, selectedGeometry, selectedLayers, toWork, ToolpathError, type StepContext } from './context'
import { stockRectInWork } from './frame'
import { findNarrowGaps, problemId } from './gaps'
import { closedLoopSegment, depthLevels, openPathSegment } from './moves'
import { orderPaths } from './order'
import { bboxInside, bboxOfPath, clipPolylineToRect, simplifyPath } from './pathUtils'
import { activeSkips, skippedIslands } from './skip'

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
  const rb = polygonSetBBox(region)
  const out: LoopItem[] = []
  for (const it of items) {
    const b = bboxOfPath(it.path)
    if (b.maxX < rb.minX || b.minX > rb.maxX || b.maxY < rb.minY || b.minY > rb.maxY) {
      out.push(it)
      continue
    }
    const line = it.closed ? it.path.concat([it.path[0]]) : it.path
    const pieces = clipLinesOutside([line], region).filter((p) => p.length >= 2)
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

  const gaps = findNarrowGaps(copperBoard, w / 2 + extra)
  const ignoreBelow = Math.max(0, p.ignoreGapsBelow ?? 0)
  const ignored = new Set(step.ignoredProblems ?? [])
  gaps.locations.forEach((loc, i) => {
    const gap = gaps.widths[i]
    const id = problemId('gap', loc)
    if (ignored.has(id) || (ignoreBelow > 0 && gap < ignoreBelow)) return
    if (skipBand.length && pointInPolygonSet(loc, skipBand)) return
    ctx.problems.push({ id, kind: 'narrow-gap', x: loc.x, y: loc.y, gap, needed: w + 2 * extra })
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
  for (const d of offsets) {
    const ringsW = rings(offset(copper, d)).map((r) => {
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
  return segments
}
