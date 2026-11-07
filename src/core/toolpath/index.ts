/**
 * Toolpath generation: CamStep + Tool + layers → Toolpath in machine WORK coordinates.
 * See frame.ts for the coordinate conventions and each generator module for its strategy.
 */
import { generateEngrave } from './engrave'
import type { CamStep, Tool, Toolpath, ToolpathSegment } from '../model/types'
import { makeContext, ToolpathError, type StepContext, type ToolpathInput } from './context'
import { generateClear } from './clear'
import { generateCutout } from './cutout'
import { generateAlignment, generateDrill, generateHoleMill } from './holes'
import { generateIsolation } from './isolate'
import { computeStats } from './moves'

export type { ToolpathInput } from './context'
export { ToolpathError } from './context'
export { activeSkips, holeMatches, skippedIslands } from './skip'
export {
  alignmentPinPositions,
  boardToStockTransform,
  boardToWorkTransform,
  flipTransform,
  placedBoardBBox,
  stockRectInWork,
  stockSideToWork,
  stockToWork,
  workOriginInStock
} from './frame'
export {
  computeStats,
  depthLevels,
  estimateTime,
  flattenMoves,
  linearizeArcs,
  moveLength,
  type Vec3
} from './moves'
export {
  analyzeClearance,
  CLEARANCE_LIMIT,
  findNarrowGaps,
  MILLABLE_GAP,
  narrowestGap,
  type ClearanceInfo,
  type GapReport
} from './gaps'
export { placeTabs } from './cutout'
export { drillMoves, holeMillSegment } from './holes'
export { isolationOffsets } from './isolate'
export { buildOutline } from './outline'
export { orderPaths, orderPoints } from './order'
export { simplifyPath } from './pathUtils'

function run(ctx: StepContext): ToolpathSegment[] {
  switch (ctx.input.step.kind) {
    case 'isolate':
      return generateIsolation(ctx)
    case 'clear':
      return generateClear(ctx)
    case 'cutout':
      return generateCutout(ctx)
    case 'drill':
      return generateDrill(ctx)
    case 'holeMill':
      return generateHoleMill(ctx)
    case 'alignment':
      return generateAlignment(ctx)
    case 'engrave':
      return generateEngrave(ctx)
    default:
      throw new ToolpathError(`Unknown step kind "${String(ctx.input.step.kind)}".`)
  }
}

/**
 * Generate the toolpath for one step. Throws ToolpathError on unusable input (e.g. no source layer);
 * recoverable problems are returned in `warnings`.
 */
export function generateToolpath(input: ToolpathInput): Toolpath {
  const { step, tool, machine } = input
  if (!(tool.geometry.diameter > 0)) throw new ToolpathError(`Tool "${tool.name}" has no diameter.`)
  if (!(tool.feeds.feedXY > 0) || !(tool.feeds.feedZ > 0))
    throw new ToolpathError(`Tool "${tool.name}" has no feed rates.`)
  const ctx = makeContext(input)
  const segments = run(ctx).filter((s) => s.moves.length > 0)
  if (segments.length === 0 && ctx.warnings.length === 0) ctx.warnings.push('This step produced no toolpath.')
  return {
    stepId: step.id,
    stepName: step.name,
    stepKind: step.kind,
    side: step.side,
    toolId: tool.id,
    segments,
    stats: computeStats(segments, machine),
    warnings: ctx.warnings,
    problems: ctx.problems
  }
}

export interface GenerateAllInput extends Omit<ToolpathInput, 'step' | 'tool'> {
  steps: CamStep[]
  tools: Tool[]
}

/** Generate every enabled step; failures are collected per step instead of thrown. */
export function generateAll(input: GenerateAllInput): {
  toolpaths: Toolpath[]
  errors: { stepId: string; message: string }[]
} {
  const toolpaths: Toolpath[] = []
  const errors: { stepId: string; message: string }[] = []
  const { steps, tools, ...rest } = input
  for (const step of steps) {
    if (!step.enabled) continue
    const tool = tools.find((t) => t.id === step.toolId)
    if (!tool) {
      errors.push({ stepId: step.id, message: 'No tool selected for this step.' })
      continue
    }
    try {
      toolpaths.push(generateToolpath({ ...rest, step, tool }))
    } catch (e) {
      errors.push({ stepId: step.id, message: e instanceof Error ? e.message : String(e) })
    }
  }
  return { toolpaths, errors }
}
