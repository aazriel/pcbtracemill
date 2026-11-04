/**
 * Board cutout: offset the outline by the tool radius (outward when params.outside), cut every
 * ring at evenly spaced depth levels down to cutDepth. Inner cut-outs (holes in the outline) are cut
 * before the outer boundary so the board is still held while they are machined. Tabs are left only
 * on outer boundaries: on passes deeper than −(thickness − tabHeight) the tool rises to that height
 * over each tab. Direction follows the same rule as isolation (board on the left of normalised rings,
 * climb = reversed).
 */
import type { Path, ToolpathSegment, Vec2 } from '../model/types'
import { offset } from '../geometry'
import { effectiveCutWidth } from '../tools/geometry'
import { fmt, toWork, type StepContext } from './context'
import { closedLoopSegment, depthLevels, type LiftInterval } from './moves'
import { orderPaths } from './order'
import { buildOutline, outlineLayers } from './outline'
import { simplifyPath } from './pathUtils'

/** Maximum accumulated direction change (degrees) allowed under a tab. */
const TAB_MAX_TURN_DEG = 15

/**
 * Place `count` tab intervals of path-length `gap` on a closed ring, evenly spread by arc length
 * and nudged away from corners/curves (accumulated turning under the tab ≤ 15°).
 */
export function placeTabs(ring: Path, count: number, gap: number): LiftInterval[] {
  const n = ring.length
  if (count <= 0 || n < 3) return []
  const pos: number[] = [0]
  for (let i = 1; i <= n; i++) {
    const a = ring[i - 1]
    const b = ring[i % n]
    pos.push(pos[i - 1] + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const total = pos[n]
  if (total <= 0) return []
  // turning angle at each vertex
  const turn: number[] = []
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n]
    const b = ring[i]
    const c = ring[(i + 1) % n]
    const a1 = Math.atan2(b.y - a.y, b.x - a.x)
    const a2 = Math.atan2(c.y - b.y, c.x - b.x)
    let d = Math.abs(a2 - a1)
    if (d > Math.PI) d = 2 * Math.PI - d
    turn.push((d * 180) / Math.PI)
  }
  const turningIn = (s0: number, s1: number): number => {
    let t = 0
    for (let i = 0; i < n; i++) {
      for (const shift of [-total, 0, total]) {
        const p = pos[i] + shift
        if (p > s0 && p < s1) t += turn[i]
      }
    }
    return t
  }
  const out: LiftInterval[] = []
  const spacing = total / count
  const half = gap / 2
  const tries = 200
  for (let k = 0; k < count; k++) {
    const target = spacing * (k + 0.5)
    let chosen = target
    let best = Infinity
    for (let t = 0; t <= tries; t++) {
      const delta = (Math.ceil(t / 2) * (t % 2 ? 1 : -1) * spacing) / (tries + 2)
      const s = target + delta
      const turning = turningIn(s - half, s + half)
      if (turning <= TAB_MAX_TURN_DEG) {
        chosen = s
        best = 0
        break
      }
      if (turning < best) {
        best = turning
        chosen = s
      }
    }
    out.push({ start: chosen - half, end: chosen + half })
  }
  return out
}

export function generateCutout(ctx: StepContext): ToolpathSegment[] {
  const { step, tool, material, layers, boardBBox } = ctx.input
  const p = step.params.cutout
  const { shape, source } = buildOutline(outlineLayers(layers, step.layerIds), boardBBox)
  if (shape.length === 0) {
    ctx.warnings.push('No board outline and no board extents — nothing to cut out.')
    return []
  }
  if (source === 'bbox')
    ctx.warnings.push('No closed board outline found — cutting around the board bounding box.')
  if (source === 'geometry')
    ctx.warnings.push(
      'Outline built from drawn geometry (no closed centre-line) — the cut may be offset by half the line width.'
    )

  const depth = Math.max(0, step.cutDepth)
  const d = effectiveCutWidth(tool, depth)
  const r = d / 2
  const outline = toWork(ctx, shape)
  const paths = offset(outline, p.outside ? r : -r)
  if (paths.length === 0) {
    ctx.warnings.push('The board is too small for this tool when cutting inside the outline.')
    return []
  }
  if (depth < material.thickness - 1e-6)
    ctx.warnings.push(
      `Cut depth ${fmt(depth)} mm is less than the stock thickness ${fmt(material.thickness)} mm.`
    )

  const prep = (ring: Path, isClimb: boolean): Path => {
    const s = simplifyPath(ring, undefined, true)
    return isClimb ? s.reverse() : s
  }
  // Cutout has no direction parameter: always climb (best edge finish with a CW spindle).
  const inner = paths.flatMap((poly) => poly.holes.map((h) => ({ path: prep(h, true), closed: true })))
  const outer = paths.map((poly) => ({ path: prep(poly.outer, true), closed: true }))

  const depths = depthLevels(depth, tool.feeds.stepDown)
  const tabTop = -(material.thickness - Math.max(0, p.tabHeight))
  const useTabs = p.tabs > 0 && p.tabHeight > 0 && depths.some((z) => z < tabTop - 1e-9)
  if (p.tabs > 0 && !useTabs) ctx.warnings.push('Tabs are not needed: no pass reaches below the tab height.')

  const segments: ToolpathSegment[] = []
  let pos: Vec2 = { x: 0, y: 0 }
  const o1 = orderPaths(inner, pos)
  for (const it of o1.items) segments.push(closedLoopSegment(it.path, depths, ctx.cut))
  pos = o1.end
  const o2 = orderPaths(outer, pos)
  for (const it of o2.items) {
    let lifts: LiftInterval[] = []
    if (useTabs) {
      const gap = Math.max(0, p.tabWidth) + d
      let count = Math.round(p.tabs)
      const perim = it.path.reduce(
        (acc, v, i, arr) =>
          acc + Math.hypot(arr[(i + 1) % arr.length].x - v.x, arr[(i + 1) % arr.length].y - v.y),
        0
      )
      while (count > 0 && count * gap > perim * 0.5) count--
      if (count < p.tabs) ctx.warnings.push(`Only ${count} tab(s) fit on a ${fmt(perim, 1)} mm perimeter.`)
      lifts = placeTabs(it.path, count, gap)
    }
    segments.push(closedLoopSegment(it.path, depths, ctx.cut, lifts, tabTop))
  }
  return segments
}
