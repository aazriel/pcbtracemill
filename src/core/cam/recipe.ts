/**
 * Automatic job plan ("recipe") for a typical hobby PCB.
 *
 * Ordering logic (the operator flips the board at most once):
 *   1. Alignment pins (double-sided only) — drilled first, while the stock is still in its original
 *      position, so the pin holes in the spoilboard define where the board goes after flipping.
 *   2. First side (top, or bottom for a bottom-only board): isolation, then drilling (grouped by drill
 *      size, smallest first), then milling of holes too big for any drill. Drilling after isolation keeps
 *      the V-bit from catching on drill burrs; drilling before the flip means burrs end up on the second
 *      side where its isolation pass cleans them.
 *   3. Second side (double-sided only, after the flip): isolation.
 *   4. Cutout, always last, on whichever side is facing up at the end — cutting the board free earlier would
 *      leave it loose for the remaining operations.
 */
import type { CamStep, ClearanceInfo, ImportedLayer, MachineProfile, Material, Tool } from '../model/types'
import { combinedClearance, planIsolation } from './isolationPlan'
import { createStep } from './steps'

export interface RecipeContext {
  layers: ImportedLayer[]
  tools: Tool[]
  material: Material
  machine: MachineProfile
  newId: () => string
  /** Measured copper spacing per copper layer id (D-031): sets the isolation passes and depth. */
  clearance?: Record<string, ClearanceInfo | null>
}

/** A hole may be drilled with a bit up to this much smaller than the hole (mm). */
const DRILL_UNDERSIZE_TOLERANCE = 0.05
/** Upper bound used for "and everything above" hole ranges. */
const MAX_HOLE = 100

const byDiameter = (a: Tool, b: Tool): number => a.geometry.diameter - b.geometry.diameter
/** The user's own tools come before the starter kit: they made them for their own bits. */
const ownFirst = (a: Tool, b: Tool): number => Number(a.builtIn) - Number(b.builtIn)
/** Diameters this close count as the same bit size (own tool preferred), mm. */
const SAME_SIZE = 0.05
const r3 = (v: number): number => Math.round(v * 1000) / 1000

/**
 * Preferred isolation tool: a V-bit (the user's own first), 30°/0.1 first, then the finest tip; then
 * the smallest flat, then the smallest ball (own first at the same size).
 */
export function pickIsolationTool(tools: Tool[]): Tool | null {
  const exact = (t: Tool): number =>
    t.geometry.tipAngle === 30 && Math.abs((t.geometry.tipDiameter ?? 0) - 0.1) < 1e-6 ? 0 : 1
  const vbits = tools
    .filter((t) => t.type === 'vbit')
    .sort(
      (a, b) =>
        ownFirst(a, b) ||
        exact(a) - exact(b) ||
        (a.geometry.tipDiameter ?? 0) - (b.geometry.tipDiameter ?? 0) ||
        Math.abs((a.geometry.tipAngle ?? 60) - 30) - Math.abs((b.geometry.tipAngle ?? 60) - 30)
    )
  if (vbits.length) return vbits[0]
  for (const type of ['flat', 'ball'] as const) {
    const pool = tools.filter((t) => t.type === type).sort(byDiameter)
    if (pool.length) return sameSizeOwn(pool, pool[0])
  }
  return null
}

/** `best`, or the user's own tool of the same type and (nearly) the same diameter. */
function sameSizeOwn(pool: Tool[], best: Tool): Tool {
  if (!best.builtIn) return best
  return (
    pool.find(
      (t) =>
        !t.builtIn &&
        t.type === best.type &&
        Math.abs(t.geometry.diameter - best.geometry.diameter) <= SAME_SIZE + 1e-9
    ) ?? best
  )
}

/** Cutout tool: corn bit 1.0–2.0 mm (closest to 1.5), else flat in that range, else any corn/flat. */
export function pickCutoutTool(tools: Tool[]): Tool | null {
  const score = (t: Tool): number => Math.abs(t.geometry.diameter - 1.5)
  const inRange = (t: Tool): boolean => t.geometry.diameter >= 1.0 && t.geometry.diameter <= 2.0
  for (const pool of [
    tools.filter((t) => t.type === 'corn' && inRange(t)),
    tools.filter((t) => t.type === 'flat' && inRange(t)),
    tools.filter((t) => t.type === 'corn' || t.type === 'flat')
  ]) {
    if (pool.length) return [...pool].sort((a, b) => ownFirst(a, b) || score(a) - score(b))[0]
  }
  return null
}

/** Alignment tool: drill matching the pin (±0.1 mm), else the largest flat/corn smaller than the pin. */
export function pickAlignmentTool(tools: Tool[], pinDiameter: number): Tool | null {
  const drill = tools
    .filter((t) => t.type === 'drill' && Math.abs(t.geometry.diameter - pinDiameter) <= 0.1)
    .sort(
      (a, b) =>
        ownFirst(a, b) ||
        Math.abs(a.geometry.diameter - pinDiameter) - Math.abs(b.geometry.diameter - pinDiameter)
    )[0]
  if (drill) return drill
  const mills = tools
    .filter((t) => t.type === 'flat' && t.geometry.diameter < pinDiameter * 0.8)
    .sort(byDiameter)
  const big = mills[mills.length - 1]
  return big ? sameSizeOwn(mills, big) : null
}

/** Hole-milling tool: largest flat (then corn) no bigger than 75% of the smallest hole to mill. */
export function pickHoleMillTool(tools: Tool[], smallestHole: number): Tool | null {
  for (const type of ['flat', 'corn'] as const) {
    const fits = tools
      .filter((t) => t.type === type && t.geometry.diameter <= smallestHole * 0.75)
      .sort(byDiameter)
    if (fits.length) return sameSizeOwn(fits, fits[fits.length - 1])
  }
  return null
}

interface DrillGroup {
  tool: Tool
  min: number
  max: number
}

/**
 * Groups hole diameters by drill bit: each hole goes to the smallest drill ≥ (hole − 0.05 mm), so holes are
 * never noticeably undersized. Holes bigger than every drill are returned in `toMill`.
 */
export function groupHolesByDrill(
  diameters: number[],
  tools: Tool[]
): { groups: DrillGroup[]; toMill: number[] } {
  const drills = tools.filter((t) => t.type === 'drill').sort(byDiameter)
  const groups = new Map<string, DrillGroup>()
  const toMill: number[] = []
  for (const d of [...new Set(diameters.map(r3))].sort((a, b) => a - b)) {
    const smallest = drills.find((t) => t.geometry.diameter >= d - DRILL_UNDERSIZE_TOLERANCE)
    // the user's own drill of that size, if they have one
    const drill = smallest && sameSizeOwn(drills, smallest)
    if (!drill) {
      toMill.push(d)
      continue
    }
    const g = groups.get(drill.id)
    if (g) {
      g.min = Math.min(g.min, d)
      g.max = Math.max(g.max, d)
    } else groups.set(drill.id, { tool: drill, min: d, max: d })
  }
  return { groups: [...groups.values()].sort((a, b) => byDiameter(a.tool, b.tool)), toMill }
}

/** Builds an ordered list of steps for the imported layers. See the module comment for the ordering. */
export function recipe(ctx: RecipeContext): CamStep[] {
  const { layers, tools, material, machine, newId } = ctx
  const copperTop = layers.filter((l) => l.type === 'copper' && l.side === 'top')
  const copperBottom = layers.filter((l) => l.type === 'copper' && l.side === 'bottom')
  const drillLayers = layers.filter((l) => l.type === 'drill')
  const outlineLayers = layers.filter((l) => l.type === 'outline')

  const doubleSided = copperTop.length > 0 && copperBottom.length > 0
  const firstSide: 'top' | 'bottom' = copperTop.length > 0 || copperBottom.length === 0 ? 'top' : 'bottom'
  const lastSide: 'top' | 'bottom' = doubleSided ? 'bottom' : firstSide

  const mk = (
    kind: CamStep['kind'],
    side: 'top' | 'bottom',
    layerIds: string[],
    tool: Tool | null
  ): CamStep =>
    createStep(kind, { id: newId(), side, layerIds, toolId: tool?.id ?? null, tool, machine, material })
  const isolate = (side: 'top' | 'bottom', copper: ImportedLayer[]): CamStep => {
    const s = mk(
      'isolate',
      side,
      copper.map((l) => l.id),
      isoTool
    )
    if (isoTool) {
      const plan = planIsolation(
        isoTool,
        combinedClearance(copper.map((l) => ctx.clearance?.[l.id])),
        material
      )
      s.cutDepth = plan.cutDepth
      s.params.isolation = {
        ...s.params.isolation,
        passes: plan.passes,
        overlap: plan.overlap,
        extraClearance: plan.extraClearance,
        smart: plan.smart,
        smartMaxGap: plan.smartMaxGap
      }
    }
    return s
  }

  const steps: CamStep[] = []
  const isoTool = pickIsolationTool(tools)

  // 1. Alignment pins
  if (doubleSided) {
    steps.push(mk('alignment', firstSide, [], pickAlignmentTool(tools, material.alignment.pinDiameter)))
  }

  // 2. First side
  const firstCopper = firstSide === 'top' ? copperTop : copperBottom
  if (firstCopper.length) steps.push(isolate(firstSide, firstCopper))

  if (drillLayers.length) {
    const ids = drillLayers.map((l) => l.id)
    const diameters: number[] = []
    let hasData = false
    for (const l of drillLayers) {
      const d = l.parsed?.drills
      if (!d) continue
      hasData = true
      for (const h of d.holes) diameters.push(h.diameter)
      for (const s of d.slots) diameters.push(s.diameter)
    }
    if (!hasData) {
      // Not parsed yet: one generic drill step the user can refine.
      const drills = tools.filter((t) => t.type === 'drill').sort(byDiameter)
      const first = drills.find((t) => t.geometry.diameter >= 0.8)
      const drill = first && sameSizeOwn(drills, first)
      steps.push(mk('drill', firstSide, ids, drill ?? null))
    } else {
      const { groups, toMill } = groupHolesByDrill(diameters, tools)
      for (const g of groups) {
        const s = mk('drill', firstSide, ids, g.tool)
        s.name = `Drill holes ${fmtRange(g.min, g.max)} (${firstSide})`
        s.params.drill.minDiameter = r3(g.min - 0.001)
        s.params.drill.maxDiameter = r3(g.max + 0.001)
        steps.push(s)
      }
      if (toMill.length) {
        const smallest = Math.min(...toMill)
        const s = mk('holeMill', firstSide, ids, pickHoleMillTool(tools, smallest))
        s.params.holeMill.minDiameter = r3(smallest - 0.001)
        s.params.holeMill.maxDiameter = MAX_HOLE
        steps.push(s)
      }
    }
  }

  // 3. Second side
  if (doubleSided) steps.push(isolate('bottom', copperBottom))

  // 4. Cutout
  if (outlineLayers.length)
    steps.push(
      mk(
        'cutout',
        lastSide,
        outlineLayers.map((l) => l.id),
        pickCutoutTool(tools)
      )
    )

  return steps
}

/** "0.4 mm" / "0.8–1 mm": sizes rounded to 0.01 mm (inch files give 0.399 for 0.0157"). */
function fmtRange(min: number, max: number): string {
  const r = (v: number): number => Math.round(v * 100) / 100
  return r(min) === r(max) ? `${r(min)} mm` : `${r(min)}–${r(max)} mm`
}
