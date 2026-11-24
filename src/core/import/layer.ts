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

/**
 * Strongly different colours for the layer list and the board view (no two shades of one hue), so it is
 * easy to see which layer is which. The first ones are the preferred colours of the common layer kinds.
 */
export const LAYER_PALETTE = [
  '#ff3b3b', // red: top copper
  '#3b82ff', // blue: bottom copper
  '#ffd400', // yellow: board outline
  '#f8fafc', // white: drill holes
  '#22c55e', // green: top solder mask
  '#ff4fd8', // magenta: bottom solder mask
  '#00e5ff', // cyan: top silkscreen
  '#ff8a00', // orange: inner copper
  '#a855f7', // purple: bottom silkscreen
  '#8a94a6', // grey: top paste
  '#c8925a', // tan: bottom paste
  '#ff9eb8', // pink: top fab
  '#14b8a6', // teal: bottom fab
  '#c6ff3d', // lime: other
  '#6366f1', // indigo
  '#9a8a00' // olive
] as const

/** The preferred colour of a layer kind. */
export function defaultLayerColor(type: LayerType, side: LayerSide): string {
  const P = LAYER_PALETTE
  switch (type) {
    case 'copper':
      return side === 'bottom' ? P[1] : side === 'inner' ? P[7] : P[0]
    case 'soldermask':
      return side === 'bottom' ? P[5] : P[4]
    case 'silkscreen':
      return side === 'bottom' ? P[8] : P[6]
    case 'paste':
      return side === 'bottom' ? P[10] : P[9]
    case 'outline':
      return P[2]
    case 'drill':
      return P[3]
    case 'fab':
      return side === 'bottom' ? P[12] : P[11]
    default:
      return P[13]
  }
}

/**
 * Colour for a new layer that no other layer uses: its kind's preferred colour when that is free,
 * otherwise the first free palette colour, and only after all of them hues spread by the golden angle.
 */
export function pickLayerColor(type: LayerType, side: LayerSide, used: readonly string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()))
  const pref = defaultLayerColor(type, side)
  if (!taken.has(pref)) return pref
  const free = LAYER_PALETTE.find((c) => !taken.has(c))
  if (free) return free
  for (let i = taken.size; ; i++) {
    const c = hslToHex(i * 137.508, 85, i % 2 ? 62 : 52)
    if (!taken.has(c)) return c
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
    color: defaultLayerColor(detection.type, detection.side),
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
