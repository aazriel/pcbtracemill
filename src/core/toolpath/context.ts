/** Shared input type and per-step context for toolpath generators. */
import type {
  BBox,
  CamStep,
  DrillHole,
  DrillSlot,
  ImportedLayer,
  MachineProfile,
  Material,
  PolygonSet,
  Tool,
  ToolpathProblem,
  Vec2
} from '../model/types'
import { applyAffine, transformPolygonSet, union, type Affine } from '../geometry'
import { boardToWorkTransform } from './frame'
import { APPROACH_CLEARANCE, type CutContext } from './moves'

export interface ToolpathInput {
  step: CamStep
  tool: Tool
  /** Layers with `parsed` filled. Layers referenced by step.layerIds are used as sources. */
  layers: ImportedLayer[]
  material: Material
  machine: MachineProfile
  /** Board extents in board coordinates (see computeBoardBBox). */
  boardBBox: BBox
  /**
   * Copper clearing: an enabled isolation step on the same side runs before this one. false = the
   * clearing is the only thing separating the copper, so places it cannot pass are shorts (D-032).
   * undefined = unknown (single-step use).
   */
  isolatedBefore?: boolean
}

/** Thrown for unrecoverable input problems; generateAll reports the message per step. */
export class ToolpathError extends Error {}

export interface StepContext {
  input: ToolpathInput
  /** Board → work transform for the step's side. */
  m: Affine
  cut: CutContext
  warnings: string[]
  problems: ToolpathProblem[]
}

export function makeContext(input: ToolpathInput): StepContext {
  const { step, machine, tool } = input
  const safeZ = step.safeZ ?? machine.safeZ
  const feedXY = Math.min(tool.feeds.feedXY, machine.maxFeedXY > 0 ? machine.maxFeedXY : Infinity)
  const feedZ = Math.min(tool.feeds.feedZ, machine.maxFeedZ > 0 ? machine.maxFeedZ : Infinity)
  return {
    input,
    m: boardToWorkTransform(input.material, input.boardBBox, step.side),
    cut: { safeZ, approachZ: Math.min(safeZ, APPROACH_CLEARANCE), feedXY, feedZ },
    warnings: [],
    problems: []
  }
}

/** Parsed layers selected by the step, in step order. */
export function selectedLayers(input: ToolpathInput): ImportedLayer[] {
  const byId = new Map(input.layers.map((l) => [l.id, l]))
  const out: ImportedLayer[] = []
  for (const id of input.step.layerIds) {
    const l = byId.get(id)
    if (l?.parsed) out.push(l)
  }
  return out
}

/** Union of the selected layers' painted geometry in BOARD coordinates. */
export function selectedGeometry(input: ToolpathInput, filter?: (l: ImportedLayer) => boolean): PolygonSet {
  const layers = selectedLayers(input).filter((l) => (filter ? filter(l) : true))
  const sets = layers.map((l) => l.parsed!.geometry).filter((s) => s.length > 0)
  if (sets.length === 0) return []
  return union(...sets)
}

export function toWork(ctx: StepContext, set: PolygonSet): PolygonSet {
  return transformPolygonSet(ctx.m, set)
}

export function pointToWork(ctx: StepContext, p: Vec2): Vec2 {
  return applyAffine(ctx.m, p)
}

/** Holes and slots from the selected layers that carry drill data (BOARD coordinates). */
export function selectedDrills(input: ToolpathInput): { holes: DrillHole[]; slots: DrillSlot[] } {
  const holes: DrillHole[] = []
  const slots: DrillSlot[] = []
  for (const l of selectedLayers(input)) {
    const d = l.parsed!.drills
    if (!d) continue
    holes.push(...d.holes)
    slots.push(...d.slots)
  }
  return { holes, slots }
}

export function fmt(n: number, digits = 2): string {
  return n.toFixed(digits)
}
