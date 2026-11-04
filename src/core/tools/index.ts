/**
 * Tool library: starter kit, plain-language descriptions, creation and validation.
 *
 * All lengths mm, feeds mm/min, spindle speed RPM. Feeds & speeds in the starter kit are deliberately
 * conservative for FR4/FR1 copper-clad board on hobby machines (3018-class up to small routers).
 */
import type { FeedsSpeeds, Tool, ToolGeometry, ToolType } from '../model/types'

export { effectiveCutWidth, toolRadiusAtHeight } from './geometry'

// ─────────────────────────────────────────────────────────────── Tool type info

export interface ToolTypeInfo {
  label: string
  description: string
  usedFor: string
}

export const TOOL_TYPE_INFO: Record<ToolType, ToolTypeInfo> = {
  vbit: {
    label: 'V-bit (engraving bit)',
    description:
      'A pointed bit shaped like a cone. The deeper it goes, the wider it cuts, so a very shallow cut makes a very thin line.',
    usedFor:
      'Isolating traces: carving thin grooves through the copper around each track and pad. The usual first choice for PCB milling.'
  },
  flat: {
    label: 'Flat end mill',
    description:
      'A cylindrical cutter with a flat bottom. It cuts the same width at any depth and leaves a flat floor.',
    usedFor:
      'Clearing larger copper areas, milling holes that are too big for your drills, cutting out the board and isolating traces when you have no V-bit.'
  },
  ball: {
    label: 'Ball end mill',
    description:
      'A cutter with a rounded (half-sphere) tip. Like a V-bit, it cuts narrower when it only goes a little way into the material.',
    usedFor: 'Occasionally used for isolating traces or clearing copper. Rarely the best choice for PCBs.'
  },
  drill: {
    label: 'Drill bit',
    description:
      'A bit made to plunge straight down. It can only make round holes of its own size and must not be moved sideways while cutting.',
    usedFor: 'Drilling component holes, vias and alignment pin holes.'
  },
  corn: {
    label: 'Corn / PCB router bit',
    description:
      'A cutter covered in small diamond-shaped teeth (it looks like a corn cob). Very sturdy and good at cutting fibreglass without clogging.',
    usedFor: 'Cutting the finished board out of the larger copper sheet, and milling big holes or slots.'
  }
}

// ─────────────────────────────────────────────────────────────── Field help

export type ToolFieldKey =
  | 'name'
  | 'type'
  | 'number'
  | 'notes'
  | 'geometry.diameter'
  | 'geometry.tipAngle'
  | 'geometry.tipDiameter'
  | 'geometry.fluteLength'
  | 'geometry.flutes'
  | 'geometry.pointAngle'
  | 'feeds.spindleRpm'
  | 'feeds.feedXY'
  | 'feeds.feedZ'
  | 'feeds.stepDown'
  | 'feeds.stepOver'

export interface FieldHelp {
  label: string
  description: string
  unit?: string
}

export const TOOL_FIELD_HELP: Record<ToolFieldKey, FieldHelp> = {
  name: {
    label: 'Name',
    description: 'A name you will recognise when picking this tool, e.g. "V-bit 30° 0.1 mm".'
  },
  type: {
    label: 'Tool type',
    description:
      'What kind of cutter this is. TraceMill uses it to decide which jobs the tool is suitable for and how wide it cuts.'
  },
  number: {
    label: 'Tool number',
    description:
      'The number written into the G-code when this tool is needed (T1, T2…). On machines without a tool changer it is only shown in the "insert tool" message.'
  },
  notes: {
    label: 'Notes',
    description:
      'Anything you want to remember about this tool: where you bought it, how worn it is, what worked well.'
  },
  'geometry.diameter': {
    label: 'Diameter',
    description:
      'The width of the cutter. For end mills, drills and corn bits this is the cutting width. For V-bits it is the width of the shank (the round part that goes into the spindle).',
    unit: 'mm'
  },
  'geometry.tipAngle': {
    label: 'Tip angle',
    description:
      'For V-bits: the angle of the point, measured across the whole tip. Smaller angles (10–30°) make narrower grooves and are better for fine traces; larger angles are sturdier but cut wider as they go deeper.',
    unit: '°'
  },
  'geometry.tipDiameter': {
    label: 'Tip width',
    description:
      'For V-bits: the width of the tiny flat at the very end of the point (usually printed on the package, e.g. 0.1 mm). This is the narrowest line the bit can cut.',
    unit: 'mm'
  },
  'geometry.fluteLength': {
    label: 'Cutting length',
    description:
      'How much of the bit, measured from the tip, actually has cutting edges. TraceMill will not let a step cut deeper than this, because the smooth part above would rub and burn.',
    unit: 'mm'
  },
  'geometry.flutes': {
    label: 'Flutes',
    description:
      'The number of cutting edges (spiral grooves). More flutes cut more smoothly but clear chips more slowly. It is mainly informational.'
  },
  'geometry.pointAngle': {
    label: 'Point angle',
    description: 'For drill bits: the angle of the drill point. Most PCB drills are 118° or 130°.',
    unit: '°'
  },
  'feeds.spindleRpm': {
    label: 'Spindle speed',
    description:
      'How fast the bit spins, in revolutions per minute. Small PCB bits need high speeds: spinning too slowly for the feed rate makes each tooth take a big bite, which breaks tiny bits.',
    unit: 'RPM'
  },
  'feeds.feedXY': {
    label: 'Cutting feed',
    description:
      'How fast the machine moves sideways while the bit is cutting. Too fast breaks bits and leaves ragged edges; too slow wastes time and can melt or burn the board. Start slow and increase carefully.',
    unit: 'mm/min'
  },
  'feeds.feedZ': {
    label: 'Plunge rate',
    description:
      'How fast the bit moves down into the material. Plunging is harder on a bit than cutting sideways, so this is usually much slower than the cutting feed.',
    unit: 'mm/min'
  },
  'feeds.stepDown': {
    label: 'Depth per pass',
    description:
      'The deepest the bit cuts in one go. Deeper cuts (like cutting the board out) are split into several passes of this depth so the bit is not overloaded. For drills this is the peck depth.',
    unit: 'mm'
  },
  'feeds.stepOver': {
    label: 'Stepover',
    description:
      'When the bit makes several side-by-side passes, how far it moves over each time, as a fraction of its cutting width. 0.4 means each new pass moves 40% of the cut width, so passes overlap by 60%.'
  }
}

// ─────────────────────────────────────────────────────────────── Starter kit

/** Formats a size for ids: 1 → "1.0", 0.1 → "0.1", 3.175 → "3.175". */
function sizeId(d: number): string {
  return Number.isInteger(d) ? d.toFixed(1) : String(d)
}

/** Cutting length of a V-bit cone: height at which the cone reaches the shank diameter. */
function vbitConeLength(shank: number, tip: number, angle: number): number {
  const h = (shank - tip) / 2 / Math.tan((angle * Math.PI) / 360)
  return Math.round(h * 100) / 100
}

const VBIT_SHANK = 3.175

interface VbitSpec {
  angle: number
  tip: number
  feed: number
  plunge: number
}
const VBITS: VbitSpec[] = [
  { angle: 10, tip: 0.1, feed: 120, plunge: 50 },
  { angle: 20, tip: 0.1, feed: 150, plunge: 60 },
  { angle: 30, tip: 0.1, feed: 200, plunge: 80 },
  { angle: 30, tip: 0.2, feed: 250, plunge: 80 },
  { angle: 60, tip: 0.1, feed: 250, plunge: 80 },
  { angle: 90, tip: 0.2, feed: 300, plunge: 100 }
]

interface MillSpec {
  d: number
  flute: number
  feed: number
  plunge: number
  stepDown: number
  rpm: number
}
const FLATS: MillSpec[] = [
  { d: 0.4, flute: 1.2, feed: 100, plunge: 30, stepDown: 0.1, rpm: 12000 },
  { d: 0.6, flute: 2, feed: 150, plunge: 40, stepDown: 0.15, rpm: 12000 },
  { d: 0.8, flute: 3, feed: 200, plunge: 50, stepDown: 0.2, rpm: 12000 },
  { d: 1.0, flute: 4, feed: 250, plunge: 60, stepDown: 0.3, rpm: 12000 },
  { d: 1.5, flute: 6, feed: 300, plunge: 80, stepDown: 0.4, rpm: 12000 },
  { d: 2.0, flute: 8, feed: 350, plunge: 100, stepDown: 0.5, rpm: 12000 },
  { d: 3.175, flute: 12, feed: 400, plunge: 100, stepDown: 0.6, rpm: 10000 }
]
const BALLS: MillSpec[] = [
  { d: 1.0, flute: 4, feed: 200, plunge: 50, stepDown: 0.2, rpm: 12000 },
  { d: 2.0, flute: 8, feed: 300, plunge: 80, stepDown: 0.4, rpm: 12000 }
]
const CORNS: MillSpec[] = [
  { d: 0.8, flute: 4, feed: 150, plunge: 40, stepDown: 0.3, rpm: 12000 },
  { d: 1.0, flute: 4.5, feed: 200, plunge: 50, stepDown: 0.4, rpm: 12000 },
  { d: 1.5, flute: 6, feed: 300, plunge: 60, stepDown: 0.5, rpm: 12000 },
  { d: 2.0, flute: 8, feed: 400, plunge: 80, stepDown: 0.6, rpm: 12000 },
  { d: 3.175, flute: 12, feed: 500, plunge: 100, stepDown: 0.8, rpm: 10000 }
]
const DRILL_SIZES = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.5, 2.0, 3.0]

function drillFluteLength(d: number): number {
  if (d <= 0.8) return 7
  if (d <= 1.2) return 9
  if (d <= 2.0) return 10
  return 12
}

function drillPlunge(d: number): number {
  if (d <= 0.5) return 40 // tiny carbide drills snap easily: plunge gently
  if (d <= 0.8) return 60
  if (d <= 1.2) return 80
  return 100
}

function buildStarterTools(): Tool[] {
  const tools: Tool[] = []
  let n = 1
  for (const v of VBITS) {
    tools.push({
      id: `starter-vbit-${v.angle}-${sizeId(v.tip)}`,
      name: `V-bit ${v.angle}° ${sizeId(v.tip)} mm`,
      type: 'vbit',
      geometry: {
        diameter: VBIT_SHANK,
        tipAngle: v.angle,
        tipDiameter: v.tip,
        fluteLength: vbitConeLength(VBIT_SHANK, v.tip, v.angle),
        flutes: 1
      },
      feeds: { spindleRpm: 12000, feedXY: v.feed, feedZ: v.plunge, stepDown: 0.1, stepOver: 0.4 },
      notes: 'Starter kit. 1/8" shank engraving bit. Keep isolation depth shallow (about 0.1 mm).',
      builtIn: true,
      number: n++
    })
  }
  for (const f of FLATS) {
    tools.push({
      id: `starter-flat-${sizeId(f.d)}`,
      name: `Flat end mill ${sizeId(f.d)} mm`,
      type: 'flat',
      geometry: { diameter: f.d, fluteLength: f.flute, flutes: 2 },
      feeds: { spindleRpm: f.rpm, feedXY: f.feed, feedZ: f.plunge, stepDown: f.stepDown, stepOver: 0.4 },
      notes: 'Starter kit. 2-flute carbide end mill.',
      builtIn: true,
      number: n++
    })
  }
  for (const b of BALLS) {
    tools.push({
      id: `starter-ball-${sizeId(b.d)}`,
      name: `Ball end mill ${sizeId(b.d)} mm`,
      type: 'ball',
      geometry: { diameter: b.d, fluteLength: b.flute, flutes: 2 },
      feeds: { spindleRpm: b.rpm, feedXY: b.feed, feedZ: b.plunge, stepDown: b.stepDown, stepOver: 0.3 },
      notes: 'Starter kit. 2-flute carbide ball nose end mill.',
      builtIn: true,
      number: n++
    })
  }
  for (const d of DRILL_SIZES) {
    tools.push({
      id: `starter-drill-${sizeId(d)}`,
      name: `Drill ${sizeId(d)} mm`,
      type: 'drill',
      geometry: { diameter: d, fluteLength: drillFluteLength(d), flutes: 2, pointAngle: 130 },
      feeds: { spindleRpm: 12000, feedXY: 300, feedZ: drillPlunge(d), stepDown: 2, stepOver: 0.5 },
      notes:
        'Starter kit. Carbide PCB drill with 1/8" shank. Brittle: never move it sideways while it is in the board.',
      builtIn: true,
      number: n++
    })
  }
  for (const c of CORNS) {
    tools.push({
      id: `starter-corn-${sizeId(c.d)}`,
      name: `Corn router bit ${sizeId(c.d)} mm`,
      type: 'corn',
      geometry: { diameter: c.d, fluteLength: c.flute, flutes: 8 },
      feeds: { spindleRpm: c.rpm, feedXY: c.feed, feedZ: c.plunge, stepDown: c.stepDown, stepOver: 0.4 },
      notes: 'Starter kit. Carbide PCB router ("corn") bit for cutting FR4.',
      builtIn: true,
      number: n++
    })
  }
  return tools
}

export const STARTER_TOOLS: Tool[] = buildStarterTools()

// ─────────────────────────────────────────────────────────────── Create / duplicate

const DEFAULT_GEOMETRY: Record<ToolType, ToolGeometry> = {
  vbit: {
    diameter: VBIT_SHANK,
    tipAngle: 30,
    tipDiameter: 0.1,
    fluteLength: vbitConeLength(VBIT_SHANK, 0.1, 30),
    flutes: 1
  },
  flat: { diameter: 1.0, fluteLength: 4, flutes: 2 },
  ball: { diameter: 1.0, fluteLength: 4, flutes: 2 },
  drill: { diameter: 1.0, fluteLength: 9, flutes: 2, pointAngle: 130 },
  corn: { diameter: 1.5, fluteLength: 6, flutes: 8 }
}

const DEFAULT_FEEDS: Record<ToolType, FeedsSpeeds> = {
  vbit: { spindleRpm: 12000, feedXY: 200, feedZ: 80, stepDown: 0.1, stepOver: 0.4 },
  flat: { spindleRpm: 12000, feedXY: 250, feedZ: 60, stepDown: 0.3, stepOver: 0.4 },
  ball: { spindleRpm: 12000, feedXY: 200, feedZ: 50, stepDown: 0.2, stepOver: 0.3 },
  drill: { spindleRpm: 12000, feedXY: 300, feedZ: 80, stepDown: 2, stepOver: 0.5 },
  corn: { spindleRpm: 12000, feedXY: 300, feedZ: 60, stepDown: 0.5, stepOver: 0.4 }
}

let idCounter = 0
function newToolId(): string {
  idCounter += 1
  return `tool-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** Creates a new (user, not built-in) tool of the given type with sensible defaults. */
export function createTool(type: ToolType, overrides: Partial<Tool> = {}): Tool {
  const geometry: ToolGeometry = { ...DEFAULT_GEOMETRY[type], ...(overrides.geometry ?? {}) }
  const feeds: FeedsSpeeds = { ...DEFAULT_FEEDS[type], ...(overrides.feeds ?? {}) }
  return {
    id: overrides.id ?? newToolId(),
    name: overrides.name ?? `${TOOL_TYPE_INFO[type].label} ${geometry.diameter} mm`,
    type,
    geometry,
    feeds,
    notes: overrides.notes ?? '',
    builtIn: overrides.builtIn ?? false,
    number: overrides.number ?? 1
  }
}

/** Deep copy of a tool as an editable user tool. */
export function duplicateTool(t: Tool, newId: string): Tool {
  return {
    ...t,
    id: newId,
    name: `${t.name} (copy)`,
    geometry: { ...t.geometry },
    feeds: { ...t.feeds },
    builtIn: false
  }
}

// ─────────────────────────────────────────────────────────────── Validation

const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** Returns a list of human-readable errors; empty list = valid. */
export function validateTool(t: Tool): string[] {
  const errors: string[] = []
  const g = t.geometry
  const f = t.feeds
  if (!t.name || !t.name.trim()) errors.push('The tool needs a name.')
  if (!(t.type in TOOL_TYPE_INFO)) errors.push(`Unknown tool type "${String(t.type)}".`)
  if (!finite(t.number) || !Number.isInteger(t.number) || t.number < 0)
    errors.push('Tool number must be a whole number of 0 or more.')

  if (!finite(g.diameter) || g.diameter <= 0) errors.push('Diameter must be greater than 0 mm.')
  else if (g.diameter > 50) errors.push('Diameter is unrealistically large (over 50 mm).')
  if (!finite(g.fluteLength) || g.fluteLength <= 0) errors.push('Cutting length must be greater than 0 mm.')
  if (!finite(g.flutes) || !Number.isInteger(g.flutes) || g.flutes < 1)
    errors.push('Number of flutes must be a whole number of at least 1.')

  if (t.type === 'vbit') {
    if (!finite(g.tipAngle) || g.tipAngle < 5 || g.tipAngle > 170)
      errors.push('V-bit tip angle must be between 5° and 170°.')
    if (g.tipDiameter !== undefined) {
      if (!finite(g.tipDiameter) || g.tipDiameter < 0) errors.push('V-bit tip width cannot be negative.')
      else if (finite(g.diameter) && g.tipDiameter >= g.diameter)
        errors.push('V-bit tip width must be smaller than the shank diameter.')
    }
  }
  if (t.type === 'drill' && g.pointAngle !== undefined) {
    if (!finite(g.pointAngle) || g.pointAngle < 60 || g.pointAngle > 180)
      errors.push('Drill point angle must be between 60° and 180°.')
  }

  if (!finite(f.spindleRpm) || f.spindleRpm <= 0) errors.push('Spindle speed must be greater than 0 RPM.')
  if (!finite(f.feedXY) || f.feedXY <= 0) errors.push('Cutting feed must be greater than 0 mm/min.')
  if (!finite(f.feedZ) || f.feedZ <= 0) errors.push('Plunge rate must be greater than 0 mm/min.')
  if (!finite(f.stepDown) || f.stepDown <= 0) errors.push('Depth per pass must be greater than 0 mm.')
  if (!finite(f.stepOver) || f.stepOver <= 0 || f.stepOver > 1)
    errors.push('Stepover must be more than 0 and at most 1 (100% of the cutting width).')
  return errors
}
