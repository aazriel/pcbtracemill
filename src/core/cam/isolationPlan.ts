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

/** Gaps up to this (mm) are cut with one centred pass; 0.5 mm and more is comfortable to mill. */
export const TIGHT_CLEARANCE = 0.5
/** Below this clearance an unprobed board almost certainly fails: recommend auto-levelling. */
export const PROBE_RECOMMENDED_BELOW = 0.8
/** A second pass that adds more than this (s) is left out by the automatic settings. */
export const EXTRA_PASS_LIMIT_S = 30 * 60
/** Warn when the passes the user chose add at least this much time (s). */
export const EXTRA_PASS_NOTICE_S = 30 * 60

/** Deepest isolation cut for a design clearance: [clearance mm, max depth mm], interpolated. */
const DEPTH_CAPS: [number, number][] = [
  [0.2, 0.05],
  [0.3, 0.06],
  [0.4, 0.07],
  [0.5, 0.08],
  [0.6, 0.1]
]

const r3 = (v: number): number => Math.round(v * 1000) / 1000

/** The deepest isolation cut that is safe for this clearance (null = wide gaps: 0.1 mm). */
export function maxIsolationDepth(clearance: number | null): number {
  if (clearance === null) return DEPTH_CAPS[DEPTH_CAPS.length - 1][1]
  if (clearance <= DEPTH_CAPS[0][0]) return DEPTH_CAPS[0][1]
  for (let i = 1; i < DEPTH_CAPS.length; i++) {
    const [c1, d1] = DEPTH_CAPS[i]
    if (clearance <= c1) {
      const [c0, d0] = DEPTH_CAPS[i - 1]
      return r3(d0 + ((clearance - c0) / (c1 - c0)) * (d1 - d0))
    }
  }
  return DEPTH_CAPS[DEPTH_CAPS.length - 1][1]
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
  /** Groove width at that depth, mm. */
  width: number
  /** The board's design clearance the plan is for (null = wide / unknown). */
  clearance: number | null
  /** One pass in the middle of a narrow gap. */
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
  // never so shallow that the cut does not get through the copper
  const through = r3(material.copperThickness + 0.015)
  const cutDepth = r3(Math.min(base, Math.max(maxIsolationDepth(c), through)))
  const width = effectiveCutWidth(tool, cutDepth)
  const overlap = defaultOverlap(tool)
  const pass = passTime ?? (info ? passSeconds(info, tool) : null)
  const notes: string[] = []

  if (c !== null && c <= TIGHT_CLEARANCE + 1e-9) {
    const tooWide = width > c + 1e-6
    const extra = tooWide ? 0 : Math.floor(((c - width) / 2 + 1e-9) / 0.005) * 0.005
    notes.push(
      `The narrowest copper gaps on this board are ${mm(c)}${where(info)} – that is narrow and hard to mill (0.5 mm or more is easy; set it in your PCB design rules if you can). Auto-level the board: without probing a cut this shallow cannot follow it.`
    )
    if (tooWide)
      notes.push(
        `The ${mm(width)} groove of this bit is wider than the ${mm(c)} gaps, so they will not be isolated – choose a finer V-bit.`
      )
    else
      notes.push(
        `Set for the ${mm(c)} gaps: 1 pass, ${mm(cutDepth)} deep (no deeper for gaps this narrow) and ${mm(extra)} extra clearance, so the ${mm(width)} groove runs in the middle of the gap.`
      )
    return {
      passes: 1,
      overlap,
      extraClearance: r3(extra),
      cutDepth,
      width,
      clearance: c,
      centred: !tooWide,
      tooWide,
      passSeconds: pass,
      notes
    }
  }

  let passes = 2
  if (pass !== null && pass > EXTRA_PASS_LIMIT_S) {
    passes = 1
    notes.push(
      `1 pass: a second one would add about ${roughDuration(pass)}. Add it if you want wider gaps around the traces.`
    )
  }
  if (c !== null)
    notes.push(
      `The narrowest copper gaps are ${mm(c)}${where(info)} – comfortable to mill. Set: ${passes} pass${passes > 1 ? 'es' : ''}, ${mm(cutDepth)} deep${passes > 1 ? `, ${Math.round(overlap * 100)} % overlap` : ''}.`
    )
  return {
    passes,
    overlap,
    extraClearance: 0,
    cutDepth,
    width,
    clearance: c,
    centred: false,
    tooWide: false,
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
