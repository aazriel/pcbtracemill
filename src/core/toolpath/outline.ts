/** Board outline reconstruction (board coordinates). */
import type { BBox, ImportedLayer, PolygonSet } from '../model/types'
import { bboxIsEmpty, polygonSetArea, rectPath, unionPaths } from '../geometry'
import { chainPolylines } from './pathUtils'

export type OutlineSource = 'strokes' | 'geometry' | 'bbox' | 'none'

/**
 * Builds the board shape from outline layers:
 *  1. stroke centre-lines chained into closed loops, combined even-odd (inner loops become cut-outs);
 *  2. otherwise the painted geometry with holes filled (outer boundary of the drawn outline — for an
 *     outline drawn with a thick line this is half a line width too large);
 *  3. otherwise the board bbox rectangle.
 */
export function buildOutline(
  layers: ImportedLayer[],
  boardBBox: BBox
): { shape: PolygonSet; source: OutlineSource } {
  const parsed = layers.filter((l) => l.parsed)
  const strokes = parsed.flatMap((l) => l.parsed!.strokes.map((s) => s.path))
  if (strokes.length) {
    const { closed } = chainPolylines(strokes, 0.01)
    const shape = unionPaths(closed, true)
    if (shape.length && polygonSetArea(shape) > 1e-6) return { shape, source: 'strokes' }
  }
  const outers = parsed.flatMap((l) => l.parsed!.geometry.map((p) => p.outer))
  if (outers.length) {
    const shape = unionPaths(outers)
    if (shape.length && polygonSetArea(shape) > 1e-6) return { shape, source: 'geometry' }
  }
  if (!bboxIsEmpty(boardBBox) && boardBBox.maxX > boardBBox.minX && boardBBox.maxY > boardBBox.minY) {
    const b = boardBBox
    return {
      shape: [
        {
          outer: rectPath((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, b.maxX - b.minX, b.maxY - b.minY),
          holes: []
        }
      ],
      source: 'bbox'
    }
  }
  return { shape: [], source: 'none' }
}

/** Outline layers to use: selected outline layers, else any outline layer in the project. */
export function outlineLayers(all: ImportedLayer[], selectedIds: string[]): ImportedLayer[] {
  const sel = all.filter((l) => selectedIds.includes(l.id) && l.type === 'outline' && l.parsed)
  if (sel.length) return sel
  const selAny = all.filter(
    (l) => selectedIds.includes(l.id) && l.parsed && l.type !== 'copper' && l.type !== 'drill'
  )
  if (selAny.length) return selAny
  return all.filter((l) => l.type === 'outline' && l.parsed)
}
