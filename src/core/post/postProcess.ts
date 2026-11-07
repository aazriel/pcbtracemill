import type {
  ExportGrouping,
  GcodeFile,
  MachineProfile,
  Tool,
  Toolpath,
  ToolpathSegment
} from '../model/types'
import { interpretGcode, machineTiming } from '../gcode/interpreter'
import { resolvePostOptions, type PostOptions } from './dialects'
import { fmtDuration, safeFileBase, slug, toolLabel } from './format'
import { ProgramWriter } from './writer'

export interface PostContext {
  machine: MachineProfile
  tools: Tool[]
  grouping: ExportGrouping
  projectName: string
  doubleSided: boolean
  /** Date string printed in the header. Default: current ISO timestamp. */
  date?: string
  /** Where to park the spindle for a board flip (work coordinates, mm). Default X0 Y0. */
  flipPark?: { x: number; y: number }
  /** Axis the board is flipped around (for the operator message). Default 'x'. */
  flipAxis?: 'x' | 'y'
}

const ESTIMATE_PLACEHOLDER = '\u0000ESTIMATE\u0000'

interface FileGroup {
  name: string
  toolpaths: Toolpath[]
}

function extOf(machine: MachineProfile): string {
  const e = machine.fileExtension.trim().replace(/^\.+/, '')
  return e || 'nc'
}

/** Split toolpaths into output files according to the grouping mode. Order is never changed. */
export function groupToolpaths(toolpaths: Toolpath[], ctx: PostContext): FileGroup[] {
  const base = safeFileBase(ctx.projectName)
  const ext = extOf(ctx.machine)
  const toolOf = (tp: Toolpath): Tool | undefined => ctx.tools.find((t) => t.id === tp.toolId)
  if (!toolpaths.length) return []
  if (ctx.grouping === 'combined') return [{ name: `${base}.${ext}`, toolpaths: [...toolpaths] }]
  if (ctx.grouping === 'per-step') {
    return toolpaths.map((tp, i) => ({
      name: `${base}_${String(i + 1).padStart(2, '0')}_${slug(tp.stepName)}.${ext}`,
      toolpaths: [tp]
    }))
  }
  // per-tool: merge CONSECUTIVE toolpaths with the same tool, never across a side change.
  const groups: Toolpath[][] = []
  for (const tp of toolpaths) {
    const cur = groups[groups.length - 1]
    const prev = cur?.[cur.length - 1]
    if (prev && prev.toolId === tp.toolId && prev.side === tp.side) cur.push(tp)
    else groups.push([tp])
  }
  const used = new Map<string, number>()
  return groups.map((g) => {
    const t = toolOf(g[0])
    const stem = `${base}_T${t?.number ?? 0}_${slug(t?.name ?? g[0].toolId)}`
    const n = (used.get(stem) ?? 0) + 1
    used.set(stem, n)
    return { name: `${stem}${n > 1 ? `_${n}` : ''}.${ext}`, toolpaths: g }
  })
}

/**
 * Convert toolpaths into one or more G-code programs for the machine's post-processor dialect.
 * Throws if a toolpath references a tool that is not in `ctx.tools`.
 */
export function postProcess(toolpaths: Toolpath[], ctx: PostContext): GcodeFile[] {
  const opts = resolvePostOptions(ctx.machine)
  for (const tp of toolpaths) {
    if (!ctx.tools.some((t) => t.id === tp.toolId))
      throw new Error(`Step "${tp.stepName}" uses a tool that is not in the tool library (${tp.toolId}).`)
  }
  return groupToolpaths(toolpaths, ctx).map((g) => emitFile(g, ctx, opts))
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

function emitFile(group: FileGroup, ctx: PostContext, opts: PostOptions): GcodeFile {
  const { machine } = ctx
  const w = new ProgramWriter(opts, machine)
  const tps = group.toolpaths
  const toolOf = (tp: Toolpath): Tool => ctx.tools.find((t) => t.id === tp.toolId) as Tool
  const toolIds = unique(tps.map((t) => t.toolId))
  const stepIds = unique(tps.map((t) => t.stepId))
  const sides = unique(tps.map((t) => t.side))
  const axis = (ctx.flipAxis ?? 'x').toUpperCase()

  // ── Header
  w.setContext(null, null)
  if (opts.percentWrap) w.raw('%')
  w.comment(`TraceMill G-code - ${opts.dialect} post`)
  w.comment(`Project: ${ctx.projectName}`)
  w.comment(`File: ${group.name}`)
  w.comment(`Machine: ${machine.name}`)
  w.comment(`Date: ${ctx.date ?? new Date().toISOString()}`)
  w.comment(`Units: ${opts.inch ? 'inch' : 'mm'}`)
  w.raw(ESTIMATE_PLACEHOLDER)
  w.comment('Work zero: X0 Y0 at the job origin, Z0 = top of the copper surface')
  if (ctx.doubleSided || sides.length > 1) {
    w.comment(`Side: ${sides.map((s) => s.toUpperCase()).join(' then ')}`)
    if (sides[0] === 'bottom')
      w.comment(`Board must be FLIPPED around the ${axis} axis (bottom side up) before running this file`)
  }
  w.comment('Tools:')
  for (const id of toolIds) {
    const t = ctx.tools.find((x) => x.id === id) as Tool
    w.comment(`  ${toolLabel(t)} - ${t.feeds.spindleRpm} rpm`)
  }
  w.comment('Steps:')
  tps.forEach((tp, i) =>
    w.comment(`  ${i + 1}. ${tp.stepName} [${tp.stepKind}, ${tp.side}, T${toolOf(tp).number}]`)
  )

  // ── Preamble
  w.raw(opts.inch ? 'G20' : 'G21')
  for (const l of opts.preamble) w.raw(l)
  for (const l of opts.customHeader) w.raw(l)
  w.liftTo(machine.safeZ)

  // ── Body
  let prevTool: Tool | null = null
  let prevSide: 'top' | 'bottom' | null = null
  for (const tp of tps) {
    const tool = toolOf(tp)
    w.setContext(tp.stepId, tp.toolId)
    if (prevSide !== null && tp.side !== prevSide) flipBlock(w, ctx, tp.side)
    if (prevTool === null) firstTool(w, tool)
    else if (prevTool.id !== tool.id) toolChange(w, tool)
    w.tool = tool
    w.comment(`Step: ${tp.stepName} (${tp.stepKind}, ${tp.side} side) with tool ${toolLabel(tool)}`)
    w.spindleOn(tool.feeds.spindleRpm)
    emitSegments(w, tp.segments)
    w.liftTo(machine.safeZ)
    prevTool = tool
    prevSide = tp.side
  }

  // ── Footer
  w.setContext(null, null)
  w.comment('End of program')
  w.liftTo(machine.safeZ)
  w.spindleOff(true)
  w.liftTo(Math.max(machine.safeZ, machine.toolChangeZ))
  for (const l of opts.customFooter) w.raw(l)
  w.raw(opts.endCode)
  if (opts.percentWrap) w.raw('%')

  // ── Estimate time from the program itself, then finalise.
  const draft = w.lines.join('\n')
  const est = interpretGcode(draft, machineTiming(machine))
  const estimatedSeconds = Math.round(est.totalSeconds * 10) / 10
  let lines = w.lines.map((l) =>
    l === ESTIMATE_PLACEHOLDER ? w.commentText(`Estimated time: ${fmtDuration(estimatedSeconds)}`) : l
  )
  if (opts.lineNumbers) {
    let n = 0
    lines = lines.map((l) => (l === '%' ? l : `N${(n += 10)} ${l}`))
  }
  const text = lines.join('\n') + '\n'
  return {
    name: group.name,
    text,
    sizeBytes: new TextEncoder().encode(text).length,
    estimatedSeconds,
    stepIds,
    toolIds,
    lineMeta: w.lineMeta()
  }
}

function emitSegments(w: ProgramWriter, segments: ToolpathSegment[]): void {
  let i = 0
  while (i < segments.length) {
    const seg = segments[i]
    if (seg.drill && w.opts.cannedCycles) {
      const run: NonNullable<ToolpathSegment['drill']>[] = []
      while (i < segments.length && segments[i].drill) {
        run.push(segments[i].drill as NonNullable<ToolpathSegment['drill']>)
        i++
      }
      w.drillCycles(run)
      continue
    }
    for (const m of seg.moves) w.move(m)
    i++
  }
}

function firstTool(w: ProgramWriter, tool: Tool): void {
  if (w.opts.toolChange) {
    w.liftTo(w.machine.toolChangeZ)
    w.codeWithComment(`T${tool.number} M6`, `Load tool ${toolLabel(tool)}`)
    if (w.opts.toolLengthOffset) w.raw(`G43 H${tool.number}`)
    w.invalidatePosition()
  } else {
    w.comment(`Tool ${toolLabel(tool)} must be loaded and Z zeroed on the copper before starting`)
  }
}

function toolChange(w: ProgramWriter, tool: Tool): void {
  const label = toolLabel(tool)
  w.comment(`TOOL CHANGE to ${label}`)
  if (w.z !== null) w.liftTo(w.machine.safeZ)
  w.spindleOff()
  w.liftTo(w.machine.toolChangeZ)
  if (w.opts.toolChange) {
    w.codeWithComment(`T${tool.number} M6`, `Load tool ${label}`)
    if (w.opts.toolLengthOffset) w.raw(`G43 H${tool.number}`)
    else w.comment('Re-zero Z on the copper if your controller does not apply tool length offsets')
  } else {
    w.comment('After inserting the tool, re-zero Z on the copper surface')
    w.codeWithComment('M0', `Insert tool ${label}, then press cycle start`)
  }
  w.invalidatePosition()
}

function flipBlock(w: ProgramWriter, ctx: PostContext, newSide: 'top' | 'bottom'): void {
  const park = ctx.flipPark ?? { x: 0, y: 0 }
  const axis = (ctx.flipAxis ?? 'x').toUpperCase()
  w.comment(`==== BOARD FLIP: following operations are on the ${newSide.toUpperCase()} side ====`)
  if (w.z !== null) w.liftTo(w.machine.safeZ)
  w.spindleOff()
  w.liftTo(Math.max(w.machine.safeZ, w.machine.toolChangeZ))
  w.raw(`G0 X${w.len(park.x)} Y${w.len(park.y)}`)
  w.codeWithComment(
    'M0',
    `FLIP THE BOARD NOW around the ${axis} axis, re-seat on the alignment pins, re-zero Z, then press Cycle Start`
  )
  w.invalidatePosition()
}
