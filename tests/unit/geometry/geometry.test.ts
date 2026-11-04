import {
  circlePath,
  difference,
  offset,
  polygonSetArea,
  rectPath,
  strokePaths,
  union,
  unionPaths,
  transformPolygonSet,
  scale,
  pathArea,
  clipLinesInside,
  pointInPolygonSet,
  arcPoints
} from '@core/geometry'

describe('geometry kernel', () => {
  it('unions overlapping squares', () => {
    const s = unionPaths([rectPath(0, 0, 10, 10), rectPath(5, 0, 10, 10)])
    expect(s).toHaveLength(1)
    expect(polygonSetArea(s)).toBeCloseTo(150, 3)
  })
  it('difference creates a hole', () => {
    const s = difference(unionPaths([rectPath(0, 0, 10, 10)]), unionPaths([rectPath(0, 0, 2, 2)]))
    expect(s).toHaveLength(1)
    expect(s[0].holes).toHaveLength(1)
    expect(polygonSetArea(s)).toBeCloseTo(96, 3)
    expect(pathArea(s[0].outer)).toBeGreaterThan(0)
    expect(pathArea(s[0].holes[0])).toBeLessThan(0)
  })
  it('offsets a square outward with round corners', () => {
    const s = offset(unionPaths([rectPath(0, 0, 10, 10)]), 1)
    expect(polygonSetArea(s)).toBeCloseTo(100 + 40 + Math.PI, 1)
  })
  it('strokes a line with round caps', () => {
    const s = strokePaths(
      [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 }
        ]
      ],
      2
    )
    expect(polygonSetArea(s)).toBeCloseTo(20 + Math.PI, 1)
  })
  it('circle area converges', () => {
    expect(polygonSetArea(unionPaths([circlePath(0, 0, 5)]))).toBeCloseTo(Math.PI * 25, 0)
  })
  it('mirror keeps orientation valid', () => {
    const s = transformPolygonSet(scale(-1, 1), union(unionPaths([rectPath(5, 5, 2, 2)])))
    expect(pathArea(s[0].outer)).toBeGreaterThan(0)
  })
  it('clips lines inside region and point-in-polygon', () => {
    const r = unionPaths([rectPath(0, 0, 10, 10)])
    const pieces = clipLinesInside(
      [
        [
          { x: -10, y: 0 },
          { x: 10, y: 0 }
        ]
      ],
      r
    )
    expect(pieces).toHaveLength(1)
    expect(pointInPolygonSet({ x: 0, y: 0 }, r)).toBe(true)
    expect(pointInPolygonSet({ x: 20, y: 0 }, r)).toBe(false)
  })
  it('arc endpoints are exact', () => {
    const a = arcPoints({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 }, false)
    expect(a[a.length - 1]).toEqual({ x: 0, y: 1 })
    expect(a.every((p) => Math.abs(Math.hypot(p.x, p.y) - 1) < 1e-9)).toBe(true)
  })
})
