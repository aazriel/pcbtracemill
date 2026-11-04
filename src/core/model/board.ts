import type { BBox, ImportedLayer } from './types'
import { bboxIsEmpty, bboxUnion, emptyBBox } from '../geometry'

/**
 * The board extents: the outline layer's bbox when present, otherwise the union
 * of every parsed copper/drill layer. Returns an empty bbox when nothing is parsed.
 */
export function computeBoardBBox(layers: ImportedLayer[]): BBox {
  const parsed = layers.filter((l) => l.parsed && !bboxIsEmpty(l.parsed.bbox))
  const outline = parsed.filter((l) => l.type === 'outline')
  const src = outline.length ? outline : parsed.filter((l) => l.type === 'copper' || l.type === 'drill')
  const pool = src.length ? src : parsed
  return pool.reduce((b, l) => bboxUnion(b, l.parsed!.bbox), emptyBBox())
}

export function bboxSize(b: BBox): { width: number; height: number } {
  if (bboxIsEmpty(b)) return { width: 0, height: 0 }
  return { width: b.maxX - b.minX, height: b.maxY - b.minY }
}
