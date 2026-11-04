import type { Tool } from '../model/types'

/**
 * Effective cutting width (diameter of the cut at the copper surface, Z0) for a tool
 * plunged `depth` mm below Z0. For V-bits the width grows with depth:
 *   w = tipDiameter + 2 * depth * tan(angle / 2), capped at the shank diameter.
 */
export function effectiveCutWidth(tool: Tool, depth: number): number {
  const g = tool.geometry
  if (tool.type === 'vbit') {
    const half = ((g.tipAngle ?? 60) * Math.PI) / 360
    const w = (g.tipDiameter ?? 0) + 2 * Math.max(0, depth) * Math.tan(half)
    return Math.min(g.diameter, Math.max(w, 1e-3))
  }
  return g.diameter
}

/**
 * Radius of the tool profile at height `h` above the tool tip (used by the simulator).
 * Returns the cutter radius that removes material at that height.
 */
export function toolRadiusAtHeight(tool: Tool, h: number): number {
  const g = tool.geometry
  const R = g.diameter / 2
  if (h < 0) return 0
  switch (tool.type) {
    case 'vbit': {
      const half = ((g.tipAngle ?? 60) * Math.PI) / 360
      return Math.min(R, (g.tipDiameter ?? 0) / 2 + h * Math.tan(half))
    }
    case 'ball':
      return h >= R ? R : Math.sqrt(Math.max(0, R * R - (R - h) * (R - h)))
    case 'drill': {
      const half = ((g.pointAngle ?? 118) * Math.PI) / 360
      return Math.min(R, h * Math.tan(half))
    }
    default:
      return R
  }
}
