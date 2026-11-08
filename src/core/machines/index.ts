/**
 * Machine presets and helpers.
 *
 * Values are deliberately conservative: max feeds are what a stock machine handles reliably, not its
 * absolute rated maximum. Heights are relative to work Z0 = top copper surface.
 * Z heights: `travelZ` is the low hop between nearby cuts, `safeZ` the clearance for long rapids /
 * start / end of a job, `toolChangeZ` the height the spindle rises to for a (manual) tool change.
 */
import type { MachineProfile } from '../model/types'

export const MACHINE_PRESETS: MachineProfile[] = [
  {
    id: 'preset-mach3-router',
    name: 'Generic Mach3 router',
    description:
      'A typical hobby CNC router controlled by Mach3 (parallel port or motion controller). Outputs .tap files with drilling cycles and G31 probing.',
    builtIn: true,
    postProcessor: 'mach3',
    workArea: { x: 300, y: 200, z: 60 },
    maxFeedXY: 2000,
    maxFeedZ: 600,
    spindleMin: 3000,
    spindleMax: 24000,
    spindleSpinUpSec: 4,
    spindleSpeedControl: true,
    supportsToolChange: false,
    supportsArcs: true,
    supportsCannedCycles: true,
    supportsProbing: true,
    probeCommand: 'G31',
    outputUnits: 'mm',
    decimals: 4,
    safeZ: 2,
    travelZ: 1,
    toolChangeZ: 30,
    fileExtension: 'tap',
    lineNumbers: false,
    customHeader: '',
    customFooter: '',
    commentStyle: 'parens'
  },
  {
    id: 'preset-grbl-3018',
    name: 'Generic GRBL (3018-class)',
    description:
      'Small desktop machines like the many "3018" kits running GRBL 1.1 with a 775 DC spindle. Opens in Candle, UGS or bCNC.',
    builtIn: true,
    postProcessor: 'grbl',
    workArea: { x: 300, y: 180, z: 45 },
    maxFeedXY: 1000,
    maxFeedZ: 400,
    spindleMin: 1000,
    spindleMax: 10000,
    spindleSpinUpSec: 3,
    spindleSpeedControl: true,
    supportsToolChange: false,
    supportsArcs: true,
    supportsCannedCycles: false,
    supportsProbing: true,
    probeCommand: 'G38.2',
    outputUnits: 'mm',
    decimals: 3,
    safeZ: 2,
    travelZ: 1,
    toolChangeZ: 30,
    fileExtension: 'nc',
    lineNumbers: false,
    customHeader: '',
    customFooter: '',
    commentStyle: 'parens'
  },
  {
    id: 'preset-genmitsu-3018-prover',
    name: 'SainSmart Genmitsu 3018-PROVer',
    description:
      'SainSmart Genmitsu 3018-PROVer (GRBL 1.1, 775 spindle up to about 10,000 RPM, probe input). Use Candle or UGS to send the file.',
    builtIn: true,
    postProcessor: 'grbl',
    workArea: { x: 300, y: 180, z: 45 },
    maxFeedXY: 1500,
    maxFeedZ: 500,
    spindleMin: 1000,
    spindleMax: 10000,
    spindleSpinUpSec: 3,
    spindleSpeedControl: true,
    supportsToolChange: false,
    supportsArcs: true,
    supportsCannedCycles: false,
    supportsProbing: true,
    probeCommand: 'G38.2',
    outputUnits: 'mm',
    decimals: 3,
    safeZ: 2,
    travelZ: 1,
    toolChangeZ: 30,
    fileExtension: 'nc',
    lineNumbers: false,
    customHeader: '',
    customFooter: '',
    commentStyle: 'parens'
  },
  {
    id: 'preset-sienci-longmill-mk2',
    name: 'Sienci LongMill MK2',
    description:
      'Sienci LongMill MK2 (30×30) with GRBL and a trim router. Router speed is usually set by hand on its dial, so S-words have no effect.',
    builtIn: true,
    postProcessor: 'grbl',
    workArea: { x: 792, y: 845, z: 95 },
    maxFeedXY: 4000,
    maxFeedZ: 1500,
    spindleMin: 10000,
    spindleMax: 30000,
    spindleSpinUpSec: 5,
    spindleSpeedControl: false,
    supportsToolChange: false,
    supportsArcs: true,
    supportsCannedCycles: false,
    supportsProbing: true,
    probeCommand: 'G38.2',
    outputUnits: 'mm',
    decimals: 3,
    safeZ: 2,
    travelZ: 1,
    toolChangeZ: 40,
    fileExtension: 'gcode',
    lineNumbers: false,
    customHeader: '',
    customFooter: '',
    commentStyle: 'parens'
  },
  {
    id: 'preset-shapeoko-4',
    name: 'Shapeoko 4',
    description:
      'Carbide 3D Shapeoko 4 (standard size). Output is GRBL-style G-code that Carbide Motion and other GRBL senders accept. Router speed is set on its dial.',
    builtIn: true,
    postProcessor: 'grbl',
    workArea: { x: 444, y: 444, z: 95 },
    maxFeedXY: 5000,
    maxFeedZ: 1500,
    spindleMin: 10000,
    spindleMax: 30000,
    spindleSpinUpSec: 5,
    spindleSpeedControl: false,
    supportsToolChange: false,
    supportsArcs: true,
    supportsCannedCycles: false,
    supportsProbing: true,
    probeCommand: 'G38.2',
    outputUnits: 'mm',
    decimals: 3,
    safeZ: 2,
    travelZ: 1,
    toolChangeZ: 40,
    fileExtension: 'nc',
    lineNumbers: false,
    customHeader: '',
    customFooter: '',
    commentStyle: 'parens'
  },
  {
    id: 'preset-desktop-pcb-mill',
    name: 'Desktop PCB mill (Bantam/Othermill-style)',
    description:
      'Small enclosed desktop PCB mills with a fixed high-speed spindle and conductive probing. Uses plain, widely compatible G-code.',
    builtIn: true,
    postProcessor: 'generic',
    workArea: { x: 140, y: 114, z: 40 },
    maxFeedXY: 1500,
    maxFeedZ: 500,
    spindleMin: 26000,
    spindleMax: 26000,
    spindleSpinUpSec: 3,
    spindleSpeedControl: false,
    supportsToolChange: false,
    supportsArcs: true,
    supportsCannedCycles: false,
    supportsProbing: true,
    probeCommand: 'G38.2',
    outputUnits: 'mm',
    decimals: 4,
    safeZ: 2,
    travelZ: 1,
    toolChangeZ: 25,
    fileExtension: 'nc',
    lineNumbers: false,
    customHeader: '',
    customFooter: '',
    commentStyle: 'parens'
  },
  {
    id: 'preset-linuxcnc-router',
    name: 'LinuxCNC router',
    description:
      'A hobby router controlled by LinuxCNC. Uses .ngc files, drilling cycles and G38.2 probing; M6 shows the manual tool-change prompt.',
    builtIn: true,
    postProcessor: 'linuxcnc',
    workArea: { x: 600, y: 400, z: 100 },
    maxFeedXY: 3000,
    maxFeedZ: 1000,
    spindleMin: 3000,
    spindleMax: 24000,
    spindleSpinUpSec: 4,
    spindleSpeedControl: true,
    supportsToolChange: true,
    supportsArcs: true,
    supportsCannedCycles: true,
    supportsProbing: true,
    probeCommand: 'G38.2',
    outputUnits: 'mm',
    decimals: 4,
    safeZ: 2,
    travelZ: 1,
    toolChangeZ: 40,
    fileExtension: 'ngc',
    lineNumbers: false,
    customHeader: '',
    customFooter: '',
    commentStyle: 'parens'
  },
  {
    id: 'preset-desktop-atc',
    name: 'Desktop mill with tool changer (Carvera-style)',
    description:
      'Enclosed desktop machines with an automatic tool changer and probe, such as the Makera Carvera. M6 changes tools automatically.',
    builtIn: true,
    postProcessor: 'generic',
    workArea: { x: 360, y: 240, z: 140 },
    maxFeedXY: 3000,
    maxFeedZ: 1000,
    spindleMin: 2000,
    spindleMax: 15000,
    spindleSpinUpSec: 3,
    spindleSpeedControl: true,
    supportsToolChange: true,
    supportsArcs: true,
    supportsCannedCycles: false,
    supportsProbing: true,
    probeCommand: 'G38.2',
    outputUnits: 'mm',
    decimals: 4,
    safeZ: 2,
    travelZ: 1,
    toolChangeZ: 30,
    fileExtension: 'nc',
    lineNumbers: false,
    customHeader: '',
    customFooter: '',
    commentStyle: 'semicolon'
  },
  {
    id: 'preset-generic',
    name: 'Generic (configurable)',
    description:
      'Plain, safe G-code with no special features (no tool changer, no drilling cycles, no probing). A starting point for any machine.',
    builtIn: true,
    postProcessor: 'generic',
    workArea: { x: 300, y: 200, z: 50 },
    maxFeedXY: 1000,
    maxFeedZ: 300,
    spindleMin: 1000,
    spindleMax: 12000,
    spindleSpinUpSec: 5,
    spindleSpeedControl: true,
    supportsToolChange: false,
    supportsArcs: true,
    supportsCannedCycles: false,
    supportsProbing: false,
    probeCommand: 'G38.2',
    outputUnits: 'mm',
    decimals: 4,
    safeZ: 2,
    travelZ: 1,
    toolChangeZ: 30,
    fileExtension: 'nc',
    lineNumbers: false,
    customHeader: '',
    customFooter: '',
    commentStyle: 'parens'
  }
]

/** The preset used for new projects. */
export const DEFAULT_MACHINE_ID = 'preset-mach3-router'

let idCounter = 0

/** Creates an editable copy of `base` (or of the Generic preset). */
export function createCustomMachine(base?: MachineProfile): MachineProfile {
  const src = base ?? MACHINE_PRESETS.find((m) => m.id === 'preset-generic')!
  idCounter += 1
  return {
    ...src,
    workArea: { ...src.workArea },
    id: `machine-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: base ? `${src.name} (custom)` : 'My machine',
    builtIn: false
  }
}

/** Safe / travel Z of the built-in machines before D-030 (5 mm is far more than a flat PCB needs). */
const OLD_PRESET_HEIGHTS: [number, number][] = [
  [5, 2],
  [5, 1.5],
  [3, 1]
]

/**
 * A built-in machine still on the old 5 mm safe Z gets the current 2 mm / 1 mm (D-030); a machine
 * whose heights were changed is returned unchanged.
 */
export function refreshPresetHeights(m: MachineProfile): MachineProfile {
  if (!m.builtIn) return m
  if (!OLD_PRESET_HEIGHTS.some(([s, t]) => m.safeZ === s && m.travelZ === t)) return m
  return { ...m, safeZ: 2, travelZ: 1 }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Returns human-readable errors; empty = valid. */
export function validateMachine(m: MachineProfile): string[] {
  const e: string[] = []
  if (!m.name || !m.name.trim()) e.push('The machine needs a name.')
  for (const axis of ['x', 'y', 'z'] as const) {
    if (!finite(m.workArea[axis]) || m.workArea[axis] <= 0)
      e.push(`Work area ${axis.toUpperCase()} must be greater than 0 mm.`)
  }
  if (!finite(m.maxFeedXY) || m.maxFeedXY <= 0) e.push('Maximum XY feed must be greater than 0 mm/min.')
  if (!finite(m.maxFeedZ) || m.maxFeedZ <= 0) e.push('Maximum Z feed must be greater than 0 mm/min.')
  if (m.accel !== undefined && (!finite(m.accel) || m.accel <= 0))
    e.push('Acceleration must be greater than 0 mm/s².')
  if (!finite(m.spindleMin) || m.spindleMin < 0) e.push('Minimum spindle speed cannot be negative.')
  if (!finite(m.spindleMax) || m.spindleMax <= 0) e.push('Maximum spindle speed must be greater than 0 RPM.')
  if (finite(m.spindleMin) && finite(m.spindleMax) && m.spindleMin > m.spindleMax)
    e.push('Minimum spindle speed is higher than the maximum.')
  if (!finite(m.spindleSpinUpSec) || m.spindleSpinUpSec < 0) e.push('Spin-up wait cannot be negative.')
  else if (m.spindleSpinUpSec > 60) e.push('Spin-up wait over 60 seconds is unrealistic.')
  if (!finite(m.decimals) || !Number.isInteger(m.decimals) || m.decimals < 1 || m.decimals > 6)
    e.push('Decimal places must be a whole number from 1 to 6.')
  if (!finite(m.safeZ) || m.safeZ <= 0) e.push('Safe Z must be above the copper surface (greater than 0).')
  if (!finite(m.travelZ) || m.travelZ <= 0)
    e.push('Travel Z must be above the copper surface (greater than 0).')
  if (finite(m.safeZ) && finite(m.travelZ) && m.travelZ > m.safeZ)
    e.push('Travel Z should not be higher than safe Z.')
  if (!finite(m.toolChangeZ) || m.toolChangeZ <= 0) e.push('Tool change Z must be greater than 0.')
  else if (finite(m.safeZ) && m.toolChangeZ < m.safeZ)
    e.push('Tool change Z should be at least as high as safe Z.')
  if (finite(m.workArea.z) && finite(m.toolChangeZ) && m.toolChangeZ > m.workArea.z)
    e.push('Tool change Z is higher than the machine can travel in Z.')
  if (!/^[A-Za-z0-9]{1,8}$/.test(m.fileExtension ?? ''))
    e.push('File extension must be 1–8 letters or digits, without the dot (e.g. "nc").')
  if (m.supportsProbing && m.probeCommand !== 'G31' && m.probeCommand !== 'G38.2')
    e.push('Choose a probe command (G31 or G38.2).')
  return e
}

export interface MachineFieldHelp {
  label: string
  description: string
  unit?: string
}

export const MACHINE_FIELD_HELP: Record<keyof MachineProfile, MachineFieldHelp> = {
  id: { label: 'ID', description: 'Internal identifier. You never need to change it.' },
  name: { label: 'Name', description: 'The name shown in the machine list.' },
  description: { label: 'Description', description: 'A short note about this machine, shown on its card.' },
  builtIn: {
    label: 'Built-in',
    description: 'Built-in presets cannot be edited. Duplicate one to make your own adjustable copy.'
  },
  postProcessor: {
    label: 'G-code flavour',
    description:
      'Which controller software runs your machine (Mach3, GRBL, LinuxCNC or generic). Each understands slightly different G-code, so pick the one your machine uses.'
  },
  workArea: {
    label: 'Work area',
    description:
      'How far the machine can move in X (left-right), Y (front-back) and Z (up-down). PCB TraceMill warns if a job would go outside it.',
    unit: 'mm'
  },
  maxFeedXY: {
    label: 'Max cutting feed (X/Y)',
    description:
      'The fastest sideways speed your machine moves reliably while cutting. Feeds above this are capped.',
    unit: 'mm/min'
  },
  maxFeedZ: {
    label: 'Max Z feed',
    description: 'The fastest up/down speed your machine moves reliably. Plunge rates above this are capped.',
    unit: 'mm/min'
  },
  accel: {
    label: 'Acceleration',
    description:
      'How quickly the axes speed up and slow down. Only used to estimate how long a job takes - many short moves (isolation, auto-levelled files) take longer than their length suggests. Mach3: Config > Motor Tuning, "Accel". Most hobby routers: 30-100.',
    unit: 'mm/s²'
  },
  spindleMin: {
    label: 'Minimum spindle speed',
    description: 'The slowest speed your spindle can run. Lower requested speeds are raised to this.',
    unit: 'RPM'
  },
  spindleMax: {
    label: 'Maximum spindle speed',
    description: 'The fastest speed your spindle can run. Higher requested speeds are lowered to this.',
    unit: 'RPM'
  },
  spindleSpinUpSec: {
    label: 'Spindle spin-up wait',
    description:
      'Seconds to wait after switching the spindle on before cutting, so it reaches full speed. Cutting with a slow spindle breaks small bits.',
    unit: 's'
  },
  spindleSpeedControl: {
    label: 'Speed set by G-code',
    description:
      'Turn on if the machine can set the spindle speed itself (S command). Turn off if you set the speed by hand on a dial, as with most trim routers.'
  },
  supportsToolChange: {
    label: 'Automatic tool changer',
    description:
      'Turn on only if your machine changes bits by itself when it sees M6. Otherwise the program pauses and asks you to change the bit by hand.'
  },
  supportsArcs: {
    label: 'Arcs (G2/G3)',
    description:
      'Whether curves can be written as smooth arcs. Almost every controller supports this; turning it off writes curves as many short straight lines.'
  },
  supportsCannedCycles: {
    label: 'Drilling cycles (G81/G83)',
    description:
      'Short commands that drill a hole in one line. GRBL does not support them; when off, every drill plunge is written out move by move.'
  },
  supportsProbing: {
    label: 'Probing',
    description:
      'Whether the machine can touch a probe wire to the board to measure its height. Needed for auto-leveling (compensating for a board that is not perfectly flat).'
  },
  probeCommand: {
    label: 'Probe command',
    description: 'The command your controller uses to probe: Mach3 uses G31, GRBL and LinuxCNC use G38.2.'
  },
  outputUnits: {
    label: 'Output units',
    description:
      'Whether the G-code is written in millimetres or inches. Keep millimetres unless your machine requires inches.'
  },
  decimals: {
    label: 'Decimal places',
    description:
      'How many digits after the decimal point coordinates get. 3 (one micrometre) is plenty for millimetres; more just makes the file bigger.'
  },
  safeZ: {
    label: 'Safe Z',
    description:
      'Height above the copper the bit rises to before long moves across the board, so it cannot hit clamps or screws.',
    unit: 'mm'
  },
  travelZ: {
    label: 'Travel Z',
    description:
      'A lower hop height used between nearby cuts to save time. Must clear the board surface, and not be higher than safe Z.',
    unit: 'mm'
  },
  toolChangeZ: {
    label: 'Tool change Z',
    description:
      'How high the spindle lifts when it is time to change the bit, so you have room to reach in.',
    unit: 'mm'
  },
  fileExtension: {
    label: 'File extension',
    description:
      'The ending of exported files, e.g. "tap" for Mach3, "nc" or "gcode" for GRBL, "ngc" for LinuxCNC.'
  },
  lineNumbers: {
    label: 'Line numbers',
    description: 'Adds N10, N20… at the start of each line. Only needed by some older controllers.'
  },
  customHeader: {
    label: 'Custom start code',
    description: 'Extra G-code lines added at the very start of every file, for machine-specific setup.'
  },
  customFooter: {
    label: 'Custom end code',
    description: 'Extra G-code lines added at the very end of every file, e.g. to park the machine.'
  },
  commentStyle: {
    label: 'Comment style',
    description:
      'How notes inside the G-code are written: (in brackets) or ; after a semicolon. Brackets work almost everywhere.'
  }
}
