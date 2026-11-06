/** Geometry helpers shared by the probe preview, heat map and 3D surface (all in WORK coordinates). */
import { useMemo } from 'react'
import type {
  BBox,
  HeightMap,
  ImportedLayer,
  Material,
  Path,
  PolygonSet,
  ProbeGridConfig
} from '@core/model/types'
import { applyAffine, bboxIsEmpty, rings, transformPolygonSet } from '@core/geometry'
import { boardToWorkTransform, buildOutline, stockRectInWork } from '@core/toolpath'
import { heightMapStats, probePoints } from '@core/heightmap'
import { interpolateTurbo } from 'd3-scale-chromatic'
import { useProject } from '@renderer/store/project'
import { useBoardBBox, useLayersWithParsed } from '@renderer/store/controller'

export interface WorkScene {
  stock: BBox
  /** Board bounding box in work coordinates for the chosen side. */
  board: BBox
  /** Board outline rings in work coordinates (falls back to the bbox rectangle). */
  outline: Path[]
  /** The board's real shape (filled) in work coordinates, e.g. a disc for a round board. */
  shape: PolygonSet
}

function transformedBBox(paths: Path[]): BBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of paths)
    for (const q of p) {
      minX = Math.min(minX, q.x)
      minY = Math.min(minY, q.y)
      maxX = Math.max(maxX, q.x)
      maxY = Math.max(maxY, q.y)
    }
  return { minX, minY, maxX, maxY }
}

export function buildWorkScene(
  layers: ImportedLayer[],
  material: Material,
  bbox: BBox,
  side: 'top' | 'bottom'
): WorkScene | null {
  if (bboxIsEmpty(bbox)) return null
  const m = boardToWorkTransform(material, bbox, side)
  const rect: Path = [
    { x: bbox.minX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.maxY },
    { x: bbox.minX, y: bbox.maxY }
  ]
  const outlineLayers = layers.filter((l) => l.type === 'outline' && l.parsed)
  let src: Path[] = []
  for (const l of outlineLayers) {
    const p = l.parsed!
    if (p.strokes.length) src.push(...p.strokes.map((s) => s.path))
    else src.push(...rings(p.geometry).map((r) => [...r, r[0]]))
  }
  // Very large outlines are simplified by stride so the SVG / canvas stays light.
  const total = src.reduce((a, p) => a + p.length, 0)
  if (total > 4000) {
    const stride = Math.ceil(total / 4000)
    src = src.map((p) => p.filter((_, i) => i % stride === 0 || i === p.length - 1))
  }
  if (!src.length) src = [[...rect, rect[0]]]
  const outline = src.map((p) => p.map((q) => applyAffine(m, q)))
  return {
    stock: stockRectInWork(material, bbox),
    board: transformedBBox([rect.map((q) => applyAffine(m, q))]),
    outline,
    shape: transformPolygonSet(m, buildOutline(outlineLayers, bbox).shape)
  }
}

/** Scene for the current project and side; null when no board/material yet. */
export function useWorkScene(side: 'top' | 'bottom'): WorkScene | null {
  const layers = useLayersWithParsed()
  const material = useProject((s) => s.material)
  const bbox = useBoardBBox()
  return useMemo(
    () => (material ? buildWorkScene(layers, material, bbox, side) : null),
    [layers, material, bbox, side]
  )
}

/** Board area plus a margin, clamped to the stock. */
export function boardProbeArea(scene: WorkScene, margin = 2): BBox {
  const { board, stock } = scene
  return {
    minX: Math.max(stock.minX, board.minX - margin),
    minY: Math.max(stock.minY, board.minY - margin),
    maxX: Math.min(stock.maxX, board.maxX + margin),
    maxY: Math.min(stock.maxY, board.maxY + margin)
  }
}

/** Whole stock minus an inset (keeps the probe away from clamps and the sheet edge). */
export function stockProbeArea(scene: WorkScene, inset = 3): BBox {
  const { stock } = scene
  const ix = Math.min(inset, (stock.maxX - stock.minX) / 4)
  const iy = Math.min(inset, (stock.maxY - stock.minY) / 4)
  return { minX: stock.minX + ix, minY: stock.minY + iy, maxX: stock.maxX - ix, maxY: stock.maxY - iy }
}

/** Estimated probing time in seconds. */
export function estimateProbeSeconds(
  cfg: ProbeGridConfig,
  rapidXY: number,
  rapidZ: number,
  retouch?: { lift: number; feed: number }
): number {
  const pts = probePoints(cfg)
  const n = pts.length
  let travel = 0
  for (let i = 1; i < pts.length; i++) travel += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  const clear = Math.max(cfg.clearanceZ, 0.2)
  const feed = cfg.probeFeed > 0 ? cfg.probeFeed : 50
  // Down at probe speed (from clearance to the copper), back up at rapid, plus settle overhead.
  const again = retouch ? (retouch.lift / Math.min(feed, retouch.feed)) * 60 + 0.3 : 0
  const perPoint = (clear / feed) * 60 + (clear / Math.max(rapidZ, 1)) * 60 + 0.4 + again
  return n * perPoint + (travel / Math.max(rapidXY, 1)) * 60 * 1.3
}

// ───────────────────────────────────────── colour map

export type Rgb = [number, number, number]

const LUT: Rgb[] = Array.from({ length: 256 }, (_, i) => {
  const s = interpolateTurbo(i / 255)
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(s)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  const hex = /#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(s)
  return hex ? [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)] : [128, 128, 128]
})

/** Turbo colour for t ∈ [0,1]. */
export function turbo(t: number): Rgb {
  const i = Math.max(0, Math.min(255, Math.round((Number.isFinite(t) ? t : 0) * 255)))
  return LUT[i]
}

export function turboCss(t: number): string {
  const [r, g, b] = turbo(t)
  return `rgb(${r},${g},${b})`
}

export interface MapRange {
  min: number
  max: number
  range: number
  mean: number
  /** Normalise z to [0,1] (flat maps return 0.5). */
  norm(z: number): number
}

export function mapRange(map: HeightMap): MapRange {
  const s = heightMapStats(map)
  return { ...s, norm: (z) => (s.range > 1e-9 ? (z - s.min) / s.range : 0.5) }
}

/** µm string with sign, e.g. "+42 µm". */
export function um(mm: number, signed = false): string {
  const v = Math.round(mm * 1000)
  return `${signed && v > 0 ? '+' : ''}${v} µm`
}
