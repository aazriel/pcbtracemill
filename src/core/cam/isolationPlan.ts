/**
 * Isolation settings from the board's measured copper spacing (D-031).
 *
 * Narrow design clearances (≤ 0.5 mm) get ONE pass placed in the middle of the gap (extra
 * clearance = (gap − groove) / 2) and a depth that keeps the V-bit groove narrow; wider clearances
 * get two passes unless the second pass would add more than half an hour.
 */
import type { ClearanceInfo, Material, Tool } from '../model/types'
import { effectiveCutWidth } from '../tools/geometry'
import { defaultCopperDepth } from './steps'

/** Gaps up to this (mm) are narrow and hard to mill; 0.5 mm and more is comfortable. */
export const TIGHT_CLEARANCE = 0.5
/** Smart clearance: gaps up to this wide (mm) are cut once, along their middle (D-034). */
export const SMART_MAX_GAP = 1
/**
 * Smart clearance: where the copper is further apart, the passes keep this far from it (mm), so a
 * groove that comes out a little wide does not eat a thin trace. Slots it would close are still cut.
 */
export const SMART_EXTRA_CLEARANCE = 0.1
/** Below this clearance an unprobed board almost certainly fails: recommend auto-levelling. */
export const PROBE_RECOMMENDED_BELOW = 0.8
/** A second pass that adds more than this (s) is left out by the automatic settings. */
export const EXTRA_PASS_LIMIT_S = 30 * 60
/** Warn when the passes the user chose add at least this much time (s). */
export const EXTRA_PASS_NOTICE_S = 30 * 60

/**
 * Deepest isolation cut for a design clearance (user's rule, D-031 update): gaps under 0.5 mm
 * 0.035 mm (just through 1 oz copper - the V-bit groove stays narrow), 0.5-1 mm 0.05 mm, wider
 * 0.1 mm.
 */
const DEPTH_STEPS: [number, number][] = [
  [TIGHT_CLEARANCE, 0.035],
  [SMART_MAX_GAP, 0.05]
]
const WIDE_DEPTH = 0.1

const r3 = (v: number): number => Math.round(v * 1000) / 1000

/** The deepest isolation cut that is safe for this clearance (null = wide gaps: 0.1 mm). */
export function maxIsolationDepth(clearance: number | null): number {
  if (clearance === null) return WIDE_DEPTH
  for (const [below, depth] of DEPTH_STEPS) if (clearance < below - 1e-9) return depth
  return WIDE_DEPTH
}

/**
 * Overlap between neighbouring passes for a tool type. A V-bit (and a ball) cuts its full width
 * only at full depth – where the board is a few hundredths higher the groove is barely wider than
 * the tip – so its passes overlap by half; a flat end mill cuts its full diameter at any depth.
 */
export function defaultOverlap(tool: Pick<Tool, 'type'> | null | undefined): number {
  if (!tool) return 0.4
  if (tool.type === 'vbit') return 0.5
  if (tool.type === 'ball') return 0.4
  return 0.15
}

/** Probe grid spacing (mm) that is fine enough for this clearance: 10 mm for tight boards, 20 for easy ones. */
export function recommendedProbeSpacing(clearance: number | null): number {
  if (clearance !== null && clearance < 0.5) return 10
  if (clearance !== null && clearance < 1.2) return 15
  return 20
}

/** Seconds for one isolation pass around all copper (outline length at the tool's feed). */
export function passSeconds(info: ClearanceInfo, tool: Tool): number {
  const f = tool.feeds.feedXY > 0 ? tool.feeds.feedXY : 100
  // ~10 % for the slightly longer offset path, moves between islands and acceleration
  return (info.perimeter / f) * 60 * 1.1
}

export interface IsolationPlan {
  passes: number
  overlap: number
  extraClearance: number
  cutDepth: number
  /** Smart clearance (D-034): gaps up to smartMaxGap get one groove in their middle. */
  smart: boolean
  smartMaxGap: number
  /** Groove width at that depth, mm. */
  width: number
  /** The narrowest gap the plan is for (null = wide / unknown). */
  clearance: number | null
  /** The narrow gaps are cut in their middle. */
  centred: boolean
  /** The groove is wider than the gap: those places will not be isolated. */
  tooWide: boolean
  /** Extra time one more pass would take, s (null = unknown). */
  passSeconds: number | null
  /** Short sentences explaining the choice, shown to the user. */
  notes: string[]
}

/** "1 h 10 min" / "25 min" */
export function roughDuration(sec: number): string {
  const m = Math.max(1, Math.round(sec / 60))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${String(r).padStart(2, '0')} min` : `${h} h`
}

const mm = (v: number): string => `${r3(v)} mm`

/** " (12 places; most gaps are 0.4 mm)" */
function where(info: ClearanceInfo | null): string {
  if (!info) return ''
  const n = `${info.atClearance} place${info.atClearance === 1 ? '' : 's'}`
  const most =
    info.typical !== null && info.clearance !== null && info.typical > info.clearance + 0.02
      ? `; most gaps are ${mm(info.typical)}`
      : ''
  return ` (${n}${most})`
}

/**
 * Isolation settings for `tool` on copper whose spacing is `info` (null = not measured: the
 * usual 2 passes). `passTime` overrides the estimated time of one pass (s).
 */
export function planIsolation(
  tool: Tool,
  info: ClearanceInfo | null,
  material: Pick<Material, 'copperThickness'>,
  passTime?: number
): IsolationPlan {
  const c = info?.clearance ?? null
  const base = defaultCopperDepth(material.copperThickness)
  // never shallower than the copper is thick
  const through = r3(material.copperThickness)
  const cutDepth = r3(Math.min(base, Math.max(maxIsolationDepth(c), through)))
  const width = effectiveCutWidth(tool, cutDepth)
  const overlap = defaultOverlap(tool)
  const pass = passTime ?? (info ? passSeconds(info, tool) : null)
  const notes: string[] = []
  const tooWide = c !== null && width > c + 1e-6
  // the extra passes only run where the copper is more than SMART_MAX_GAP apart
  let passes = 2
  if (pass !== null && pass > EXTRA_PASS_LIMIT_S) passes = 1

  if (c !== null && c <= TIGHT_CLEARANCE + 1e-9)
    notes.push(
      `The narrowest copper gaps on this board are ${mm(c)}${where(info)} - that is narrow and hard to mill (0.5 mm or more is easy; set it in your PCB design rules if you can). Auto-level the board: without probing a cut this shallow cannot follow it.`
    )
  else if (c !== null)
    notes.push(`The narrowest copper gaps are ${mm(c)}${where(info)} - comfortable to mill.`)
  if (tooWide)
    notes.push(
      `The ${mm(width)} groove of this bit is wider than the ${mm(c ?? 0)} gaps, so they will not be isolated - choose a finer V-bit.`
    )
  notes.push(
    `Smart clearance: every gap up to ${mm(SMART_MAX_GAP)} is cut ONCE, along its middle - as far from both traces as it can be, so a groove that comes out a bit wide does not eat the traces. Where the copper is further apart, ${passes} pass${passes > 1 ? 'es' : ''} follow${passes > 1 ? '' : 's'} the copper, ${mm(SMART_EXTRA_CLEARANCE)} away from it. ${mm(cutDepth)} deep${c !== null && c < TIGHT_CLEARANCE ? ' (just through the copper - no deeper for gaps this narrow)' : ''}.`
  )
  if (passes === 1 && pass !== null)
    notes.push(`1 pass in the open areas: a second one would add about ${roughDuration(pass)}.`)
  return {
    passes,
    overlap,
    extraClearance: SMART_EXTRA_CLEARANCE,
    cutDepth,
    smart: true,
    smartMaxGap: SMART_MAX_GAP,
    width,
    clearance: c,
    centred: !tooWide,
    tooWide,
    passSeconds: pass,
    notes
  }
}

/** The narrowest of several layers' clearances (null when none is known / all wide). */
export function combinedClearance(infos: (ClearanceInfo | null | undefined)[]): ClearanceInfo | null {
  const known = infos.filter((i): i is ClearanceInfo => !!i)
  if (!known.length) return null
  const narrowest = known.reduce((a, b) => ((a.clearance ?? Infinity) <= (b.clearance ?? Infinity) ? a : b))
  return { ...narrowest, perimeter: known.reduce((t, i) => t + i.perimeter, 0) }
}
