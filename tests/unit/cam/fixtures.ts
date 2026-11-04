import type { DrillHole, ImportedLayer, LayerSide, LayerType } from '@core/model/types'

export function layer(id: string, type: LayerType, side: LayerSide, holes?: number[]): ImportedLayer {
  const drills = holes
    ? {
        holes: holes.map((d, i): DrillHole => ({ x: i, y: 0, diameter: d, plated: true, toolNumber: 1 })),
        slots: []
      }
    : undefined
  return {
    id,
    fileName: `${id}.gbr`,
    rawText: '',
    type,
    side,
    autoDetected: true,
    confidence: 1,
    visible: true,
    color: '#fff',
    order: 0,
    stats: { widthMm: 50, heightMm: 40, points: 0, pads: 0, tracks: 0 },
    parsed: {
      format: type === 'drill' ? 'excellon' : 'gerber',
      geometry: [],
      objects: [],
      strokes: [],
      drills,
      bbox: { minX: 0, minY: 0, maxX: 50, maxY: 40 },
      fileAttributes: {},
      sourceUnits: 'mm',
      warnings: []
    }
  }
}
