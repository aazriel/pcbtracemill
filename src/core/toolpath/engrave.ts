/**
 * Engraving (silkscreen / fab artwork): the tool follows the CENTRE-LINES of the drawn strokes
 * (text, component outlines) at a shallow depth. Filled shapes that have no stroke centre-line
 * (flashed pads, regions) are traced along their outline instead.
 *
 * Safety: engraving that crosses design copper on the same side would cut traces, so we warn
 * with the length that runs over copper.
 */
import type { Path, ToolpathSegment, Vec2 } from '../model/types'
import { applyAffine, clipLinesInside, pathLength, rings, union } from '../geometry'
import { fmt, selectedLayers, ToolpathError, type StepContext } from './context'
import { stockRectInWork } from './frame'
import { depthLevels } from './moves'
import { emitLoops, type LoopItem } from './isolate'
import { bboxInside, bboxOfPath, chainPolylines, simplifyPath } from './pathUtils'

export function generateEngrave(ctx: StepContext): ToolpathSegment[] {
  const { step, tool, layers, material } = ctx.input
  const sel = selectedLayers(ctx.input)
  if (sel.length === 0) throw new ToolpathError('No parsed source layer selected.')

  // Centre-lines of every draw, plus outlines of filled objects that are not draws.
  const lines: Path[] = []
  const filled: Path[] = []
  for (const l of sel) {
    for (const s of l.parsed!.strokes) if (s.path.length >= 2) lines.push(s.path)
    for (const o of l.parsed!.objects)
      if ((o.kind === 'flash' || o.kind === 'region') && o.polarity === 'dark') filled.push(...rings(o.shape))
  }
  if (lines.length === 0 && filled.length === 0) {
    ctx.warnings.push('Selected layers contain nothing to engrave.')
    return []
  }

  // Warn when the engraving runs over design copper on this side.
  const copper = union(
    ...layers
      .filter((l) => l.type === 'copper' && l.side === step.side && l.parsed)
      .map((l) => l.parsed!.geometry)
  )
  if (copper.length) {
    const over = clipLinesInside([...lines, ...filled.map((r) => r.concat([r[0]]))], copper)
    const len = over.reduce((a, p) => a + pathLength(p), 0)
    if (len > 0.5)
      ctx.warnings.push(
        `${fmt(len, 1)} mm of engraving runs over copper on the ${step.side} side and would cut those traces. ` +
          'Remove or move that artwork, or engrave only where there is no copper.'
      )
  }

  // Chain touching strokes into longer polylines (fewer lifts), then go to work coordinates.
  const chained = chainPolylines(lines, 0.01)
  const toW = (p: Path): Path => p.map((v) => applyAffine(ctx.m, v))
  const stock = stockRectInWork(material, ctx.input.boardBBox)
  const items: LoopItem[] = []
  let outside = 0
  const add = (p: Path, closed: boolean): void => {
    const w = simplifyPath(toW(p), undefined, closed)
    if (w.length < 2) return
    if (!bboxInside(bboxOfPath(w), stock)) {
      outside++
      return
    }
    items.push({ path: w, closed })
  }
  chained.closed.forEach((p) => add(p, true))
  chained.open.forEach((p) => add(p, false))
  filled.forEach((p) => add(p, true))
  if (outside) ctx.warnings.push(`${outside} engraving path(s) lie outside the material and are skipped.`)

  const depths = depthLevels(Math.max(0, step.cutDepth), tool.feeds.stepDown)
  const start: Vec2 = { x: 0, y: 0 }
  return emitLoops(items, depths, ctx, start).segments
}
