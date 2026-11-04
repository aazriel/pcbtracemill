import { useMemo } from 'react'
import type { ImportedLayer, Path, PolygonSet } from '@core/model/types'
import { useLayersWithParsed } from '@renderer/store/controller'

/** SVG path data for the board, in BOARD coordinates (+Y up; the preview applies the flip). */
export interface BoardDrawing {
  /** Outline strokes from outline layers, or null when there is no outline layer. */
  outline: string | null
  /** Top copper (faint), may be empty. */
  copperTop: string
  /** Bottom copper (fainter), may be empty. */
  copperBottom: string
  holes: { x: number; y: number; r: number }[]
}

const MAX_POINTS = 120_000
const f = (v: number): string => (Math.round(v * 1000) / 1000).toString()

function pathD(p: Path, close: boolean): string {
  if (p.length < 2) return ''
  let d = `M${f(p[0].x)} ${f(p[0].y)}`
  for (let i = 1; i < p.length; i++) d += `L${f(p[i].x)} ${f(p[i].y)}`
  return close ? `${d}Z` : d
}

function polysD(set: PolygonSet, budget: { left: number }): string {
  const parts: string[] = []
  for (const poly of set) {
    const n = poly.outer.length + poly.holes.reduce((a, h) => a + h.length, 0)
    if (budget.left - n < 0) break
    budget.left -= n
    parts.push(pathD(poly.outer, true))
    for (const h of poly.holes) parts.push(pathD(h, true))
  }
  return parts.join('')
}

export function buildBoardDrawing(layers: ImportedLayer[]): BoardDrawing {
  const budget = { left: MAX_POINTS }
  const outlineLayers = layers.filter((l) => l.type === 'outline' && l.parsed)
  const outline = outlineLayers
    .flatMap((l) => l.parsed!.strokes.map((s) => pathD(s.path, false)))
    .filter(Boolean)
    .join('')
  const copper = (side: 'top' | 'bottom'): string =>
    layers
      .filter((l) => l.type === 'copper' && l.side === side && l.parsed)
      .map((l) => polysD(l.parsed!.geometry, budget))
      .join('')
  const holes = layers
    .filter((l) => l.type === 'drill' && l.parsed?.drills)
    .flatMap((l) => l.parsed!.drills!.holes.map((h) => ({ x: h.x, y: h.y, r: h.diameter / 2 })))
    .slice(0, 5000)
  return { outline: outline || null, copperTop: copper('top'), copperBottom: copper('bottom'), holes }
}

export function useBoardDrawing(): BoardDrawing {
  const layers = useLayersWithParsed()
  return useMemo(() => buildBoardDrawing(layers), [layers])
}
