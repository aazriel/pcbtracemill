/**
 * Building ImportedLayer records: stats, colours, status summary.
 */
import type {
  DetectionResult,
  EdaTool,
  ImportedLayer,
  LayerSide,
  LayerStats,
  LayerType,
  ParsedLayer
} from '../model/types'
import { bboxIsEmpty, countPoints, emptyBBox } from '../geometry'
import { drillPlating } from '../excellon'
import { detectLayer } from './detect'

export function computeLayerStats(parsed: ParsedLayer): LayerStats {
  const empty = bboxIsEmpty(parsed.bbox)
  let pads = 0
  let tracks = 0
  if (parsed.format === 'excellon') {
    pads = parsed.drills?.holes.length ?? 0
    tracks = parsed.drills?.slots.length ?? 0
  } else {
    for (const o of parsed.objects) {
      if (o.kind === 'flash') pads++
      else if (o.kind === 'draw' || o.kind === 'arc') tracks++
    }
  }
  return {
    widthMm: empty ? 0 : parsed.bbox.maxX - parsed.bbox.minX,
    heightMm: empty ? 0 : parsed.bbox.maxY - parsed.bbox.minY,
    points: countPoints(parsed.geometry),
    pads,
    tracks
  }
}

// ─────────────────────────────────────────── colours

/** Base colour per type/side as HSL [h, s%, l%]. */
function baseHsl(type: LayerType, side: LayerSide): [number, number, number] {
  switch (type) {
    case 'copper':
      if (side === 'bottom') return [212, 70, 56] // blue
      if (side === 'inner') return [32, 85, 55] // amber
      return [12, 72, 55] // reddish copper
    case 'soldermask':
      return side === 'bottom' ? [165, 40, 52] : [135, 42, 52] // muted, translucent-looking greens
    case 'silkscreen':
      return side === 'bottom' ? [50, 90, 78] : [45, 15, 94] // pale yellow / warm white
    case 'paste':
      return side === 'bottom' ? [220, 8, 66] : [210, 10, 76] // silver greys
    case 'outline':
      return [48, 95, 58] // yellow
    case 'drill':
      return [210, 6, 62] // grey
    case 'fab':
      return side === 'bottom' ? [300, 45, 66] : [275, 50, 70] // lavender / pink
    default:
      return [180, 35, 55] // teal
  }
}

function hslToHex(h: number, s: number, l: number): string {
  const hh = (((h % 360) + 360) % 360) / 360
  const ss = Math.max(0, Math.min(100, s)) / 100
  const ll = Math.max(0, Math.min(100, l)) / 100
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss
  const p = 2 * ll - q
  const ch = (t: number): number => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  const to = (v: number): string =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(ch(hh + 1 / 3))}${to(ch(hh))}${to(ch(hh - 1 / 3))}`
}

/**
 * Pleasant default colour for a layer. `index` (usually the layer order) shifts hue and
 * lightness in a zig-zag so two layers of the same kind still get distinct colours.
 */
export function defaultLayerColor(type: LayerType, side: LayerSide, index: number): string {
  const [h, s, l] = baseHsl(type, side)
  const i = Math.max(0, Math.floor(index))
  // zig-zag 0, +1, -1, +2, -2 ... limited to ±6 steps, then wraps with a lightness band change.
  const step = i % 13
  const band = Math.floor(i / 13)
  const z = step === 0 ? 0 : step % 2 === 1 ? (step + 1) / 2 : -step / 2
  const dl = (band % 2 === 1 ? -1 : 1) * Math.ceil(band / 2) * 7 + (step % 2 === 1 ? 3 : step === 0 ? 0 : -3)
  return hslToHex(h + z * 9, s, l + dl)
}

// ─────────────────────────────────────────── layer building

export type ParseFn = (text: string, name: string, detection: DetectionResult) => ParsedLayer

function emptyParsed(format: ParsedLayer['format'], warning: string): ParsedLayer {
  return {
    format,
    geometry: [],
    objects: [],
    strokes: [],
    bbox: emptyBBox(),
    fileAttributes: {},
    sourceUnits: 'mm',
    warnings: [warning]
  }
}

/** Detects, parses and assembles an ImportedLayer. Parse errors yield an empty layer with a warning. */
export function buildImportedLayer(
  input: { name: string; text: string },
  eda: EdaTool | null,
  parse: ParseFn,
  order: number,
  id: string
): ImportedLayer {
  const detection = detectLayer(input.name, input.text, eda)
  let parsed: ParsedLayer
  try {
    parsed = parse(input.text, input.name, detection)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    parsed = emptyParsed(detection.type === 'drill' ? 'excellon' : 'gerber', `Parse failed: ${msg}`)
  }
  let plating = detection.type === 'drill' ? detection.plating : undefined
  if (detection.type === 'drill') plating = drillPlating(parsed.drills) ?? plating
  const layer: ImportedLayer = {
    id,
    fileName: input.name,
    rawText: input.text,
    type: detection.type,
    side: detection.side,
    autoDetected: true,
    confidence: detection.confidence,
    visible: detection.type !== 'other',
    color: defaultLayerColor(detection.type, detection.side, order),
    order,
    stats: computeLayerStats(parsed),
    parsed
  }
  if (plating) layer.plating = plating
  return layer
}

// ─────────────────────────────────────────── status summary

export type LayerStatusKey = 'copper' | 'outline' | 'drill' | 'silkscreen' | 'soldermask' | 'fab'
export interface LayerStatusEntry {
  key: LayerStatusKey
  present: boolean
  requirement: 'required' | 'recommended' | 'optional'
}

const STATUS: [LayerStatusKey, LayerStatusEntry['requirement']][] = [
  ['copper', 'required'],
  ['outline', 'recommended'],
  ['drill', 'recommended'],
  ['silkscreen', 'optional'],
  ['soldermask', 'optional'],
  ['fab', 'optional']
]

/** Which layer kinds are present. Copper is required; outline/drill recommended; rest optional. */
export function summarizeLayerStatus(layers: ImportedLayer[]): LayerStatusEntry[] {
  return STATUS.map(([key, requirement]) => ({
    key,
    requirement,
    present: layers.some((l) => l.type === key)
  }))
}
