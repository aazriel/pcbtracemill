/**
 * CAM step definitions: what each step kind does, which tools/layers it accepts, defaults and validation.
 */
import type {
  CamStep,
  ImportedLayer,
  LayerType,
  MachineProfile,
  Material,
  StepKind,
  StepParams,
  StepValidation,
  Tool,
  ToolType,
  ValidationIssue,
  ValidationLevel
} from '../model/types'
import { TOOL_TYPE_INFO, validateTool } from '../tools'
import { defaultOverlap } from './isolationPlan'

export interface StepKindInfo {
  label: string
  description: string
  /** lucide-react icon name. */
  icon: string
  allowedToolTypes: ToolType[]
  preferredToolTypes: ToolType[]
  /** Empty = the step needs no source layer (alignment pins). */
  allowedLayerTypes: LayerType[]
}

/**
 * Tool choices:
 *  - clear: flat (preferred), V-bit and ball. Corn bits are excluded: their chip-breaker teeth leave a rough,
 *    uneven floor and they would mostly cut fibreglass rather than skim copper.
 *  - cutout: corn (preferred) and flat. Drills/V-bits must never cut sideways through the full board.
 *  - holeMill: flat and corn (both preferred).
 *  - alignment: drill (preferred, exact pin size) or flat (circle-milled).
 */
export const STEP_KIND_INFO: Record<StepKind, StepKindInfo> = {
  alignment: {
    label: 'Alignment pins',
    description:
      'Drills two holes outside the board, through the board and into the spoilboard below. Pins pushed into them hold the board in exactly the right place after you flip it to mill the second side.',
    icon: 'crosshair',
    allowedToolTypes: ['drill', 'flat'],
    preferredToolTypes: ['drill'],
    allowedLayerTypes: []
  },
  isolate: {
    label: 'Isolate traces',
    description:
      'Cuts a thin groove through the copper around every track and pad so they are no longer connected to the rest of the copper. This is what turns a copper sheet into a circuit.',
    icon: 'route',
    allowedToolTypes: ['vbit', 'flat', 'ball'],
    preferredToolTypes: ['vbit'],
    allowedLayerTypes: ['copper']
  },
  clear: {
    label: 'Clear copper',
    description:
      'Removes the leftover copper between traces (all of it, or a band around the traces). Optional: it makes soldering easier and the board look cleaner, but takes much longer.',
    icon: 'eraser',
    allowedToolTypes: ['flat', 'vbit', 'ball'],
    preferredToolTypes: ['flat'],
    allowedLayerTypes: ['copper']
  },
  drill: {
    label: 'Drill holes',
    description: 'Drills the holes for component legs, vias and screws, using a drill bit of matching size.',
    icon: 'drill',
    allowedToolTypes: ['drill'],
    preferredToolTypes: ['drill'],
    allowedLayerTypes: ['drill']
  },
  holeMill: {
    label: 'Mill big holes',
    description:
      'Makes holes that are bigger than your drill bits by moving a smaller end mill around in a circle (like cutting out a disc).',
    icon: 'circle-dashed',
    allowedToolTypes: ['flat', 'corn'],
    preferredToolTypes: ['flat', 'corn'],
    allowedLayerTypes: ['drill']
  },
  engrave: {
    label: 'Engrave silkscreen',
    description:
      'Scratches the silkscreen artwork (text, component outlines, logos) into the board with a fine V-bit. Best done where there is no copper, or after clearing copper, so it does not cut your traces.',
    icon: 'pen-tool',
    allowedToolTypes: ['vbit', 'ball', 'flat'],
    preferredToolTypes: ['vbit'],
    allowedLayerTypes: ['silkscreen', 'fab', 'soldermask', 'other']
  },
  cutout: {
    label: 'Cut out board',
    description:
      'Cuts all the way through the material along the board outline, leaving small tabs so the board does not break loose while cutting. Always done last.',
    icon: 'scissors',
    allowedToolTypes: ['corn', 'flat'],
    preferredToolTypes: ['corn'],
    allowedLayerTypes: ['outline']
  }
}

/** Default parameters for every section (each step stores all of them; only its own kind's are used). */
export function defaultStepParams(): StepParams {
  return {
    isolation: { passes: 2, overlap: 0.4, direction: 'climb', extraClearance: 0 },
    clear: { overlap: 0.4, direction: 'climb', minIslandArea: 0.05, clearMargin: 0 },
    cutout: { tabs: 4, tabWidth: 3, tabHeight: 0.5, outside: true },
    drill: { peck: 0, retract: 1, minDiameter: 0, maxDiameter: 100, includeSlots: true },
    holeMill: { minDiameter: 0, maxDiameter: 100, helical: true }
  }
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** Default copper cut depth: a bit more than twice the copper (0.1 mm for 35 µm copper). */
export function defaultCopperDepth(copperThickness: number): number {
  return round3(Math.max(0.1, copperThickness * 2 + 0.02))
}

/** Default final depth for a step kind, given the material. */
export function defaultCutDepth(
  kind: StepKind,
  material: Pick<Material, 'thickness' | 'copperThickness'>
): number {
  const t = material.thickness
  switch (kind) {
    case 'isolate':
    case 'clear':
      return defaultCopperDepth(material.copperThickness)
    case 'engrave':
      // A light scratch: through the copper (when engraving on bare copper) without biting deep.
      return round3(Math.max(0.05, material.copperThickness + 0.03))
    case 'cutout':
      return round3(t + 0.1)
    case 'drill':
      return round3(t + 0.3)
    case 'holeMill':
      return round3(t + 0.2)
    case 'alignment':
      // Through the board and ~2 mm into the spoilboard so the pins have something to hold on to.
      return round3(t + 2)
  }
}

export interface CreateStepOptions {
  id: string
  side?: 'top' | 'bottom'
  layerIds?: string[]
  toolId?: string | null
  /** The chosen tool: its type sets the pass overlap (V-bit 50 %, flat 15 %). */
  tool?: Tool | null
  machine?: MachineProfile
  material?: Material
}

const DEFAULT_MATERIAL_DIMS = { thickness: 1.6, copperThickness: 0.035 }

/** Creates a step with sensible defaults. Safe Z defaults to null (= machine default). */
export function createStep(kind: StepKind, opts: CreateStepOptions): CamStep {
  const side = opts.side ?? 'top'
  const name = kind === 'alignment' ? STEP_KIND_INFO[kind].label : `${STEP_KIND_INFO[kind].label} (${side})`
  const params = defaultStepParams()
  if (opts.tool) {
    params.isolation.overlap = defaultOverlap(opts.tool)
    params.clear.overlap = defaultOverlap(opts.tool)
  }
  return {
    id: opts.id,
    kind,
    name,
    enabled: true,
    side,
    layerIds: [...(opts.layerIds ?? [])],
    toolId: opts.toolId ?? null,
    cutDepth: defaultCutDepth(kind, opts.material ?? DEFAULT_MATERIAL_DIMS),
    safeZ: null,
    params
  }
}

// ─────────────────────────────────────────────────────────────── Layer / tool matching

/** Layers a step of this kind can use. With `side`, copper layers on the other side are excluded. */
export function layersForStep(
  kind: StepKind,
  layers: ImportedLayer[],
  side?: 'top' | 'bottom'
): ImportedLayer[] {
  const types = STEP_KIND_INFO[kind].allowedLayerTypes
  return layers.filter((l) => {
    if (!types.includes(l.type)) return false
    if (side && l.type === 'copper' && (l.side === 'top' || l.side === 'bottom')) return l.side === side
    return true
  })
}

/** Short in-sentence names for tool types. */
const TOOL_NOUN: Record<ToolType, string> = {
  vbit: 'V-bit',
  flat: 'flat end mill',
  ball: 'ball end mill',
  drill: 'drill bit',
  corn: 'corn (PCB router) bit'
}

function typeList(types: ToolType[]): string {
  const names = types.map((t) => TOOL_NOUN[t])
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

/** Whether `tool` may be used for `kind`, with an explanation either way. */
export function isToolAllowed(kind: StepKind, tool: Tool): { ok: boolean; message: string } {
  const info = STEP_KIND_INFO[kind]
  const label = TOOL_TYPE_INFO[tool.type]?.label ?? tool.type
  if (!info.allowedToolTypes.includes(tool.type)) {
    return {
      ok: false,
      message: `"${info.label}" needs a ${typeList(info.allowedToolTypes)}, but "${tool.name}" is a ${TOOL_NOUN[tool.type] ?? tool.type}.`
    }
  }
  if (info.preferredToolTypes.includes(tool.type))
    return { ok: true, message: `${label} is a good fit for this step.` }
  return {
    ok: true,
    message: `${label} works, but a ${typeList(info.preferredToolTypes)} usually gives better results.`
  }
}

function recommendation(kind: StepKind, tool: Tool): { recommended: boolean; reason: string } {
  const g = tool.geometry
  const preferred = STEP_KIND_INFO[kind].preferredToolTypes.includes(tool.type)
  switch (kind) {
    case 'isolate':
      if (tool.type === 'vbit') {
        const fine = (g.tipAngle ?? 60) <= 60 && (g.tipDiameter ?? 0) <= 0.2
        return {
          recommended: fine,
          reason: fine
            ? 'Fine V-bit: cuts narrow grooves at shallow depth, ideal for isolation.'
            : 'Wide V-bit: works, but grooves get wide quickly; may not fit between close traces.'
        }
      }
      if (g.diameter <= 0.4)
        return { recommended: false, reason: 'Small end mill: works for isolation, but breaks easily.' }
      return { recommended: false, reason: 'Too wide for most trace gaps; use only for coarse boards.' }
    case 'clear':
      return preferred
        ? { recommended: true, reason: 'Flat bottom gives an even floor when removing copper.' }
        : { recommended: false, reason: 'Works, but cuts a narrow path so clearing takes much longer.' }
    case 'cutout':
      if (tool.type === 'corn') {
        const good = g.diameter >= 0.8 && g.diameter <= 2.0
        return {
          recommended: good,
          reason: good
            ? 'Corn bit made for cutting fibreglass; sturdy at this size.'
            : 'Corn bit, but an unusual size for cutting out (1–2 mm is typical).'
        }
      }
      return { recommended: false, reason: 'End mills cut FR4 but dull quickly from the glass fibres.' }
    case 'drill':
      return { recommended: true, reason: 'Drill bit: makes clean holes of its own size.' }
    case 'holeMill':
      return { recommended: true, reason: 'Can mill any hole larger than its own diameter.' }
    case 'engrave':
      return tool.type === 'vbit' && (g.tipDiameter ?? 0) <= 0.2
        ? { recommended: true, reason: 'Fine V-bit: thin, crisp engraved lines.' }
        : { recommended: false, reason: 'Works, but lines come out wider than the artwork.' }
    case 'alignment':
      return tool.type === 'drill'
        ? { recommended: true, reason: 'Drill of the pin size gives a snug, accurate pin hole.' }
        : { recommended: false, reason: 'Mills the pin hole in a circle; must be smaller than the pin.' }
  }
}

/** What the step needs, so the recommendation can use the real numbers (all optional). */
export interface ToolPickContext {
  /** Hole diameters this step makes (drilling / hole milling), mm. */
  holeDiameters?: number[]
  /** Material thickness, mm (cutout and hole milling need a long enough cutting length). */
  thickness?: number
  /** Alignment pin diameter, mm. */
  pinDiameter?: number
}

export interface ToolChoice {
  tool: Tool
  recommended: boolean
  reason: string
  /** The single best choice among the recommended ones (your own tools are preferred). */
  best?: boolean
}

const mm = (v: number): string => `${Math.round(v * 100) / 100} mm`

/** Refines the generic recommendation with the step's numbers; returns a score for "best" (higher = better). */
function refine(
  kind: StepKind,
  tool: Tool,
  base: { recommended: boolean; reason: string },
  ctx: ToolPickContext
): { recommended: boolean; reason: string; score: number } {
  const d = tool.geometry.diameter
  const len = tool.geometry.fluteLength ?? 0
  const sizes = (ctx.holeDiameters ?? []).filter((v) => v > 0)
  switch (kind) {
    case 'drill': {
      if (!sizes.length || tool.type !== 'drill') return { ...base, score: 0 }
      // the size most holes have
      const counts = new Map<number, number>()
      for (const v of sizes)
        counts.set(Math.round(v * 100) / 100, (counts.get(Math.round(v * 100) / 100) ?? 0) + 1)
      const target = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      const diff = d - target
      if (Math.abs(diff) <= 0.02)
        return { recommended: true, reason: `Same size as the ${mm(target)} holes.`, score: 3 }
      if (diff > 0 && diff <= 0.15)
        return {
          recommended: true,
          reason: `${mm(diff)} larger than the ${mm(target)} holes: fine, leaves room for plating or a pin.`,
          score: 2 - diff
        }
      return {
        recommended: false,
        reason:
          diff > 0
            ? `Makes ${mm(d)} holes; the holes are ${mm(target)} (too big).`
            : `Makes ${mm(d)} holes; the holes are ${mm(target)} (too small).`,
        score: -Math.abs(diff)
      }
    }
    case 'holeMill': {
      if (!sizes.length) return { ...base, score: 0 }
      const smallest = Math.min(...sizes)
      if (d >= smallest - 0.1)
        return {
          recommended: false,
          reason: `Too wide for the smallest ${mm(smallest)} hole of this step.`,
          score: -1
        }
      if (ctx.thickness && len && len < ctx.thickness)
        return {
          recommended: false,
          reason: `Cutting length ${mm(len)} is shorter than the ${mm(ctx.thickness)} board.`,
          score: -0.5
        }
      if (d < Math.max(0.8, smallest * 0.35))
        return {
          recommended: false,
          reason: `Much smaller than the ${mm(smallest)} holes: works, but slow and breaks more easily.`,
          score: 0
        }
      return {
        recommended: true,
        reason: `Fits the smallest ${mm(smallest)} hole with room to move around.`,
        score: d
      }
    }
    case 'cutout': {
      if (ctx.thickness && len && len < ctx.thickness)
        return {
          recommended: false,
          reason: `Cutting length ${mm(len)} is shorter than the ${mm(ctx.thickness)} board: it cannot cut through.`,
          score: -1
        }
      // a 1.5-2 mm corn bit is the sturdy classic
      return { ...base, score: base.recommended ? 2 - Math.abs(d - 1.8) : 0 }
    }
    case 'alignment': {
      if (!ctx.pinDiameter) return { ...base, score: 0 }
      const pin = ctx.pinDiameter
      if (tool.type === 'drill') {
        const diff = d - pin
        if (Math.abs(diff) <= 0.05)
          return { recommended: true, reason: `Same size as the ${mm(pin)} pins: snug fit.`, score: 3 }
        return {
          recommended: false,
          reason:
            diff > 0
              ? `Larger than the ${mm(pin)} pins: the board would wobble.`
              : `Smaller than the ${mm(pin)} pins: they would not fit.`,
          score: -Math.abs(diff)
        }
      }
      return d < pin - 0.2
        ? { recommended: base.recommended, reason: `Mills the ${mm(pin)} pin hole in a circle.`, score: 1 }
        : { recommended: false, reason: `Not smaller than the ${mm(pin)} pins.`, score: -1 }
    }
    case 'clear':
      // wider = faster, but a very wide bit leaves copper between close traces
      return { ...base, score: base.recommended ? -Math.abs(d - 1) : 0 }
    default:
      return { ...base, score: 0 }
  }
}

/**
 * Tools usable for this step (allowed types only), recommended first, then by diameter. With a
 * context the recommendation uses the step's real numbers and one tool is marked `best`
 * (your own tools before the starter kit).
 */
export function toolsForStep(kind: StepKind, tools: Tool[], ctx: ToolPickContext = {}): ToolChoice[] {
  const allowed = STEP_KIND_INFO[kind].allowedToolTypes
  const rated = tools
    .filter((t) => allowed.includes(t.type))
    .map((tool) => ({ tool, ...refine(kind, tool, recommendation(kind, tool), ctx) }))
  const rec = rated.filter((r) => r.recommended)
  const own = rec.filter((r) => !r.tool.builtIn)
  const pool = own.length ? own : rec
  const best = pool.reduce<(typeof rated)[number] | null>((b, r) => (!b || r.score > b.score ? r : b), null)
  return rated
    .map(({ score: _score, ...r }): ToolChoice => (r.tool === best?.tool ? { ...r, best: true } : r))
    .sort(
      (a, b) =>
        Number(!!b.best) - Number(!!a.best) ||
        Number(b.recommended) - Number(a.recommended) ||
        a.tool.geometry.diameter - b.tool.geometry.diameter
    )
}

// ─────────────────────────────────────────────────────────────── Validation

const LEVEL_RANK: Record<ValidationLevel, number> = { ok: 0, warning: 1, error: 2 }

export function worstLevel(issues: ValidationIssue[]): ValidationLevel {
  return issues.reduce<ValidationLevel>(
    (lvl, i) => (LEVEL_RANK[i.level] > LEVEL_RANK[lvl] ? i.level : lvl),
    'ok'
  )
}

export interface StepValidationContext {
  layers: ImportedLayer[]
  tools: Tool[]
  material: Material
  machine: MachineProfile
}

const fmt = (v: number): string => String(Math.round(v * 1000) / 1000)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Diameters of drill holes (and slots if included) on the given layers within the step's range. */
function holeDiameters(layers: ImportedLayer[], min: number, max: number, includeSlots: boolean): number[] {
  const out: number[] = []
  for (const l of layers) {
    const d = l.parsed?.drills
    if (!d) continue
    const hs: { diameter: number }[] = includeSlots ? [...d.holes, ...d.slots] : d.holes
    for (const h of hs) if (h.diameter >= min - 1e-9 && h.diameter <= max + 1e-9) out.push(h.diameter)
  }
  return out
}

/** Validates a step against the project context. Issues are grouped by dialog section. */
export function validateStep(step: CamStep, ctx: StepValidationContext): StepValidation {
  const issues: ValidationIssue[] = []
  const add = (section: ValidationIssue['section'], level: ValidationLevel, message: string): void => {
    issues.push({ section, level, message })
  }
  const info = STEP_KIND_INFO[step.kind]
  const { material, machine } = ctx
  const p = step.params

  // ── Layers
  const selected: ImportedLayer[] = []
  if (info.allowedLayerTypes.length > 0) {
    if (step.layerIds.length === 0)
      add('layer', 'error', 'No layer selected. Choose which layer this step works on.')
    for (const id of step.layerIds) {
      const layer = ctx.layers.find((l) => l.id === id)
      if (!layer) {
        add(
          'layer',
          'error',
          'A selected layer no longer exists (it may have been removed). Please pick the layer again.'
        )
        continue
      }
      selected.push(layer)
      if (!info.allowedLayerTypes.includes(layer.type)) {
        add(
          'layer',
          'error',
          `"${layer.fileName}" is a ${layer.type} layer, but "${info.label}" needs a ${info.allowedLayerTypes.join(' or ')} layer.`
        )
      } else if (
        layer.type === 'copper' &&
        (layer.side === 'top' || layer.side === 'bottom') &&
        layer.side !== step.side
      ) {
        add(
          'layer',
          'warning',
          `"${layer.fileName}" is the ${layer.side} copper, but this step mills the ${step.side} side. Check the side setting.`
        )
      }
    }
  }

  // ── Tool
  let tool: Tool | undefined
  if (step.toolId === null) {
    add('tool', 'error', `No tool selected. Choose a ${typeList(info.allowedToolTypes)}.`)
  } else {
    tool = ctx.tools.find((t) => t.id === step.toolId)
    if (!tool)
      add(
        'tool',
        'error',
        'The selected tool no longer exists in the tool library. Please pick another tool.'
      )
  }
  if (tool) {
    const allowed = isToolAllowed(step.kind, tool)
    if (!allowed.ok) add('tool', 'error', allowed.message)
    for (const e of validateTool(tool)) add('tool', 'error', `Tool "${tool.name}": ${e}`)
    const f = tool.feeds
    if (finite(f.spindleRpm) && machine.spindleSpeedControl) {
      if (f.spindleRpm > machine.spindleMax)
        add(
          'tool',
          'warning',
          `The tool wants ${fmt(f.spindleRpm)} RPM but the spindle only reaches ${fmt(machine.spindleMax)} RPM. Lower the feed rate to compensate.`
        )
      else if (f.spindleRpm < machine.spindleMin)
        add(
          'tool',
          'warning',
          `The tool wants ${fmt(f.spindleRpm)} RPM but the spindle's minimum is ${fmt(machine.spindleMin)} RPM.`
        )
    }
    if (finite(f.feedXY) && f.feedXY > machine.maxFeedXY)
      add(
        'tool',
        'warning',
        `Cutting feed ${fmt(f.feedXY)} mm/min is above the machine maximum (${fmt(machine.maxFeedXY)}); it will be capped.`
      )
    if (finite(f.feedZ) && f.feedZ > machine.maxFeedZ)
      add(
        'tool',
        'warning',
        `Plunge rate ${fmt(f.feedZ)} mm/min is above the machine maximum (${fmt(machine.maxFeedZ)}); it will be capped.`
      )

    if (allowed.ok) validateToolSize(step, tool, selected, material, add)
  }

  // ── General
  const depth = step.cutDepth
  if (!finite(depth) || depth <= 0) {
    add(
      'general',
      'error',
      'Cut depth must be greater than 0 mm (it is measured downward from the copper surface).'
    )
  } else {
    const cu = material.copperThickness
    const t = material.thickness
    if (step.kind === 'isolate' || step.kind === 'clear') {
      if (depth > 3 * cu)
        add(
          'general',
          'warning',
          `You are cutting ${fmt(depth)} mm deep but the copper is only ${fmt(cu)} mm thick. Deeper cuts make wider grooves with a V-bit and wear the tool; about ${fmt(defaultCopperDepth(cu))} mm is usually enough.`
        )
      else if (depth < cu)
        add(
          'general',
          'warning',
          `Cut depth ${fmt(depth)} mm is less than the copper thickness (${fmt(cu)} mm); traces may stay connected.`
        )
    }
    if (step.kind === 'cutout' && depth < t)
      add(
        'general',
        'error',
        `Cut depth ${fmt(depth)} mm is less than the board thickness (${fmt(t)} mm): the board would not be cut free.`
      )
    if ((step.kind === 'drill' || step.kind === 'holeMill' || step.kind === 'alignment') && depth < t)
      add(
        'general',
        'error',
        `Depth ${fmt(depth)} mm is less than the board thickness (${fmt(t)} mm): holes would not go through.`
      )
    if (step.kind !== 'alignment' && depth > t + 1.5)
      add(
        'general',
        'warning',
        `Cutting ${fmt(depth - t)} mm into the spoilboard below the board is more than needed.`
      )
    if (tool && finite(tool.geometry.fluteLength) && depth > tool.geometry.fluteLength)
      add(
        'general',
        'error',
        `Cut depth ${fmt(depth)} mm is deeper than the tool's cutting length (${fmt(tool.geometry.fluteLength)} mm). The bit would rub and break.`
      )
    if (depth > machine.workArea.z) add('general', 'error', 'Cut depth is larger than the machine Z travel.')
  }
  if (step.safeZ !== null) {
    if (!finite(step.safeZ) || step.safeZ <= 0)
      add(
        'general',
        'error',
        'Safe Z must be above the copper surface (greater than 0), or the bit will drag across the board.'
      )
    else if (step.safeZ > machine.workArea.z)
      add('general', 'error', 'Safe Z is higher than the machine can lift.')
  }
  if (step.side === 'bottom' && !material.doubleSided)
    add(
      'general',
      'warning',
      'This step mills the bottom side, but the material is set to single-sided. Turn on "double-sided" in the material settings if you plan to flip the board.'
    )

  // ── Params
  switch (step.kind) {
    case 'isolate': {
      const ip = p.isolation
      if (!finite(ip.passes) || !Number.isInteger(ip.passes) || ip.passes < 1)
        add('params', 'error', 'Number of passes must be a whole number of at least 1.')
      else if (ip.passes > 10)
        add(
          'params',
          'warning',
          'More than 10 isolation passes takes very long; consider a "Clear copper" step instead.'
        )
      if (!finite(ip.overlap) || ip.overlap < 0 || ip.overlap > 0.9)
        add('params', 'error', 'Overlap must be between 0 and 0.9 (0% to 90%).')
      if (!finite(ip.extraClearance) || ip.extraClearance < 0)
        add('params', 'error', 'Extra clearance cannot be negative.')
      break
    }
    case 'clear': {
      const cp = p.clear
      if (!finite(cp.overlap) || cp.overlap < 0 || cp.overlap > 0.9)
        add('params', 'error', 'Overlap must be between 0 and 0.9 (0% to 90%).')
      if (!finite(cp.minIslandArea) || cp.minIslandArea < 0)
        add('params', 'error', 'Minimum island area cannot be negative.')
      if (!finite(cp.clearMargin) || cp.clearMargin < 0)
        add('params', 'error', 'Clearing margin cannot be negative (0 = clear everything).')
      break
    }
    case 'cutout': {
      const c = p.cutout
      if (!finite(c.tabs) || !Number.isInteger(c.tabs) || c.tabs < 0)
        add('params', 'error', 'Number of tabs must be a whole number (0 or more).')
      else if (c.tabs === 0)
        add(
          'params',
          'warning',
          'Without tabs the board can break loose at the end of the cut and get damaged by the spinning bit.'
        )
      else {
        if (!finite(c.tabWidth) || c.tabWidth <= 0)
          add('params', 'error', 'Tab width must be greater than 0 mm.')
        if (!finite(c.tabHeight) || c.tabHeight <= 0)
          add('params', 'error', 'Tab height must be greater than 0 mm.')
        else if (c.tabHeight >= material.thickness)
          add(
            'params',
            'warning',
            'Tab height is at least the board thickness, so the tabs would never be cut: the board is not cut free.'
          )
        if (tool && finite(c.tabWidth) && c.tabWidth > 0 && c.tabWidth < tool.geometry.diameter)
          add(
            'params',
            'warning',
            'Tabs narrower than the tool diameter are very weak and may break during cutting.'
          )
      }
      break
    }
    case 'drill': {
      const d = p.drill
      if (!finite(d.peck) || d.peck < 0)
        add('params', 'error', 'Peck depth cannot be negative (0 = drill in one go).')
      if (!finite(d.retract) || d.retract <= 0)
        add('params', 'error', 'Retract height must be above the surface (greater than 0).')
      if (!finite(d.minDiameter) || d.minDiameter < 0)
        add('params', 'error', 'Minimum hole size cannot be negative.')
      if (!finite(d.maxDiameter) || d.maxDiameter < d.minDiameter)
        add('params', 'error', 'Maximum hole size must be at least the minimum hole size.')
      break
    }
    case 'holeMill': {
      const h = p.holeMill
      if (!finite(h.minDiameter) || h.minDiameter < 0)
        add('params', 'error', 'Minimum hole size cannot be negative.')
      if (!finite(h.maxDiameter) || h.maxDiameter < h.minDiameter)
        add('params', 'error', 'Maximum hole size must be at least the minimum hole size.')
      break
    }
    case 'alignment': {
      if (!material.doubleSided || !material.alignment.enabled)
        add(
          'params',
          'warning',
          'Alignment pins are turned off in the material settings, so no pin holes will be made.'
        )
      break
    }
  }

  return { stepId: step.id, level: worstLevel(issues), issues }
}

function validateToolSize(
  step: CamStep,
  tool: Tool,
  layers: ImportedLayer[],
  material: Material,
  add: (section: ValidationIssue['section'], level: ValidationLevel, message: string) => void
): void {
  const d = tool.geometry.diameter
  if (!finite(d) || d <= 0) return
  if (step.kind === 'drill') {
    const dp = step.params.drill
    const holes = holeDiameters(layers, dp.minDiameter, dp.maxDiameter, dp.includeSlots)
    if (holes.length === 0) {
      if (layers.some((l) => l.parsed?.drills))
        add(
          'layer',
          'warning',
          "No holes on the selected layers fall inside this step's hole-size range; nothing will be drilled."
        )
      return
    }
    const smallest = Math.min(...holes)
    const largest = Math.max(...holes)
    if (d > smallest + 0.15)
      add(
        'tool',
        'warning',
        `The ${fmt(d)} mm drill is bigger than the smallest hole (${fmt(smallest)} mm); those holes will be enlarged and pads may be drilled away.`
      )
    if (d < largest - 0.2)
      add(
        'tool',
        'warning',
        `The ${fmt(d)} mm drill is much smaller than the largest hole (${fmt(largest)} mm); those holes will be too small. Use a bigger drill or a "Mill big holes" step.`
      )
  } else if (step.kind === 'holeMill') {
    const hp = step.params.holeMill
    const holes = holeDiameters(layers, hp.minDiameter, hp.maxDiameter, true)
    if (holes.length === 0) {
      if (layers.some((l) => l.parsed?.drills))
        add(
          'layer',
          'warning',
          "No holes on the selected layers fall inside this step's hole-size range; nothing will be milled."
        )
      return
    }
    const smallest = Math.min(...holes)
    if (d >= smallest)
      add(
        'tool',
        'error',
        `The ${fmt(d)} mm tool is too big for the smallest hole in range (${fmt(smallest)} mm). Use a smaller tool or raise the minimum hole size.`
      )
  } else if (step.kind === 'alignment' && material.alignment.enabled) {
    const pin = material.alignment.pinDiameter
    if (tool.type === 'drill' && Math.abs(d - pin) > 0.05)
      add(
        'tool',
        'warning',
        `The ${fmt(d)} mm drill does not match the ${fmt(pin)} mm alignment pins; pins will be ${d > pin ? 'loose' : 'too tight'}.`
      )
    if (tool.type !== 'drill' && d >= pin)
      add(
        'tool',
        'error',
        `The ${fmt(d)} mm tool must be smaller than the ${fmt(pin)} mm pin hole it has to mill.`
      )
  }
}

/** Merges toolpath generation warnings (e.g. "some areas could not be reached") into a validation result. */
export function combineValidation(
  stepValidation: StepValidation,
  toolpathWarnings: string[]
): StepValidation {
  const issues: ValidationIssue[] = [
    ...stepValidation.issues,
    ...toolpathWarnings.map((message): ValidationIssue => ({ level: 'warning', section: 'results', message }))
  ]
  return { stepId: stepValidation.stepId, level: worstLevel(issues), issues }
}
