import type { SimMove, Tool, ToolType } from '@core/model/types'

export function makeTool(
  id: string,
  type: ToolType,
  diameter: number,
  extra: Partial<Tool['geometry']> = {}
): Tool {
  return {
    id,
    name: id,
    type,
    geometry: { diameter, fluteLength: 5, flutes: 2, ...extra },
    feeds: { spindleRpm: 10000, feedXY: 300, feedZ: 100, stepDown: 0.1, stepOver: 0.5 },
    notes: '',
    builtIn: false,
    number: 1
  }
}

/** Builds SimMoves from a polyline of points (feed at 600 mm/min = 10 mm/s). */
export function movesFrom(
  pts: [number, number, number][],
  toolId: string,
  stepId = 'step1',
  feed = 600,
  t0 = 0,
  line0 = 0
): SimMove[] {
  const out: SimMove[] = []
  let t = t0
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]
    const b = pts[k]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    t += len / (feed / 60)
    out.push({ line: line0 + k, kind: 'feed', from: a, to: b, feed, toolId, stepId, tEnd: t })
  }
  return out
}
