import type { MachineProfile, Move, Tool, Toolpath, ToolpathSegment } from '@core/model/types'

/** Hand-built fixtures for post-processor tests (independent of machine presets / toolpath generation). */

export function machine(over: Partial<MachineProfile>): MachineProfile {
  return {
    id: 'test',
    name: 'Test machine',
    description: '',
    builtIn: false,
    postProcessor: 'mach3',
    workArea: { x: 300, y: 200, z: 60 },
    maxFeedXY: 2000,
    maxFeedZ: 500,
    spindleMin: 1000,
    spindleMax: 24000,
    spindleSpinUpSec: 2,
    spindleSpeedControl: true,
    supportsToolChange: true,
    supportsArcs: true,
    supportsCannedCycles: true,
    supportsProbing: true,
    probeCommand: 'G38.2',
    outputUnits: 'mm',
    decimals: 4,
    safeZ: 5,
    travelZ: 2,
    toolChangeZ: 30,
    fileExtension: 'nc',
    lineNumbers: false,
    customHeader: '',
    customFooter: '',
    commentStyle: 'parens',
    ...over
  }
}

const tool = (
  id: string,
  number: number,
  name: string,
  type: Tool['type'],
  diameter: number,
  rpm: number,
  feedXY: number,
  feedZ: number,
  extra: Partial<Tool['geometry']> = {}
): Tool => ({
  id,
  name,
  type,
  number,
  geometry: { diameter, fluteLength: 6, flutes: 2, ...extra },
  feeds: { spindleRpm: rpm, feedXY, feedZ, stepDown: 0.6, stepOver: 0.4 },
  notes: '',
  builtIn: false
})

export const TOOLS: Tool[] = [
  tool('t-vbit', 1, '30deg V-bit 0.1', 'vbit', 3.175, 12000, 300, 60, { tipAngle: 30, tipDiameter: 0.1 }),
  tool('t-drill', 2, '0.8 mm drill', 'drill', 0.8, 10000, 100, 100),
  tool('t-mill', 3, '1.0 mm end mill', 'flat', 1.0, 15000, 200, 50)
]

const r = (x: number, y: number, z: number): Move => ({ kind: 'rapid', x, y, z })
const p = (x: number, y: number, z: number, feed?: number): Move => ({ kind: 'plunge', x, y, z, feed })
const f = (x: number, y: number, z: number, feed?: number): Move => ({ kind: 'feed', x, y, z, feed })
const up = (x: number, y: number, z: number): Move => ({ kind: 'retract', x, y, z })
const ccw = (x: number, y: number, z: number, cx: number, cy: number): Move => ({
  kind: 'arc-ccw',
  x,
  y,
  z,
  cx,
  cy
})
const cw = (x: number, y: number, z: number, cx: number, cy: number): Move => ({
  kind: 'arc-cw',
  x,
  y,
  z,
  cx,
  cy
})

const stats = { cutLength: 0, rapidLength: 0, plungeCount: 0, estimatedSeconds: 0 }

function drillSeg(x: number, y: number, peck: number): ToolpathSegment {
  const depth = 1.8
  const moves: Move[] = [r(x, y, 1)]
  if (peck > 0) {
    for (let d = peck; d < depth + 1e-9; d += peck) {
      moves.push(p(x, y, -Math.min(d, depth), 100), up(x, y, 1))
    }
  } else moves.push(p(x, y, -depth, 100), up(x, y, 1))
  moves.push(up(x, y, 2))
  return { drill: { x, y, depth, retract: 1, peck, feed: 100 }, moves }
}

export const TOOLPATHS: Toolpath[] = [
  {
    stepId: 's-iso-top',
    stepName: 'Isolation (top)',
    stepKind: 'isolate',
    side: 'top',
    toolId: 't-vbit',
    segments: [
      {
        moves: [
          r(10, 10, 2),
          p(10, 10, -0.05, 60),
          f(20, 10, -0.05, 300),
          ccw(25, 15, -0.05, 20, 15),
          f(25, 25, -0.05, 300),
          cw(15, 25, -0.05, 20, 25),
          f(10, 10, -0.05, 300),
          up(10, 10, 2)
        ]
      },
      { moves: [r(40, 10, 2), p(40, 10, -0.05, 60), ccw(40, 10, -0.05, 37, 10), up(40, 10, 2)] }
    ],
    stats,
    warnings: []
  },
  {
    stepId: 's-drill',
    stepName: 'Drill 0.8 mm',
    stepKind: 'drill',
    side: 'top',
    toolId: 't-drill',
    segments: [drillSeg(5, 5, 0.6), drillSeg(15, 5, 0.6), drillSeg(25, 5, 0)],
    stats,
    warnings: []
  },
  {
    stepId: 's-holemill',
    stepName: 'Hole mill 3 mm',
    stepKind: 'holeMill',
    side: 'top',
    toolId: 't-mill',
    segments: [
      {
        moves: [
          r(31, 30, 1),
          p(31, 30, 0, 50),
          ccw(31, 30, -0.6, 30, 30),
          ccw(31, 30, -1.2, 30, 30),
          ccw(31, 30, -1.8, 30, 30),
          ccw(31, 30, -1.8, 30, 30),
          f(30, 30, -1.8),
          up(30, 30, 2)
        ]
      }
    ],
    stats,
    warnings: []
  },
  {
    stepId: 's-cutout',
    stepName: 'Board cutout',
    stepKind: 'cutout',
    side: 'top',
    toolId: 't-mill',
    segments: [
      {
        moves: [
          r(-0.5, -0.5, 2),
          p(-0.5, -0.5, -1.8, 50),
          f(50.5, -0.5, -1.8),
          f(50.5, 40.5, -1.8),
          f(-0.5, 40.5, -1.8),
          f(-0.5, -0.5, -1.8),
          up(-0.5, -0.5, 2)
        ]
      }
    ],
    stats,
    warnings: []
  },
  {
    stepId: 's-iso-bottom',
    stepName: 'Isolation (bottom)',
    stepKind: 'isolate',
    side: 'bottom',
    toolId: 't-vbit',
    segments: [
      {
        moves: [
          r(12, 12, 2),
          p(12, 12, -0.05, 60),
          f(30, 12, -0.05, 300),
          cw(35, 17, -0.05, 30, 17),
          up(35, 17, 2)
        ]
      }
    ],
    stats,
    warnings: []
  }
]

export const MACHINES: Record<string, MachineProfile> = {
  mach3: machine({ name: 'Mach3 router', postProcessor: 'mach3', fileExtension: 'tap' }),
  mach3inch: machine({
    name: 'Mach3 router (inch)',
    postProcessor: 'mach3',
    fileExtension: 'tap',
    outputUnits: 'inch',
    supportsToolChange: false
  }),
  grbl: machine({
    name: 'GRBL 3018',
    postProcessor: 'grbl',
    supportsToolChange: false,
    decimals: 3,
    spindleSpinUpSec: 3,
    spindleMax: 10000,
    lineNumbers: true
  }),
  linuxcnc: machine({
    name: 'LinuxCNC mill',
    postProcessor: 'linuxcnc',
    fileExtension: 'ngc',
    spindleSpinUpSec: 0
  }),
  generic: machine({
    name: 'Generic controller',
    postProcessor: 'generic',
    fileExtension: 'gcode',
    supportsArcs: false,
    supportsCannedCycles: false,
    supportsToolChange: false,
    spindleSpeedControl: false,
    lineNumbers: true,
    commentStyle: 'semicolon',
    decimals: 3,
    customHeader: 'M8\nG54',
    customFooter: 'M9'
  })
}
