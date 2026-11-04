/**
 * Shared helpers for the Manufacture stage steps UI: icons, colours, live validation, draft creation.
 */
import { useMemo } from 'react'
import {
  PenTool,
  CircleDashed,
  Crosshair,
  Drill,
  Eraser,
  Route,
  Scissors,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import type { CamStep, StepKind, StepValidation, ValidationIssue, ValidationLevel } from '@core/model/types'
import {
  STEP_KIND_INFO,
  layersForStep,
  pickAlignmentTool,
  pickCutoutTool,
  pickIsolationTool,
  toolsForStep,
  validateStep,
  type StepValidationContext
} from '@core/cam'
import { getHelp } from '@core/help'
import { layersWithParsed, useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { newStep, useLayersWithParsed } from '@renderer/store/controller'
import type { StatusLevel } from '@renderer/components/ui/status'

// ───────────────────────────────────────── icons

const ICONS_BY_NAME: Record<string, LucideIcon> = {
  crosshair: Crosshair,
  route: Route,
  eraser: Eraser,
  drill: Drill,
  'circle-dashed': CircleDashed,
  scissors: Scissors,
  'pen-tool': PenTool
}

export function stepIcon(kind: StepKind): LucideIcon {
  return ICONS_BY_NAME[STEP_KIND_INFO[kind].icon] ?? Wrench
}

/** Order of the tiles in the "Add step" dialog (roughly the order a job runs in). */
export const STEP_KIND_ORDER: StepKind[] = [
  'isolate',
  'clear',
  'drill',
  'holeMill',
  'cutout',
  'alignment',
  'engrave'
]

/** Short plural noun for what a step's params section is about. */
export const PARAMS_TITLE: Record<StepKind, string> = {
  isolate: 'Isolation',
  clear: 'Copper clearing',
  cutout: 'Cutout',
  drill: 'Drilling',
  holeMill: 'Hole milling',
  alignment: 'Alignment pins',
  engrave: 'Engraving'
}

// ───────────────────────────────────────── colours

/** Distinct step colours on a dark background. */
const PALETTE = [
  '#38bdf8',
  '#f472b6',
  '#a3e635',
  '#fbbf24',
  '#c084fc',
  '#34d399',
  '#fb7185',
  '#60a5fa',
  '#facc15',
  '#2dd4bf'
]

export function stepColor(index: number): string {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length]
}

// ───────────────────────────────────────── help

/** Plain-language body of a help key (empty string when missing). */
export function help(key: string): string {
  return getHelp(key)?.body ?? ''
}

// ───────────────────────────────────────── validation

/** Validation context from the current project, or null while machine/material are missing. */
export function useValidationCtx(): StepValidationContext | null {
  const layers = useLayersWithParsed()
  const tools = useProject((s) => s.tools)
  const material = useProject((s) => s.material)
  const machine = useProject((s) => s.machine)
  return useMemo(
    () => (material && machine ? { layers, tools, material, machine } : null),
    [layers, tools, material, machine]
  )
}

export function getValidationCtx(): StepValidationContext | null {
  const s = useProject.getState()
  if (!s.material || !s.machine) return null
  return { layers: layersWithParsed(s.layers), tools: s.tools, material: s.material, machine: s.machine }
}

export interface StepStatus {
  level: StatusLevel
  errors: number
  warnings: number
  issues: ValidationIssue[]
}

const RANK: Record<ValidationLevel, number> = { ok: 0, warning: 1, error: 2 }

export function summarize(issues: ValidationIssue[]): StepStatus {
  const errors = issues.filter((i) => i.level === 'error').length
  const warnings = issues.filter((i) => i.level === 'warning').length
  const level = issues.reduce<ValidationLevel>((l, i) => (RANK[i.level] > RANK[l] ? i.level : l), 'ok')
  return { level, errors, warnings, issues }
}

/**
 * Live status of a step: always re-validates the step itself (instant feedback while CAM is stale or
 * still running) and adds the "results" warnings (e.g. unreachable areas) from the last CAM run.
 */
export function stepStatus(
  step: CamStep,
  ctx: StepValidationContext | null,
  camValidation: StepValidation | undefined
): StepStatus {
  if (!ctx) {
    return camValidation
      ? summarize(camValidation.issues)
      : { level: 'pending', errors: 0, warnings: 0, issues: [] }
  }
  const live = validateStep(step, ctx)
  const results = camValidation?.issues.filter((i) => i.section === 'results') ?? []
  return summarize([...live.issues, ...results])
}

export function useStepStatus(step: CamStep, ctx: StepValidationContext | null): StepStatus {
  const cam = useUi((s) => s.cam)
  const camV = cam?.validations.find((v) => v.stepId === step.id)
  return useMemo(() => stepStatus(step, ctx, camV), [step, ctx, camV])
}

// ───────────────────────────────────────── drafts

/** New step pre-filled with relevant layers on the current side and a recommended tool. */
export function createDraft(kind: StepKind): CamStep {
  const s = useProject.getState()
  const ui = useUi.getState()
  const layers = layersWithParsed(s.layers)
  const hasCopper = (side: 'top' | 'bottom'): boolean =>
    layers.some((l) => l.type === 'copper' && l.side === side)
  let side: 'top' | 'bottom' = ui.viewSide
  if (!hasCopper(side) && hasCopper(side === 'top' ? 'bottom' : 'top'))
    side = side === 'top' ? 'bottom' : 'top'
  if (kind === 'alignment' || kind === 'drill' || kind === 'holeMill' || kind === 'cutout') {
    // Through-cuts are normally done while the first side (top) faces up, unless the board is bottom-only.
    side = hasCopper('top') || !hasCopper('bottom') ? 'top' : 'bottom'
  }
  const base = newStep(kind)
  const relevant = layersForStep(kind, layers, side)
  const layerIds =
    kind === 'isolate' || kind === 'clear' ? relevant.slice(0, 1).map((l) => l.id) : relevant.map((l) => l.id)

  let toolId: string | null = null
  if (kind === 'isolate') toolId = pickIsolationTool(s.tools)?.id ?? null
  else if (kind === 'cutout') toolId = pickCutoutTool(s.tools)?.id ?? null
  else if (kind === 'alignment' && s.material)
    toolId = pickAlignmentTool(s.tools, s.material.alignment.pinDiameter)?.id ?? null
  else if (kind === 'drill') {
    // Drill closest to the most common hole size.
    const sizes = new Map<number, number>()
    for (const l of relevant)
      for (const h of l.parsed?.drills?.holes ?? []) {
        const d = Math.round(h.diameter * 100) / 100
        sizes.set(d, (sizes.get(d) ?? 0) + 1)
      }
    const common = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const drills = toolsForStep(kind, s.tools).map((c) => c.tool)
    if (common !== undefined && drills.length)
      toolId = [...drills].sort(
        (a, b) => Math.abs(a.geometry.diameter - common) - Math.abs(b.geometry.diameter - common)
      )[0].id
    else toolId = drills[0]?.id ?? null
  }
  if (!toolId) toolId = toolsForStep(kind, s.tools)[0]?.tool.id ?? null

  const name = kind === 'alignment' ? STEP_KIND_INFO[kind].label : `${STEP_KIND_INFO[kind].label} (${side})`
  return { ...base, side, name, layerIds, toolId }
}

/** Changes the side of a draft; swaps the copper layer for the other side's and updates a default name. */
export function withSide(step: CamStep, side: 'top' | 'bottom'): CamStep {
  if (step.side === side) return step
  const layers = useProject.getState().layers
  const info = STEP_KIND_INFO[step.kind]
  let layerIds = step.layerIds
  const copperSel = layers.filter((l) => layerIds.includes(l.id) && l.type === 'copper')
  if (copperSel.length && copperSel.every((l) => l.side === step.side)) {
    const other = layers.filter((l) => l.type === 'copper' && l.side === side)
    layerIds = [
      ...layerIds.filter((id) => !copperSel.some((l) => l.id === id)),
      ...other.slice(0, 1).map((l) => l.id)
    ]
  }
  const name = step.name === `${info.label} (${step.side})` ? `${info.label} (${side})` : step.name
  return { ...step, side, layerIds, name }
}

export function layerLabel(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}
