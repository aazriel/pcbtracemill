/**
 * Copper clearing (pocketing of all non-design copper).
 *
 * target  = board shape (outline, else bbox)  [∩ offset(copper, clearMargin) when clearMargin > 0]
 * region  = target − offset(copper, w/2 + isolation.extraClearance)   (allowed tool-centre area)
 * Rings: region, offset(region, −s), offset(region, −2s)… until empty, s = w·(1 − clear.overlap).
 * Copper islands smaller than clear.minIslandArea are dropped from `copper` first (they get cleared).
 *
 * Direction: region rings normalised (interior on the left) have the kept copper / walls on the
 * RIGHT, i.e. climb milling against the finished copper edges with an M3 spindle. Climb = normalised
 * orientation, conventional = reversed.
 */
import type { Path, PolygonSet, ToolpathSegment } from '../model/types'
import { applyAffine, difference, intersection, offset, polygonArea, rings, type Affine } from '../geometry'
import { effectiveCutWidth } from '../tools/geometry'
import { fmt, selectedGeometry, selectedLayers, toWork, ToolpathError, type StepContext } from './context'
import { problemId } from './gaps'
import { emitLoops, type LoopItem } from './isolate'
import { depthLevels } from './moves'
import { buildOutline, outlineLayers } from './outline'
import { simplifyPath } from './pathUtils'

const MAX_RINGS = 20000

function invertAffine(m: Affine): Affine {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

export function generateClear(ctx: StepContext): ToolpathSegment[] {
  const { step, tool, layers, boardBBox } = ctx.input
  if (selectedLayers(ctx.input).length === 0) throw new ToolpathError('No parsed source layer selected.')
  const p = step.params.clear
  const depth = Math.max(0, step.cutDepth)
  const w = effectiveCutWidth(tool, depth)
  const r = w / 2
  const extra = Math.max(0, step.params.isolation.extraClearance)
  const stepover = Math.max(w * (1 - Math.min(0.9, Math.max(0, p.overlap))), 0.01)

  // copper (board coordinates), small islands removed
  const copperAll = selectedGeometry(ctx.input, (l) => l.type !== 'outline')
  const minIsland = Math.max(0, p.minIslandArea)
  const copperBoard: PolygonSet = []
  let islands = 0
  for (const poly of copperAll) {
    if (minIsland > 0 && polygonArea(poly) < minIsland) islands++
    else copperBoard.push(poly)
  }
  if (islands > 0)
    ctx.warnings.push(`${islands} copper island(s) smaller than ${fmt(minIsland)} mm² will be cleared away.`)

  const { shape } = buildOutline(outlineLayers(layers, []), boardBBox)
  if (shape.length === 0) {
    ctx.warnings.push('No board outline or extents — nothing to clear.')
    return []
  }
  const board = toWork(ctx, shape)
  const copper = toWork(ctx, copperBoard)
  let target = board
  if (p.clearMargin > 0) target = intersection(board, offset(copper, p.clearMargin))
  const region = difference(target, offset(copper, r + extra))
  if (region.length === 0) {
    ctx.warnings.push('There is no copper area wide enough for this tool to clear.')
    return []
  }

  // concentric inward offsets
  const ringPaths: Path[] = []
  let cur: PolygonSet = region
  for (let k = 0; k < MAX_RINGS && cur.length > 0; k++) {
    for (const ring of rings(cur)) if (ring.length >= 3) ringPaths.push(ring)
    // offset from the original region each time: incremental offsets accumulate round-join vertices
    const next = offset(region, -(k + 1) * stepover)
    if (stepover > r * 1.001) {
      // cores farther than r from both this ring and the next one would stay uncut
      const core = difference(offset(region, -(k * stepover + r)), offset(next, r))
      for (const ring of rings(core)) if (ring.length >= 3) ringPaths.push(ring)
    }
    cur = next
  }

  // uncleared remnants (narrow places the tool cannot enter)
  const swept = offset(region, r)
  const remnants = difference(difference(target, offset(copper, extra + 1e-3)), swept).filter(
    (poly) => polygonArea(poly) >= Math.max(0.25 * w * w, 0.01)
  )
  if (remnants.length > 0) {
    const toBoard = invertAffine(ctx.m)
    const ignored = new Set(step.ignoredProblems ?? [])
    let area = 0
    for (const poly of remnants) {
      const xs = poly.outer.map((v) => v.x)
      const ys = poly.outer.map((v) => v.y)
      const centre = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2
      }
      const at = applyAffine(toBoard, centre)
      const id = problemId('uncleared', at)
      if (ignored.has(id)) continue
      const a = polygonArea(poly)
      area += a
      ctx.problems.push({ id, kind: 'uncleared', x: at.x, y: at.y, area: a })
    }
    const n = ctx.problems.length
    if (n > 0)
      ctx.warnings.push(
        `${n} area(s) narrower than the ${fmt(w)} mm tool remain uncleared (${fmt(area)} mm²). ` +
          `Use “Show on board” to see them.`
      )
  }

  const climb = p.direction === 'climb'
  const items: LoopItem[] = ringPaths.map((ring) => {
    const s = simplifyPath(ring, undefined, true)
    return { path: climb ? s : s.reverse(), closed: true }
  })
  return emitLoops(items, depthLevels(depth, tool.feeds.stepDown), ctx, { x: 0, y: 0 }).segments
}
