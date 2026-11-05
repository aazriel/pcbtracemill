/**
 * CAM pipeline: project document → validations, toolpaths, G-code files.
 * Pure; runs inside the CAM worker.
 */
import type {
  CamStep,
  ExportGrouping,
  GcodeFile,
  ImportedLayer,
  MachineProfile,
  Material,
  StepValidation,
  Tool,
  Toolpath
} from '../model/types'
import { computeBoardBBox } from '../model/board'
import { combineValidation, validateStep } from '../cam'
import { generateToolpath } from '../toolpath'
import { postProcess } from '../post'
import { bboxIsEmpty } from '../geometry'

export interface CamRequest {
  projectName: string
  layers: ImportedLayer[]
  steps: CamStep[]
  tools: Tool[]
  material: Material
  machine: MachineProfile
  grouping: ExportGrouping
}

export interface CamResult {
  validations: StepValidation[]
  toolpaths: Toolpath[]
  files: GcodeFile[]
  /** The whole job as one program (always 'combined'), used by the simulator. */
  combined: GcodeFile | null
  /** Project-wide notes (e.g. holes no step drills). */
  notes: string[]
  /** Seconds spent generating. */
  elapsed: number
}

const DIAM_EPS = 1e-3

/**
 * `onStep` is told which step is being worked on (null when the toolpaths are done), so the UI can
 * show progress.
 */
export function runCam(req: CamRequest, onStep?: (stepId: string | null) => void): CamResult {
  const t0 = Date.now()
  const { layers, steps, tools, material, machine } = req
  const boardBBox = computeBoardBBox(layers)
  const toolpaths: Toolpath[] = []
  const validations: StepValidation[] = []
  for (const step of steps) {
    if (step.enabled) onStep?.(step.id)
    let v = validateStep(step, { layers, tools, material, machine })
    if (step.enabled && v.level !== 'error' && !bboxIsEmpty(boardBBox)) {
      const tool = tools.find((t) => t.id === step.toolId)!
      try {
        const tp = generateToolpath({ step, tool, layers, material, machine, boardBBox })
        toolpaths.push(tp)
        v = combineValidation(v, tp.warnings)
      } catch (e) {
        v = {
          ...v,
          level: 'error',
          issues: [
            ...v.issues,
            { level: 'error', section: 'results', message: e instanceof Error ? e.message : String(e) }
          ]
        }
      }
    }
    validations.push(v)
  }
  onStep?.(null)

  const notes: string[] = []
  // Holes that no enabled drill / hole-mill step covers.
  const covering = steps.filter((s) => s.enabled && (s.kind === 'drill' || s.kind === 'holeMill'))
  let uncovered = 0
  for (const l of layers) {
    if (l.type !== 'drill' || !l.parsed?.drills) continue
    for (const h of l.parsed.drills.holes) {
      const ok = covering.some((s) => {
        if (!s.layerIds.includes(l.id)) return false
        const p = s.kind === 'drill' ? s.params.drill : s.params.holeMill
        return h.diameter >= p.minDiameter - DIAM_EPS && h.diameter <= p.maxDiameter + DIAM_EPS
      })
      if (!ok) uncovered++
    }
  }
  if (uncovered > 0) notes.push(`${uncovered} hole(s) are not drilled or milled by any step.`)

  const post = (grouping: ExportGrouping): GcodeFile[] =>
    toolpaths.length
      ? postProcess(toolpaths, {
          machine,
          tools,
          grouping,
          projectName: req.projectName,
          doubleSided: material.doubleSided,
          flipAxis: material.alignment.axis
        })
      : []
  const files = post(req.grouping)
  const combined = req.grouping === 'combined' ? (files[0] ?? null) : (post('combined')[0] ?? null)
  return { validations, toolpaths, files, combined, notes, elapsed: (Date.now() - t0) / 1000 }
}
