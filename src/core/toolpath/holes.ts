/**
 * Drilling, helical hole milling and alignment-pin holes.
 *
 * Drill segments carry `drill` cycle info (for posts with G81/G83) AND the equivalent explicit moves.
 * Travel between holes happens at the retract plane (R = params.drill.retract above Z0, like G99);
 * the first segment starts with a rapid at safe Z and the last one ends with a retract to safe Z.
 *
 * Hole milling travels counter-clockwise (climb with an M3 spindle: the material outside the circle
 * is on the right of travel) using 'arc-ccw' moves split into half circles.
 */
import type { Move, ToolpathSegment, Vec2 } from '../model/types'
import { applyAffine } from '../geometry'
import { activeSkips, withoutSkippedHoles } from './skip'
import { effectiveCutWidth } from '../tools/geometry'
import { fmt, pointToWork, selectedDrills, selectedLayers, ToolpathError, type StepContext } from './context'
import { alignmentPinPositions, stockRectInWork, stockSideToWork } from './frame'
import { depthLevels, type CutContext } from './moves'
import { orderPoints } from './order'

const DIAM_EPS = 1e-4
/** Clearance above the previous peck depth when rapiding back into the hole, mm. */
const PECK_CLEARANCE = 0.2

export interface DrillOptions {
  depth: number
  retract: number
  peck: number
}

/** Explicit moves of one drill cycle starting at the retract plane above (x,y). */
export function drillMoves(x: number, y: number, o: DrillOptions, feedZ: number): Move[] {
  const R = o.retract
  const moves: Move[] = []
  const bottom = -Math.abs(o.depth)
  if (o.peck > 0 && o.peck < Math.abs(o.depth)) {
    let z = 0
    while (z > bottom + 1e-9) {
      const nz = Math.max(bottom, z - o.peck)
      if (z < 0) moves.push({ kind: 'rapid', x, y, z: Math.min(R, z + PECK_CLEARANCE) })
      moves.push({ kind: 'plunge', x, y, z: nz, feed: feedZ })
      if (nz > bottom + 1e-9) moves.push({ kind: 'retract', x, y, z: R })
      z = nz
    }
  } else moves.push({ kind: 'plunge', x, y, z: bottom, feed: feedZ })
  moves.push({ kind: 'retract', x, y, z: R })
  return moves
}

function finishSequence(segments: ToolpathSegment[], cut: CutContext): void {
  const last = segments[segments.length - 1]
  if (!last) return
  const lm = last.moves[last.moves.length - 1]
  last.moves.push({ kind: 'retract', x: lm.x, y: lm.y, z: cut.safeZ })
}

/** Drill a list of work-coordinate points in optimised order. */
export function drillPoints(
  pts: Vec2[],
  o: DrillOptions,
  cut: CutContext
): { segments: ToolpathSegment[]; order: number[] } {
  const order = orderPoints(pts, { x: 0, y: 0 })
  const R = Math.max(o.retract, 0.1)
  const segments: ToolpathSegment[] = order.map((i, k) => {
    const { x, y } = pts[i]
    const moves: Move[] =
      k === 0
        ? [
            { kind: 'rapid', x, y, z: cut.safeZ },
            { kind: 'rapid', x, y, z: R }
          ]
        : [{ kind: 'rapid', x, y, z: R }]
    moves.push(...drillMoves(x, y, { ...o, retract: R }, cut.feedZ))
    return {
      drill: { x, y, depth: Math.abs(o.depth), retract: R, peck: Math.max(0, o.peck), feed: cut.feedZ },
      moves
    }
  })
  finishSequence(segments, cut)
  return { segments, order }
}

function skippedHolesNote(n: number, what: string): string {
  return `${n} hole${n === 1 ? ' is' : 's are'} skipped as you chose and will not be ${what}.`
}

export function generateDrill(ctx: StepContext): ToolpathSegment[] {
  const { step, tool, material, machine } = ctx.input
  if (selectedLayers(ctx.input).length === 0) throw new ToolpathError('No parsed drill layer selected.')
  const p = step.params.drill
  const all = selectedDrills(ctx.input)
  const { holes, skipped } = withoutSkippedHoles(all.holes, activeSkips(step))
  const slots = all.slots
  if (skipped) ctx.warnings.push(skippedHolesNote(skipped, 'drilled'))
  const inRange = (d: number): boolean => d >= p.minDiameter - DIAM_EPS && d <= p.maxDiameter + DIAM_EPS
  const sel = holes.filter((h) => inRange(h.diameter))
  // Holes outside this step's range are expected (drilling is split by size across steps);
  // uncovered holes are reported project-wide by the pipeline instead.
  if (holes.length === 0 && slots.length === 0) ctx.warnings.push('Selected layers contain no drill holes.')
  else if (sel.length === 0 && slots.length === 0)
    ctx.warnings.push(
      `No holes fall within the ${fmt(p.minDiameter)}–${fmt(p.maxDiameter)} mm range of this step.`
    )
  const depth = Math.max(0, step.cutDepth)
  if (depth < material.thickness - 1e-6)
    ctx.warnings.push(
      `Drill depth ${fmt(depth)} mm does not go through the ${fmt(material.thickness)} mm stock.`
    )
  const tooBig = sel.filter((h) => tool.geometry.diameter > h.diameter + 0.05).length
  if (tooBig > 0)
    ctx.warnings.push(`${tooBig} hole(s) are smaller than the ${fmt(tool.geometry.diameter)} mm tool.`)

  const pts = sel.map((h) => pointToWork(ctx, h))
  const o: DrillOptions = { depth, retract: p.retract, peck: p.peck }
  const segments = drillPoints(pts, o, ctx.cut).segments

  if (p.includeSlots) {
    const ss = slots.filter((s) => inRange(s.diameter))
    let pos: Vec2 = pts.length ? segments[segments.length - 1].moves[0] : { x: 0, y: 0 }
    const remaining = ss.map((s) => ({ a: pointToWork(ctx, s.start), b: pointToWork(ctx, s.end) }))
    const levels = depthLevels(depth, tool.feeds.stepDown > 0 ? tool.feeds.stepDown : depth)
    while (remaining.length) {
      let bi = 0
      let bd = Infinity
      let rev = false
      remaining.forEach((s, i) => {
        const da = Math.hypot(s.a.x - pos.x, s.a.y - pos.y)
        const db = Math.hypot(s.b.x - pos.x, s.b.y - pos.y)
        if (da < bd) [bd, bi, rev] = [da, i, false]
        if (db < bd) [bd, bi, rev] = [db, i, true]
      })
      const s = remaining.splice(bi, 1)[0]
      const [a, b] = rev ? [s.b, s.a] : [s.a, s.b]
      const moves: Move[] = [
        { kind: 'rapid', x: a.x, y: a.y, z: ctx.cut.safeZ },
        { kind: 'rapid', x: a.x, y: a.y, z: ctx.cut.approachZ }
      ]
      levels.forEach((z, k) => {
        const from = k % 2 === 0 ? a : b
        const to = k % 2 === 0 ? b : a
        moves.push({ kind: 'plunge', x: from.x, y: from.y, z, feed: ctx.cut.feedZ })
        moves.push({ kind: 'feed', x: to.x, y: to.y, z, feed: Math.min(ctx.cut.feedXY, machine.maxFeedXY) })
      })
      const e = moves[moves.length - 1]
      moves.push({ kind: 'retract', x: e.x, y: e.y, z: ctx.cut.safeZ })
      segments.push({ moves })
      pos = e
    }
    if (ss.length < slots.length)
      ctx.warnings.push(`${slots.length - ss.length} slot(s) outside the diameter range are skipped.`)
  } else if (slots.length > 0)
    ctx.warnings.push(`${slots.length} slot(s) are ignored (enable "include slots").`)
  return segments
}

/**
 * One milled hole: circle of radius (holeD − toolD)/2 about (cx,cy).
 * helical: ramp down `stepDown` per revolution from Z0, then one full circle at final depth.
 * otherwise: plunge to each depth level at the circle start and cut a full circle there.
 * Ends with a move to the centre and a retract to safe Z.
 */
export function holeMillSegment(
  cx: number,
  cy: number,
  holeD: number,
  toolD: number,
  depth: number,
  stepDown: number,
  helical: boolean,
  cut: CutContext
): ToolpathSegment {
  const R = (holeD - toolD) / 2
  const sx = cx + R
  const moves: Move[] = [
    { kind: 'rapid', x: sx, y: cy, z: cut.safeZ },
    { kind: 'rapid', x: sx, y: cy, z: cut.approachZ }
  ]
  const levels = depthLevels(depth, stepDown)
  const circle = (z0: number, z1: number): void => {
    moves.push({ kind: 'arc-ccw', x: cx - R, y: cy, z: (z0 + z1) / 2, cx, cy, feed: cut.feedXY })
    moves.push({ kind: 'arc-ccw', x: sx, y: cy, z: z1, cx, cy, feed: cut.feedXY })
  }
  if (helical) {
    moves.push({ kind: 'plunge', x: sx, y: cy, z: 0, feed: cut.feedZ })
    let z = 0
    for (const l of levels) {
      circle(z, l)
      z = l
    }
    circle(z, z)
  } else {
    for (const l of levels) {
      moves.push({ kind: 'plunge', x: sx, y: cy, z: l, feed: cut.feedZ })
      circle(l, l)
    }
  }
  const zEnd = levels[levels.length - 1]
  moves.push({ kind: 'feed', x: cx, y: cy, z: zEnd, feed: cut.feedXY })
  moves.push({ kind: 'retract', x: cx, y: cy, z: cut.safeZ })
  return { moves }
}

export function generateHoleMill(ctx: StepContext): ToolpathSegment[] {
  const { step, tool, material } = ctx.input
  if (selectedLayers(ctx.input).length === 0) throw new ToolpathError('No parsed drill layer selected.')
  const p = step.params.holeMill
  const picked = withoutSkippedHoles(selectedDrills(ctx.input).holes, activeSkips(step))
  const holes = picked.holes
  if (picked.skipped) ctx.warnings.push(skippedHolesNote(picked.skipped, 'milled'))
  const toolD = effectiveCutWidth(tool, step.cutDepth)
  const inRange = holes.filter(
    (h) => h.diameter >= p.minDiameter - DIAM_EPS && h.diameter <= p.maxDiameter + DIAM_EPS
  )
  const millable = inRange.filter((h) => h.diameter > toolD + 1e-3)
  const tooSmall = inRange.length - millable.length
  if (holes.length === 0) ctx.warnings.push('Selected layers contain no holes.')
  if (tooSmall > 0)
    ctx.warnings.push(
      `${tooSmall} hole(s) are not larger than the ${fmt(toolD)} mm tool and are skipped — drill them instead.`
    )
  const depth = Math.max(0, step.cutDepth)
  if (depth < material.thickness - 1e-6)
    ctx.warnings.push(
      `Mill depth ${fmt(depth)} mm does not go through the ${fmt(material.thickness)} mm stock.`
    )
  const pts = millable.map((h) => pointToWork(ctx, h))
  const order = orderPoints(pts, { x: 0, y: 0 })
  return order.map((i) =>
    holeMillSegment(
      pts[i].x,
      pts[i].y,
      millable[i].diameter,
      toolD,
      depth,
      tool.feeds.stepDown,
      p.helical,
      ctx.cut
    )
  )
}

export function generateAlignment(ctx: StepContext): ToolpathSegment[] {
  const { step, tool, material, boardBBox } = ctx.input
  const a = material.alignment
  if (!a.enabled) ctx.warnings.push('Alignment pins are disabled in the material settings.')
  if (!(a.pinDiameter > 0)) throw new ToolpathError('Alignment pin diameter must be positive.')
  const m = stockSideToWork(material, step.side, boardBBox)
  const pins = alignmentPinPositions(material, boardBBox).map((q) => applyAffine(m, q))
  const stock = stockRectInWork(material, boardBBox)
  const outside = pins.filter(
    (q) =>
      q.x - a.pinDiameter / 2 < stock.minX ||
      q.x + a.pinDiameter / 2 > stock.maxX ||
      q.y - a.pinDiameter / 2 < stock.minY ||
      q.y + a.pinDiameter / 2 > stock.maxY
  ).length
  if (outside > 0)
    ctx.warnings.push(
      `${outside} alignment hole(s) fall outside the stock — enlarge the stock or reduce the margin.`
    )
  const depth = Math.max(0, step.cutDepth)
  if (depth <= material.thickness)
    ctx.warnings.push(
      'Alignment holes should go through the stock into the spoilboard (cut depth > thickness).'
    )
  const toolD = effectiveCutWidth(tool, depth)
  if (toolD >= a.pinDiameter - 0.01) {
    if (toolD > a.pinDiameter + 0.05)
      ctx.warnings.push(
        `The ${fmt(toolD)} mm tool is larger than the ${fmt(a.pinDiameter)} mm pins — holes will be loose.`
      )
    return drillPoints(
      pins,
      { depth, retract: step.params.drill.retract, peck: step.params.drill.peck },
      ctx.cut
    ).segments
  }
  const order = orderPoints(pins, { x: 0, y: 0 })
  return order.map((i) =>
    holeMillSegment(pins[i].x, pins[i].y, a.pinDiameter, toolD, depth, tool.feeds.stepDown, true, ctx.cut)
  )
}
