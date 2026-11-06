import { describe, expect, it } from 'vitest'
import { circlePath } from '@core/geometry'
import { buildHeightMap, cellsNearShape, defaultProbeGrid, probePoints } from '@core/heightmap'

// a round board of 100 mm diameter centred at (50, 50), grid every 10 mm over its bounding box
const disc = [{ outer: circlePath(50, 50, 50), holes: [] }]
const grid = defaultProbeGrid({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 10)

describe('probe grid that follows the board shape', () => {
  it('skips the corners of a round board but keeps every point near it', () => {
    const cells = cellsNearShape(grid, disc, 2)!
    expect(cells).toBeDefined()
    const pts = probePoints({ ...grid, cells })
    expect(pts.length).toBeLessThan(grid.countX * grid.countY)
    // corners are ~20 mm from the disc: skipped
    expect(pts.some((p) => p.x === 0 && p.y === 0)).toBe(false)
    // every grid point on or inside the disc is measured
    for (const p of probePoints(grid))
      if (Math.hypot(p.x - 50, p.y - 50) <= 50) expect(pts.some((q) => q.x === p.x && q.y === p.y)).toBe(true)
  })

  it('is undefined for a rectangular board (every point is needed)', () => {
    const rect = [{ outer: circlePath(50, 50, 200, 4), holes: [] }]
    expect(cellsNearShape(grid, rect, 2)).toBeUndefined()
  })

  it('builds a full map from the skipped grid, aligning GRBL machine coordinates on the first point', () => {
    const cells = cellsNearShape(grid, disc, 2)!
    const cfg = { ...grid, cells }
    const plane = (x: number, y: number): number => 0.001 * x + 0.002 * y
    const pts = probePoints(cfg).map((p) => ({ x: p.x - 150, y: p.y - 100, z: plane(p.x, p.y) - 30 }))
    const map = buildHeightMap(pts, cfg)
    expect(map.z.every(Number.isFinite)).toBe(true)
    const first = probePoints(cfg)[0]
    const k = first.iy * grid.countX + first.ix
    expect(map.z[k]).toBeCloseTo(0, 6)
    // centre point: measured, relative to the first point
    const c = 5 * grid.countX + 5
    expect(map.z[c]).toBeCloseTo(plane(50, 50) - plane(first.x, first.y), 6)
  })
})
