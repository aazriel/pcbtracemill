import type {
  CamStep,
  DrillHole,
  ImportedLayer,
  LayerType,
  MachineProfile,
  Material,
  PolygonSet,
  StepKind,
  Tool
} from '@core/model/types'
import { polygonSetBBox } from '@core/geometry'

export function machine(over: Partial<MachineProfile> = {}): MachineProfile {
  return {
    id: 'm',
    name: 'Test',
    description: '',
    builtIn: false,
    postProcessor: 'grbl',
    workArea: { x: 300, y: 200, z: 50 },
    maxFeedXY: 2000,
    maxFeedZ: 500,
    spindleMin: 0,
    spindleMax: 12000,
    spindleSpinUpSec: 0,
    spindleSpeedControl: true,
    supportsToolChange: false,
    supportsArcs: true,
    supportsCannedCycles: false,
    supportsProbing: true,
    probeCommand: 'G38.2',
    outputUnits: 'mm',
    decimals: 3,
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

export function material(over: Partial<Material> = {}): Material {
  return {
    width: 100,
    height: 80,
    thickness: 1.6,
    copperThickness: 0.035,
    offsetX: 10,
    offsetY: 10,
    rotation: 0,
    origin: 'bottom-left',
    doubleSided: true,
    alignment: { enabled: true, axis: 'x', pinDiameter: 3, margin: 3 },
    useDefaults: false,
    ...over
  }
}

export function tool(type: Tool['type'], diameter: number, over: Partial<Tool['feeds']> = {}): Tool {
  return {
    id: `t-${type}-${diameter}`,
    name: `${type} ${diameter}`,
    type,
    geometry: {
      diameter,
      fluteLength: 5,
      flutes: 2,
      tipAngle: type === 'vbit' ? 60 : undefined,
      tipDiameter: 0.1
    },
    feeds: { spindleRpm: 10000, feedXY: 300, feedZ: 100, stepDown: 0.6, stepOver: 0.5, ...over },
    notes: '',
    builtIn: false,
    number: 1
  }
}

export function step(kind: StepKind, layerIds: string[], over: Partial<CamStep> = {}): CamStep {
  return {
    id: `s-${kind}`,
    kind,
    name: kind,
    enabled: true,
    side: 'top',
    layerIds,
    toolId: 't',
    cutDepth: 0.1,
    safeZ: null,
    params: {
      isolation: { passes: 1, overlap: 0.5, direction: 'climb', extraClearance: 0 },
      clear: { overlap: 0.4, direction: 'climb', minIslandArea: 0, clearMargin: 0 },
      cutout: { tabs: 0, tabWidth: 2, tabHeight: 0.6, outside: true },
      drill: { peck: 0, retract: 1, minDiameter: 0, maxDiameter: 10, includeSlots: false },
      holeMill: { minDiameter: 0, maxDiameter: 20, helical: true }
    },
    ...over
  }
}

export function layer(
  id: string,
  type: LayerType,
  geometry: PolygonSet,
  extra: { holes?: DrillHole[]; strokes?: { path: { x: number; y: number }[]; width: number }[] } = {}
): ImportedLayer {
  const bbox = geometry.length
    ? polygonSetBBox(geometry)
    : extra.holes?.length
      ? {
          minX: Math.min(...extra.holes.map((h) => h.x)),
          minY: Math.min(...extra.holes.map((h) => h.y)),
          maxX: Math.max(...extra.holes.map((h) => h.x)),
          maxY: Math.max(...extra.holes.map((h) => h.y))
        }
      : { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return {
    id,
    fileName: `${id}.gbr`,
    rawText: '',
    type,
    side: 'top',
    autoDetected: false,
    confidence: 1,
    visible: true,
    color: '#fff',
    order: 0,
    stats: { widthMm: 0, heightMm: 0, points: 0, pads: 0, tracks: 0 },
    parsed: {
      format: type === 'drill' ? 'excellon' : 'gerber',
      geometry,
      objects: [],
      strokes: extra.strokes ?? [],
      drills: extra.holes ? { holes: extra.holes, slots: [] } : undefined,
      bbox,
      fileAttributes: {},
      sourceUnits: 'mm',
      warnings: []
    }
  }
}

export function hole(x: number, y: number, diameter: number): DrillHole {
  return { x, y, diameter, plated: true, toolNumber: 1 }
}
