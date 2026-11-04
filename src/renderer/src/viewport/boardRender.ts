/**
 * Pure drawing helpers for the 2D board view (Canvas2D). Geometry is cached as Path2D in
 * millimetre space; the view transform is applied with setTransform at draw time.
 */
import type { BBox, GerberObject, ImportedLayer, PolygonSet } from '@core/model/types'

export interface ViewTransform {
  /** World point at the screen centre (mm). */
  cx: number
  cy: number
  /** Pixels per mm. */
  zoom: number
  /** Mirror X for bottom view. */
  mirror: boolean
}

export function worldToScreen(
  v: ViewTransform,
  w: number,
  h: number,
  x: number,
  y: number
): [number, number] {
  const sx = (v.mirror ? -1 : 1) * (x - v.cx) * v.zoom + w / 2
  const sy = -(y - v.cy) * v.zoom + h / 2
  return [sx, sy]
}

export function screenToWorld(
  v: ViewTransform,
  w: number,
  h: number,
  sx: number,
  sy: number
): [number, number] {
  const x = ((sx - w / 2) / v.zoom) * (v.mirror ? -1 : 1) + v.cx
  const y = -(sy - h / 2) / v.zoom + v.cy
  return [x, y]
}

/** Canvas matrix that maps mm → device pixels. */
export function applyView(
  ctx: CanvasRenderingContext2D,
  v: ViewTransform,
  w: number,
  h: number,
  dpr: number
): void {
  const sx = (v.mirror ? -1 : 1) * v.zoom * dpr
  ctx.setTransform(sx, 0, 0, -v.zoom * dpr, (w / 2) * dpr - sx * v.cx, (h / 2) * dpr + v.zoom * dpr * v.cy)
}

export function fitView(b: BBox, w: number, h: number, mirror: boolean, padding = 0.1): ViewTransform {
  const bw = Math.max(1, b.maxX - b.minX)
  const bh = Math.max(1, b.maxY - b.minY)
  const zoom = Math.min(w / (bw * (1 + 2 * padding)), h / (bh * (1 + 2 * padding)))
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, zoom: Math.max(0.5, zoom), mirror }
}

const pathCache = new WeakMap<object, Path2D>()

export function polygonSetPath(set: PolygonSet): Path2D {
  const cached = pathCache.get(set)
  if (cached) return cached
  const p = new Path2D()
  for (const poly of set) {
    for (const ring of [poly.outer, ...poly.holes]) {
      if (ring.length < 2) continue
      p.moveTo(ring[0].x, ring[0].y)
      for (let i = 1; i < ring.length; i++) p.lineTo(ring[i].x, ring[i].y)
      p.closePath()
    }
  }
  pathCache.set(set, p)
  return p
}

/** Holes (drills) as a single Path2D of circles. */
export function drillPath(layer: ImportedLayer): Path2D | null {
  const d = layer.parsed?.drills
  if (!d) return null
  const key = d as object
  const cached = pathCache.get(key)
  if (cached) return cached
  const p = new Path2D()
  for (const h of d.holes) {
    p.moveTo(h.x + h.diameter / 2, h.y)
    p.arc(h.x, h.y, h.diameter / 2, 0, Math.PI * 2)
  }
  pathCache.set(key, p)
  return p
}

export function slotPath(layer: ImportedLayer): { path: Path2D; width: number }[] {
  const d = layer.parsed?.drills
  if (!d) return []
  return d.slots.map((s) => {
    const p = new Path2D()
    p.moveTo(s.start.x, s.start.y)
    p.lineTo(s.end.x, s.end.y)
    return { path: p, width: s.diameter }
  })
}

export function strokesPath(layer: ImportedLayer): Path2D | null {
  const strokes = layer.parsed?.strokes
  if (!strokes?.length) return null
  const cached = pathCache.get(strokes)
  if (cached) return cached
  const p = new Path2D()
  for (const s of strokes) {
    if (s.path.length < 2) continue
    p.moveTo(s.path[0].x, s.path[0].y)
    for (let i = 1; i < s.path.length; i++) p.lineTo(s.path[i].x, s.path[i].y)
  }
  pathCache.set(strokes, p)
  return p
}

// ───────────────────────────────────────── hit testing (spatial grid of object bboxes)

interface IndexedObject {
  layerId: string
  obj: GerberObject
  bbox: BBox
}

export class ObjectIndex {
  private cells = new Map<string, IndexedObject[]>()
  private readonly cell = 2 // mm

  constructor(layers: ImportedLayer[]) {
    for (const l of layers) {
      for (const obj of l.parsed?.objects ?? []) {
        if (obj.polarity === 'clear') continue
        const b: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        for (const poly of obj.shape)
          for (const v of poly.outer) {
            if (v.x < b.minX) b.minX = v.x
            if (v.y < b.minY) b.minY = v.y
            if (v.x > b.maxX) b.maxX = v.x
            if (v.y > b.maxY) b.maxY = v.y
          }
        if (!(b.minX <= b.maxX)) continue
        const entry: IndexedObject = { layerId: l.id, obj, bbox: b }
        const x0 = Math.floor(b.minX / this.cell)
        const x1 = Math.floor(b.maxX / this.cell)
        const y0 = Math.floor(b.minY / this.cell)
        const y1 = Math.floor(b.maxY / this.cell)
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4000) continue // giant pours: skip to keep index small
        for (let x = x0; x <= x1; x++)
          for (let y = y0; y <= y1; y++) {
            const k = `${x},${y}`
            const arr = this.cells.get(k)
            if (arr) arr.push(entry)
            else this.cells.set(k, [entry])
          }
      }
    }
  }

  /** Returns the smallest object containing the point among `layerIds` (top-most first). */
  hit(
    x: number,
    y: number,
    layerIds: string[],
    ctx: CanvasRenderingContext2D
  ): { layerId: string; obj: GerberObject } | null {
    const arr = this.cells.get(`${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`)
    if (!arr) return null
    let best: IndexedObject | null = null
    let bestArea = Infinity
    let bestRank = Infinity
    for (const e of arr) {
      const rank = layerIds.indexOf(e.layerId)
      if (rank < 0) continue
      const b = e.bbox
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue
      if (!ctx.isPointInPath(polygonSetPath(e.obj.shape), x, y, 'nonzero')) continue
      const area = (b.maxX - b.minX) * (b.maxY - b.minY)
      if (rank < bestRank || (rank === bestRank && area < bestArea)) {
        best = e
        bestArea = area
        bestRank = rank
      }
    }
    return best ? { layerId: best.layerId, obj: best.obj } : null
  }
}

/** Objects belonging to the same electrical net (X2 .N attribute) as `obj` within the layer. */
export function netObjects(layer: ImportedLayer, obj: GerberObject): GerberObject[] {
  const net = obj.attributes?.['.N']
  if (!net || !layer.parsed) return [obj]
  return layer.parsed.objects.filter((o) => o.attributes?.['.N'] === net && o.polarity === 'dark')
}

// ───────────────────────────────────────── realistic palette

export const REAL = {
  background: '#11161d',
  fr4: '#b9a675',
  substrateUnderMask: '#1b5e34',
  copperUnderMask: '#3d8a4f',
  exposedCopper: '#d9b45b', // ENIG gold
  hasl: '#c9cdd2',
  silk: '#f4f4ef',
  hole: '#0b0f14',
  bareCopper: '#c77b3f'
}
