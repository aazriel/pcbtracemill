/**
 * TraceMill core data model — the SINGLE SOURCE OF TRUTH for all shared types.
 *
 * Rules:
 *  - Pure TypeScript. No DOM / Electron / React imports.
 *  - All lengths are millimetres (float64). Feeds are mm/min. Angles are degrees unless noted.
 *  - Coordinates are board coordinates as authored in the CAM file (looking at the TOP side),
 *    +X right, +Y up (away from operator). Mirroring for bottom side happens in CAM, not at import.
 *  - Everything here must be structured-clone / JSON serialisable (used across Web Workers and .tmill files).
 */

// ─────────────────────────────────────────────────────────────── Geometry primitives

export interface Vec2 {
  x: number
  y: number
}

/** Axis-aligned bounding box. Empty box has minX > maxX. */
export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Closed or open polyline, flat list of points. */
export type Path = Vec2[]

/**
 * A polygon with holes. `outer` is CCW, `holes` are CW (Clipper "positive" convention for outer).
 * Fill rule for a PolygonSet is NonZero after normalisation.
 */
export interface Polygon {
  outer: Path
  holes: Path[]
}

/** A set of disjoint polygons (result of union). */
export type PolygonSet = Polygon[]

// ─────────────────────────────────────────────────────────────── Import / layers

export type LayerType =
  | 'copper'
  | 'soldermask'
  | 'silkscreen'
  | 'paste'
  | 'outline' // board outline / edge cuts / mechanical profile
  | 'drill' // Excellon (PTH or NPTH)
  | 'fab' // fabrication / assembly / courtyard
  | 'other'

export type LayerSide = 'top' | 'bottom' | 'inner' | 'all' | 'none'

export type EdaTool = 'kicad' | 'altium' | 'eagle' | 'easyeda' | 'other'

export type SourceFormat = 'gerber' | 'excellon'

/** A single flashed or drawn primitive retained for hover/highlight and statistics. */
export interface GerberObject {
  id: number
  kind: 'flash' | 'draw' | 'arc' | 'region'
  /** Polarity at time of drawing: dark adds copper, clear removes. */
  polarity: 'dark' | 'clear'
  /** Aperture code, e.g. 10 for D10. Regions use -1. */
  aperture: number
  /** X2 attribute: .AperFunction / .TO.N (net) etc. when available. */
  attributes?: Record<string, string>
  /** Painted area of this single object (with aperture applied). */
  shape: PolygonSet
  /** Centre for flashes, or path for draws/arcs (stroke centre-line). */
  center?: Vec2
  path?: Path
  /** Stroke width for draws (aperture diameter), 0 otherwise. */
  width?: number
}

/** A drill hit from Excellon (or a Gerber drill-like flash). */
export interface DrillHole {
  x: number
  y: number
  diameter: number
  plated: boolean
  /** Tool number in the source file (T01 → 1). */
  toolNumber: number
}

/** A routed slot from Excellon (G85 or G00/G01 rout mode). */
export interface DrillSlot {
  start: Vec2
  end: Vec2
  diameter: number
  plated: boolean
  toolNumber: number
}

export interface DrillData {
  holes: DrillHole[]
  slots: DrillSlot[]
}

/** Parsed & normalised content of one imported file. */
export interface ParsedLayer {
  format: SourceFormat
  /** Final painted geometry (dark minus clear, unioned). Empty for pure-drill layers. */
  geometry: PolygonSet
  /** Individual objects (pads, tracks, regions). */
  objects: GerberObject[]
  /** Centre-lines of draws, useful for outline layers that are drawn with thin lines. */
  strokes: { path: Path; width: number }[]
  drills?: DrillData
  bbox: BBox
  /** File-level attributes (X2 %TF ...*%). */
  fileAttributes: Record<string, string>
  /** Original file units (informational; geometry is always mm). */
  sourceUnits: 'mm' | 'inch'
  warnings: string[]
}

export interface LayerStats {
  widthMm: number
  heightMm: number
  /** Number of geometric points (vertices) in the painted geometry. */
  points: number
  /** Number of pads (flashes) — for drill layers, number of holes. */
  pads: number
  /** Number of draws (tracks). */
  tracks: number
}

export interface ImportedLayer {
  id: string
  fileName: string
  /** Raw text kept for re-import and project save. */
  rawText: string
  type: LayerType
  side: LayerSide
  /** For drill layers: plated / non-plated / mixed. */
  plating?: 'pth' | 'npth' | 'mixed'
  /** True while type/side equal the auto-detected ones; false after the user picks something else. */
  autoDetected: boolean
  /** What auto-detection chose, so picking those values again switches back to automatic. */
  detectedType?: LayerType
  detectedSide?: LayerSide
  /** Detection confidence 0..1 */
  confidence: number
  visible: boolean
  color: string
  /** Draw order index (0 = bottom). */
  order: number
  stats: LayerStats
  /** Parsed data is cached; not persisted in .tmill (re-parsed on load). */
  parsed?: ParsedLayer
}

export interface DetectionResult {
  type: LayerType
  side: LayerSide
  plating?: 'pth' | 'npth' | 'mixed'
  confidence: number
  /** Human-readable reason, e.g. "KiCad name pattern F.Cu". */
  reason: string
  /** False when the file is clearly not a fab output for the chosen EDA tool. */
  isRelevantForEda?: boolean
}

// ─────────────────────────────────────────────────────────────── Machines

export type PostProcessorId = 'mach3' | 'grbl' | 'linuxcnc' | 'generic'

export interface MachineProfile {
  id: string
  name: string
  /** Short description shown on the machine card. */
  description: string
  builtIn: boolean
  postProcessor: PostProcessorId
  workArea: { x: number; y: number; z: number }
  /** Maximum feed rates mm/min. */
  maxFeedXY: number
  maxFeedZ: number
  /** Spindle RPM range. */
  spindleMin: number
  spindleMax: number
  /** Seconds to wait after M3 for spindle to reach speed (G4 dwell). 0 = no dwell. */
  spindleSpinUpSec: number
  /** True if spindle speed is controlled by S word (PWM/VFD). */
  spindleSpeedControl: boolean
  /** Supports automatic tool change (M6 executes). If false a manual pause (M0) is used. */
  supportsToolChange: boolean
  /** Supports arcs G2/G3 in output. */
  supportsArcs: boolean
  /** Supports canned drilling cycles (G81/G83). */
  supportsCannedCycles: boolean
  /** Supports probing (G38.2) for auto-leveling. */
  supportsProbing: boolean
  /** Probe command dialect. */
  probeCommand: 'G31' | 'G38.2'
  /** Output units of emitted G-code. */
  outputUnits: 'mm' | 'inch'
  /** Decimal places for coordinates. */
  decimals: number
  /** Default heights (mm, relative to work Z0 = copper surface). */
  safeZ: number
  travelZ: number
  toolChangeZ: number
  /** Output file extension without dot, e.g. "nc", "tap", "ngc", "gcode". */
  fileExtension: string
  /** Line numbers N10, N20... */
  lineNumbers: boolean
  /** Custom header/footer lines (generic post). */
  customHeader: string
  customFooter: string
  /** Comment style. */
  commentStyle: 'parens' | 'semicolon'
}

// ─────────────────────────────────────────────────────────────── Tools

export type ToolType = 'flat' | 'ball' | 'drill' | 'vbit' | 'corn'

export interface ToolGeometry {
  /** Shank / nominal diameter mm (for V-bit: the shank diameter). */
  diameter: number
  /** V-bit only: included tip angle in degrees (e.g. 30, 60, 90). */
  tipAngle?: number
  /** V-bit only: flat tip diameter mm (0 = sharp). */
  tipDiameter?: number
  /** Flute / cutting length mm. */
  fluteLength: number
  /** Number of flutes. */
  flutes: number
  /** Drill: point angle (118 / 135). */
  pointAngle?: number
}

export interface FeedsSpeeds {
  /** Spindle RPM. */
  spindleRpm: number
  /** Horizontal cutting feed mm/min. */
  feedXY: number
  /** Plunge feed mm/min. */
  feedZ: number
  /** Max depth per pass mm. */
  stepDown: number
  /** Stepover as fraction of effective cutting width 0..1. */
  stepOver: number
}

export interface Tool {
  id: string
  name: string
  type: ToolType
  geometry: ToolGeometry
  feeds: FeedsSpeeds
  notes: string
  /** Built-in starter-kit tool (read-only; duplicate to customise). */
  builtIn: boolean
  /** Tool number used in M6 Tn. */
  number: number
}

// ─────────────────────────────────────────────────────────────── Material / stock

export type OriginCorner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' | 'center'

export interface AlignmentConfig {
  enabled: boolean
  /** Flip axis: pins placed along this axis; the board flips around the perpendicular centre line. */
  axis: 'x' | 'y'
  /** Pin hole diameter mm. */
  pinDiameter: number
  /** Distance of each pin from the board edge (outside the board, inside stock) mm. */
  margin: number
}

export interface Material {
  /** Stock size mm. */
  width: number
  height: number
  thickness: number
  /** Copper thickness mm (35 µm = 1 oz). */
  copperThickness: number
  /** Board placement offset inside the stock (board bbox min corner relative to stock min corner) mm. */
  offsetX: number
  offsetY: number
  /** Board rotation in degrees (0/90/180/270 recommended). */
  rotation: number
  /** Where work zero (X0 Y0) sits: a corner / the centre of the stock or of the board. Z0 is always the top copper surface. */
  origin: OriginCorner
  /**
   * What `origin` refers to: the copper-clad sheet ('stock', default) or the board as placed on it
   * for the top side ('board'). It is one fixed point on the machine bed for both sides, so X/Y is
   * not re-zeroed after flipping.
   */
  originOn?: 'stock' | 'board'
  doubleSided: boolean
  alignment: AlignmentConfig
  /** True while width/height track the board size + default margin. */
  useDefaults: boolean
}

// ─────────────────────────────────────────────────────────────── CAM steps

export type StepKind = 'drill' | 'clear' | 'cutout' | 'holeMill' | 'isolate' | 'alignment' | 'engrave'

export type CutDirection = 'climb' | 'conventional'

export interface IsolationParams {
  passes: number
  /** Overlap between passes 0..0.9 */
  overlap: number
  direction: CutDirection
  /** Extra clearance added to the first pass offset, mm. */
  extraClearance: number
  /**
   * Places where copper features are closer than this (mm) are not reported: such tiny gaps (e.g.
   * inside a ground pour) usually belong together anyway. 0 / missing = report every narrow place.
   */
  ignoreGapsBelow?: number
}

export interface ClearParams {
  /** Overlap between adjacent passes 0..0.9 */
  overlap: number
  direction: CutDirection
  /** Ignore copper islands smaller than this area mm² (they are removed). */
  minIslandArea: number
  /** Clear only within this distance of copper (0 = clear whole board). */
  clearMargin: number
}

export interface CutoutParams {
  /** Number of holding tabs. */
  tabs: number
  tabWidth: number
  tabHeight: number
  /** Cut outside (true) or inside the outline line. */
  outside: boolean
}

export interface DrillParams {
  /** Peck depth mm (0 = no peck). */
  peck: number
  /** Retract above surface between holes mm. */
  retract: number
  /** Only drill holes whose diameter is within [min,max]. */
  minDiameter: number
  maxDiameter: number
  /** Also include holes bigger than tool by milling? (handled by holeMill steps) */
  includeSlots: boolean
}

export interface HoleMillParams {
  /** Holes with diameter >= minDiameter are milled (helical/circular). */
  minDiameter: number
  maxDiameter: number
  /** Helical ramp (true) or plunge + circles (false). */
  helical: boolean
}

export interface StepParams {
  isolation: IsolationParams
  clear: ClearParams
  cutout: CutoutParams
  drill: DrillParams
  holeMill: HoleMillParams
}

export interface CamStep {
  id: string
  kind: StepKind
  name: string
  enabled: boolean
  side: 'top' | 'bottom'
  /** Source layer ids. */
  layerIds: string[]
  toolId: string | null
  /** Final depth below Z0 (positive number, mm). */
  cutDepth: number
  /** Safe Z override, null → machine default. */
  safeZ: number | null
  params: StepParams
  /** Ids of ToolpathProblems the user chose to ignore for this step. */
  ignoredProblems?: string[]
  /** Advanced: parts of the board this step leaves alone (only used while `enabled`). */
  skip?: { enabled: boolean; items: SkipRef[] }
}

/**
 * A part of the board picked by the user (BOARD coordinates): a copper area that is not isolated
 * (any point inside it), or a hole that is not drilled / milled (its centre and diameter).
 */
export interface SkipRef {
  kind: 'copper' | 'hole'
  x: number
  y: number
  /** Hole diameter (mm). */
  d?: number
}

export type ValidationLevel = 'ok' | 'warning' | 'error'

export interface ValidationIssue {
  level: ValidationLevel
  /** Section of the step dialog: layer | tool | general | params | results. */
  section: 'layer' | 'tool' | 'general' | 'params' | 'results'
  message: string
}

export interface StepValidation {
  stepId: string
  level: ValidationLevel
  issues: ValidationIssue[]
}

// ─────────────────────────────────────────────────────────────── Toolpaths

/**
 * Toolpath moves are in MACHINE WORK coordinates (after side mirroring, stock offset,
 * rotation and origin are applied). Z is relative to copper surface (Z0), negative = into material.
 */
export type MoveKind = 'rapid' | 'feed' | 'plunge' | 'retract' | 'arc-cw' | 'arc-ccw' | 'dwell'

export interface Move {
  kind: MoveKind
  x: number
  y: number
  z: number
  /** mm/min for feed/plunge/arc. */
  feed?: number
  /** Arc centre (absolute) for arc moves. */
  cx?: number
  cy?: number
  /** Dwell seconds. */
  seconds?: number
}

export interface ToolpathSegment {
  /** Optional drill cycle info so posts can emit G81/G83 when supported. */
  drill?: { x: number; y: number; depth: number; retract: number; peck: number; feed: number }
  moves: Move[]
}

/** A place the step cannot machine as designed (shown on the board, can be ignored by id). */
export interface ToolpathProblem {
  /** Stable id (kind + position), used to ignore this place. */
  id: string
  kind: 'narrow-gap' | 'uncleared'
  /** Position in BOARD coordinates (mm), as drawn in the Board / Manufacture views. */
  x: number
  y: number
  /** narrow-gap: the actual distance between the two copper features (mm). */
  gap?: number
  /** narrow-gap: the room the tool needs (cut width + clearance, mm). */
  needed?: number
  /** uncleared: area left (mm²). */
  area?: number
}

export interface Toolpath {
  stepId: string
  stepName: string
  stepKind: StepKind
  side: 'top' | 'bottom'
  toolId: string
  segments: ToolpathSegment[]
  /** Estimated cutting length mm and time seconds. */
  stats: ToolpathStats
  warnings: string[]
  /** Places that cannot be machined as designed (already filtered by the step's ignore settings). */
  problems?: ToolpathProblem[]
}

export interface ToolpathStats {
  cutLength: number
  rapidLength: number
  plungeCount: number
  estimatedSeconds: number
}

// ─────────────────────────────────────────────────────────────── G-code

export interface GcodeLineMeta {
  /** 0-based G-code line index. */
  line: number
  stepId: string | null
  toolId: string | null
}

export type ExportGrouping = 'per-step' | 'per-tool' | 'combined'

export interface GcodeFile {
  name: string
  text: string
  sizeBytes: number
  estimatedSeconds: number
  stepIds: string[]
  toolIds: string[]
  /** Per-line metadata for sim sync (same length as lines). */
  lineMeta: GcodeLineMeta[]
}

/** Interpreted motion for simulation / heightmap application. */
export interface SimMove {
  /** G-code line index the move originated from. */
  line: number
  kind: 'rapid' | 'feed'
  from: [number, number, number]
  to: [number, number, number]
  feed: number
  toolId: string | null
  stepId: string | null
  /** Cumulative time at the END of this move, seconds. */
  tEnd: number
}

// ─────────────────────────────────────────────────────────────── Height map / auto-level

export interface ProbeGridConfig {
  /** Probe area in work coordinates. */
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Number of points along X and Y (>= 2). */
  countX: number
  countY: number
  /** Probe feed mm/min. */
  probeFeed: number
  /** Max probe depth below Z0 (negative number). */
  probeDepth: number
  /**
   * Lift above each touched point before moving to the next one, mm (moves longer than the grid
   * spacing lift proportionally more). Start, end and the long move back to point 1 go to at
   * least 2 mm absolute.
   */
  clearanceZ: number
  /** Mach3 G-code-variables probing: lift before the slow re-touch, mm (default 0.25). */
  retouchLift?: number
  /**
   * Grid cells to probe (row-major index iy * countX + ix), e.g. only the points near a round
   * board. All cells when absent. Cells that are not probed are filled in from their neighbours.
   */
  cells?: number[]
}

export interface HeightMap {
  config: ProbeGridConfig
  /** Row-major Z values: z[iy * countX + ix]. */
  z: number[]
  /** When imported from a probe log. */
  source: string
  /**
   * The heights are not known to TraceMill: they stay in Mach3 G-code variables, cell k in
   * `#(mach3Vars + k)` relative to point 1, written by the TraceMill probe program (D-025).
   * Corrected files then use formulas such as Z[-0.1+0.25*#512] and `z` is all zeros.
   */
  mach3Vars?: number
}

// ─────────────────────────────────────────────────────────────── Project

export interface ProjectSettings {
  edaTool: EdaTool | null
  autoRegenerate: boolean
  exportGrouping: ExportGrouping
  realisticColors: boolean
  highlightOnHover: boolean
  /** Apply the height-map Z correction to exported files. */
  autoLevelApply?: boolean
  /** Corrected files find Z0 with the probe at point 1 before each bit (D-024). */
  autoLevelTouchOff?: boolean
  /** Files that are NOT height-corrected also find Z0 with the probe before each bit (D-026). */
  autoLevelProbeZero?: boolean
  /** Which side was facing up while the board was probed (the map only fits that side). */
  autoLevelSide?: 'top' | 'bottom'
  /** Units shown and typed in the app (everything is stored in mm). Missing = mm. */
  units?: DisplayUnits
}

export type DisplayUnits = 'mm' | 'inch'

export interface Project {
  /** File format version for .tmill. */
  version: 1
  name: string
  layers: ImportedLayer[]
  machine: MachineProfile
  material: Material
  tools: Tool[]
  steps: CamStep[]
  heightMap: HeightMap | null
  settings: ProjectSettings
}

/** Default stock margin around the board on each axis total (board + 5 mm). */
export const DEFAULT_STOCK_MARGIN = 5
