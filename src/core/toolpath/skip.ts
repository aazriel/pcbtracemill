/**
 * Parts of the board the user chose not to machine in a step (advanced "Skip parts"): copper
 * areas that are not isolated, and holes that are not drilled / milled. See DECISIONS D-023.
 */
import type { DrillHole, PolygonSet, SkipRef, CamStep } from '../model/types'
import { pointInPolygonSet } from '../geometry'

/** Matching tolerance for a skipped hole's centre (mm). */
const HOLE_EPS = 0.02

/** The step's active skip list (empty when skipping is off). */
export function activeSkips(step: CamStep): SkipRef[] {
  return step.skip?.enabled ? step.skip.items : []
}

/** Copper islands (polygons of `copper`) that contain a skipped copper point, plus the points that hit nothing. */
export function skippedIslands(
  copper: PolygonSet,
  skips: SkipRef[]
): { islands: PolygonSet; missed: number } {
  const picked = new Set<number>()
  let missed = 0
  for (const s of skips) {
    if (s.kind !== 'copper') continue
    const i = copper.findIndex((poly) => pointInPolygonSet({ x: s.x, y: s.y }, [poly]))
    if (i < 0) missed++
    else picked.add(i)
  }
  return { islands: [...picked].map((i) => copper[i]), missed }
}

export function holeMatches(s: SkipRef, h: { x: number; y: number; diameter: number }): boolean {
  return (
    s.kind === 'hole' &&
    Math.abs(s.x - h.x) <= HOLE_EPS &&
    Math.abs(s.y - h.y) <= HOLE_EPS &&
    (s.d === undefined || Math.abs(s.d - h.diameter) <= HOLE_EPS)
  )
}

/** Removes skipped holes; returns the kept holes and how many were skipped. */
export function withoutSkippedHoles(
  holes: DrillHole[],
  skips: SkipRef[]
): { holes: DrillHole[]; skipped: number } {
  const hs = skips.filter((s) => s.kind === 'hole')
  if (!hs.length) return { holes, skipped: 0 }
  const kept = holes.filter((h) => !hs.some((s) => holeMatches(s, h)))
  return { holes: kept, skipped: holes.length - kept.length }
}
