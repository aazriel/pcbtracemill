import type { Move, Path, Toolpath, ToolpathSegment } from '@core/model/types'
import {
  applyAffine,
  circlePath,
  difference,
  offset,
  pathArea,
  rectPath,
  strokePaths,
  union,
  unionPaths
} from '@core/geometry'
import {
  estimateTime,
  flattenMoves,
  generateAll,
  generateToolpath,
  linearizeArcs,
  alignmentPinPositions,
  stockSideToWork
} from '@core/toolpath'
import { hole, layer, machine, material, step, tool } from './fixtures'

const feedPath = (seg: ToolpathSegment): Path =>
  seg.moves.filter((m) => m.kind === 'feed' && m.z < 0).map((m) => ({ x: m.x, y: m.y }))

function bboxOf(p: Path): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(...p.map((v) => v.x)),
    minY: Math.min(...p.map((v) => v.y)),
    maxX: Math.max(...p.map((v) => v.x)),
    maxY: Math.max(...p.map((v) => v.y))
  }
}

const twoPads = (dx = 10) => unionPaths([rectPath(10, 10, 2, 2), rectPath(10 + dx, 10, 2, 2)])
const boardBBox = { minX: 5, minY: 5, maxX: 25, maxY: 15 }

function isolate(over: Parameters<typeof step>[2] = {}, t = tool('flat', 0.2), geo = twoPads()): Toolpath {
  return generateToolpath({
    step: step('isolate', ['cu'], over),
    tool: t,
    layers: [layer('cu', 'copper', geo)],
    material: material(),
    machine: machine(),
    boardBBox
  })
}

describe('isolation', () => {
  it('creates one ring per pad per pass at the expected offsets', () => {
    const base = step('isolate', ['cu'])
    const tp = isolate({
      params: {
        ...base.params,
        isolation: { passes: 2, overlap: 0.5, direction: 'climb', extraClearance: 0 }
      }
    })
    expect(tp.segments).toHaveLength(4)
    expect(tp.warnings).toEqual([])
    const widths = tp.segments.map((s) => {
      const b = bboxOf(feedPath(s))
      return +(b.maxX - b.minX).toFixed(3)
    })
    // pass 0 offset 0.1 → 2.2 wide, pass 1 offset 0.2 → 2.4 wide (round joins don't change the bbox)
    expect(widths.sort()).toEqual([2.2, 2.2, 2.4, 2.4])
    // the first pass is cut first and work coords are board + (5,5) (bbox min 5 → offset 10)
    const first = bboxOf(feedPath(tp.segments[0]))
    expect(first.minX).toBeCloseTo(13.9, 3)
    for (const s of tp.segments) {
      expect(s.moves[0]).toMatchObject({ kind: 'rapid', z: 5 })
      expect(s.moves.at(-1)).toMatchObject({ kind: 'retract', z: 5 })
      expect(Math.min(...s.moves.map((m) => m.z))).toBeCloseTo(-0.1, 9)
    }
  })

  it('uses the V-bit effective width at depth', () => {
    const tp = isolate({}, tool('vbit', 3))
    const b = bboxOf(feedPath(tp.segments[0]))
    const w = 0.1 + 2 * 0.1 * Math.tan(Math.PI / 6)
    expect(b.maxX - b.minX).toBeCloseTo(2 + w, 3)
  })

  it('climb is clockwise around copper, conventional counter-clockwise, on both sides', () => {
    const base = step('isolate', ['cu'])
    for (const side of ['top', 'bottom'] as const) {
      for (const direction of ['climb', 'conventional'] as const) {
        const tp = isolate({
          side,
          params: { ...base.params, isolation: { passes: 1, overlap: 0.5, direction, extraClearance: 0 } }
        })
        for (const s of tp.segments) {
          const a = pathArea(feedPath(s))
          if (direction === 'climb') expect(a).toBeLessThan(0)
          else expect(a).toBeGreaterThan(0)
        }
      }
    }
  })

  it('bottom side paths are mirrored in work coordinates', () => {
    const tp = isolate({ side: 'bottom' })
    const ys = tp.segments.flatMap((s) => feedPath(s).map((p) => p.y))
    // board y=10 → stock y 15 → mirrored 80 - 15 = 65
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(65, 3)
  })

  it('warns where features are closer than the tool can fit', () => {
    const geo = union(twoPads(2.15), unionPaths([rectPath(40, 10, 2, 2)]))
    const tp = isolate({}, tool('flat', 0.2), geo)
    expect(tp.warnings.join(' ')).toMatch(/^1 place where traces are closer than the 0\.20 mm tool/)
    const ok = isolate({}, tool('flat', 0.2), twoPads(2.25))
    expect(ok.warnings).toEqual([])
  })

  it('counts several narrow places', () => {
    const geo = unionPaths([rectPath(10, 10, 2, 2), rectPath(12.1, 10, 2, 2), rectPath(14.2, 10, 2, 2)])
    const tp = isolate({}, tool('flat', 0.2), geo)
    expect(tp.warnings[0]).toMatch(/^2 places where traces are closer than the 0\.20 mm tool can fit/)
  })

  it('handles a 500-pad board quickly', () => {
    const pads: Path[] = []
    const traces: Path[] = []
    for (let i = 0; i < 25; i++)
      for (let j = 0; j < 20; j++) {
        pads.push(circlePath(5 + i * 3.5, 5 + j * 3, 0.8))
        if (j % 2 === 0)
          traces.push([
            { x: 5 + i * 3.5, y: 5 + j * 3 },
            { x: 5 + i * 3.5, y: 5 + (j + 1) * 3 }
          ])
      }
    const copper = union(unionPaths(pads), strokePaths(traces, 0.3))
    // ground pour with 0.4 mm clearance around every net
    const pour = difference(unionPaths([rectPath(48, 33, 100, 70)]), offset(copper, 0.4))
    const geo = union(copper, pour)
    const t0 = Date.now()
    const tp = generateToolpath({
      step: step('isolate', ['cu'], {
        params: {
          ...step('isolate', []).params,
          isolation: { passes: 2, overlap: 0.4, direction: 'climb', extraClearance: 0 }
        }
      }),
      tool: tool('vbit', 3),
      layers: [layer('cu', 'copper', geo)],
      material: material({ width: 120, height: 90, offsetX: 5, offsetY: 5 }),
      machine: machine(),
      boardBBox: { minX: -2, minY: -2, maxX: 98, maxY: 68 }
    })
    const ms = Date.now() - t0
    expect(tp.segments.length).toBeGreaterThan(500)
    expect(ms).toBeLessThan(8000) // ~1.1 s idle; generous for shared CI runners
  })
})

describe('clear copper', () => {
  const outline = layer('edge', 'outline', [], {
    strokes: [{ path: [...rectPath(15, 10, 30, 20), rectPath(15, 10, 30, 20)[0]], width: 0.1 }]
  })
  it('produces pocket rings, keeps clear of copper and removes small islands', () => {
    const base = step('clear', ['cu'])
    const copper = unionPaths([rectPath(10, 10, 4, 4), rectPath(25, 5, 0.3, 0.3)])
    const tp = generateToolpath({
      step: step('clear', ['cu'], {
        params: { ...base.params, clear: { ...base.params.clear, minIslandArea: 0.5 } }
      }),
      tool: tool('flat', 0.8),
      layers: [layer('cu', 'copper', copper), outline],
      material: material({ offsetX: 0, offsetY: 0 }),
      machine: machine(),
      boardBBox: { minX: 0, minY: 0, maxX: 30, maxY: 20 }
    })
    expect(tp.segments.length).toBeGreaterThan(5)
    expect(tp.warnings.join(' ')).toMatch(/1 copper island/)
    const pts = tp.segments.flatMap(feedPath)
    // tool centre stays ≥ r from the kept pad (8..12 × 8..12)
    for (const p of pts) {
      const dx = Math.max(8 - p.x, 0, p.x - 12)
      const dy = Math.max(8 - p.y, 0, p.y - 12)
      expect(Math.hypot(dx, dy)).toBeGreaterThan(0.4 - 0.01)
    }
    // the small island at (25,5) is cleared: some tool position is within r of it
    expect(pts.some((p) => Math.hypot(p.x - 25, p.y - 5) < 0.4)).toBe(true)
  })

  it('warns about narrow regions left uncleared', () => {
    const copper = unionPaths([rectPath(10, 10, 4, 4), rectPath(14.5, 10, 4, 4)]) // 0.5 mm gap
    const tp = generateToolpath({
      step: step('clear', ['cu']),
      tool: tool('flat', 0.8),
      layers: [layer('cu', 'copper', copper), outline],
      material: material({ offsetX: 0, offsetY: 0 }),
      machine: machine(),
      boardBBox: { minX: 0, minY: 0, maxX: 30, maxY: 20 }
    })
    expect(tp.warnings.join(' ')).toMatch(/narrower than the 0\.80 mm tool remain uncleared/)
  })
})

describe('cutout', () => {
  const r = rectPath(15, 10, 30, 20)
  const edges = r.map((p, i) => ({ path: [p, r[(i + 1) % 4]], width: 0.1 }))
  const inner = rectPath(15, 10, 6, 6)
  const innerEdges = inner.map((p, i) => ({ path: [p, inner[(i + 1) % 4]], width: 0.1 }))
  const run = (tabs: number, withInner = false): Toolpath => {
    const base = step('cutout', ['edge'])
    return generateToolpath({
      step: step('cutout', ['edge'], {
        cutDepth: 1.8,
        params: { ...base.params, cutout: { tabs, tabWidth: 2, tabHeight: 0.6, outside: true } }
      }),
      tool: tool('flat', 2, { stepDown: 0.6 }),
      layers: [layer('edge', 'outline', [], { strokes: withInner ? [...edges, ...innerEdges] : edges })],
      material: material({ offsetX: 0, offsetY: 0 }),
      machine: machine(),
      boardBBox: { minX: 0, minY: 0, maxX: 30, maxY: 20 }
    })
  }

  it('cuts outside the outline in equal depth passes', () => {
    const tp = run(0)
    expect(tp.segments).toHaveLength(1)
    const moves = tp.segments[0].moves
    const levels = [...new Set(moves.filter((m) => m.kind === 'plunge').map((m) => +m.z.toFixed(4)))]
    expect(levels).toEqual([-0.6, -1.2, -1.8])
    const b = bboxOf(feedPath(tp.segments[0]))
    expect(b.minX).toBeCloseTo(-1, 2)
    expect(b.maxX).toBeCloseTo(31, 2)
    expect(pathArea(feedPath(tp.segments[0]).slice(0, 200))).not.toBe(0)
  })

  it('lifts over tabs on passes deeper than thickness - tabHeight, away from corners', () => {
    const tp = run(4)
    const moves = tp.segments[0].moves
    const lifts: Move[] = []
    for (let i = 1; i < moves.length; i++)
      if (moves[i].kind === 'feed' && moves[i].z > moves[i - 1].z + 1e-9) lifts.push(moves[i])
    // two passes (−1.2, −1.8) are below the tab top (−1.0), 4 tabs each
    expect(lifts).toHaveLength(8)
    for (const l of lifts) {
      expect(l.z).toBeCloseTo(-1.0, 9)
      // tab starts on a straight edge, not on the rounded corners
      const onVertical = (Math.abs(l.x + 1) < 1e-6 || Math.abs(l.x - 31) < 1e-6) && l.y > 0 && l.y < 20
      const onHorizontal = (Math.abs(l.y + 1) < 1e-6 || Math.abs(l.y - 21) < 1e-6) && l.x > 0 && l.x < 30
      expect(onVertical || onHorizontal).toBe(true)
    }
    const tabFeeds = moves.filter((m) => m.kind === 'feed' && Math.abs(m.z + 1.0) < 1e-9)
    expect(tabFeeds.length).toBeGreaterThan(0)
  })

  it('cuts inner cut-outs before the outer boundary', () => {
    const tp = run(2, true)
    expect(tp.segments).toHaveLength(2)
    const first = bboxOf(feedPath(tp.segments[0]))
    expect(first.maxX - first.minX).toBeCloseTo(4, 2) // 6 mm hole, tool inside → 4 mm path
    const tabLiftsInner = tp.segments[0].moves.filter((m) => m.kind === 'feed' && Math.abs(m.z + 1.0) < 1e-9)
    expect(tabLiftsInner).toHaveLength(0)
  })

  it('falls back to the board bbox without an outline', () => {
    const tp = generateToolpath({
      step: step('cutout', [], { cutDepth: 1.8 }),
      tool: tool('flat', 2),
      layers: [],
      material: material(),
      machine: machine(),
      boardBBox: { minX: 0, minY: 0, maxX: 30, maxY: 20 }
    })
    expect(tp.segments).toHaveLength(1)
    expect(tp.warnings.join(' ')).toMatch(/bounding box/)
  })
})

describe('drilling', () => {
  const holes = [hole(10, 10, 0.8), hole(20, 10, 0.8), hole(12, 10, 1.0), hole(15, 15, 3.2)]
  const run = (peck: number): Toolpath => {
    const base = step('drill', ['drl'])
    return generateToolpath({
      step: step('drill', ['drl'], {
        cutDepth: 1.7,
        params: {
          ...base.params,
          drill: { peck, retract: 1, minDiameter: 0.7, maxDiameter: 1.1, includeSlots: false }
        }
      }),
      tool: tool('drill', 0.8),
      layers: [layer('drl', 'drill', [], { holes })],
      material: material({ offsetX: 0, offsetY: 0 }),
      machine: machine(),
      boardBBox: { minX: 10, minY: 10, maxX: 20, maxY: 15 }
    })
  }

  it('filters by diameter, orders by nearest neighbour and carries cycle info', () => {
    const tp = run(0)
    expect(tp.segments).toHaveLength(3)
    expect(tp.warnings.join(' ')).not.toMatch(/outside/)
    const xs = tp.segments.map((s) => s.drill!.x)
    expect(xs).toEqual([0, 2, 10])
    for (const s of tp.segments) {
      expect(s.drill).toMatchObject({ depth: 1.7, retract: 1, peck: 0, feed: 100 })
      expect(s.moves.filter((m) => m.kind === 'plunge')).toHaveLength(1)
    }
    expect(tp.segments[0].moves[0]).toMatchObject({ kind: 'rapid', z: 5 })
    expect(tp.segments.at(-1)!.moves.at(-1)).toMatchObject({ kind: 'retract', z: 5 })
    expect(tp.stats.plungeCount).toBe(3)
  })

  it('expands pecks into explicit moves', () => {
    const tp = run(0.5)
    const plunges = tp.segments[0].moves.filter((m) => m.kind === 'plunge').map((m) => m.z)
    expect(plunges).toEqual([-0.5, -1, -1.5, -1.7])
    const retracts = tp.segments[0].moves.filter((m) => m.kind === 'retract').map((m) => m.z)
    expect(retracts).toEqual([1, 1, 1, 1])
    // rapid back down to 0.2 above the previous peck
    const rapids = tp.segments[0].moves.filter((m) => m.kind === 'rapid').map((m) => +m.z.toFixed(6))
    expect(rapids).toContain(-0.3)
  })
})

describe('hole milling', () => {
  it('ramps helically with arcs that end at depth and warns for small holes', () => {
    const tp = generateToolpath({
      step: step('holeMill', ['drl'], { cutDepth: 1.7 }),
      tool: tool('flat', 1.0, { stepDown: 0.6 }),
      layers: [layer('drl', 'drill', [], { holes: [hole(10, 10, 3), hole(20, 10, 0.8)] })],
      material: material({ offsetX: 0, offsetY: 0 }),
      machine: machine(),
      boardBBox: { minX: 10, minY: 10, maxX: 20, maxY: 10 }
    })
    expect(tp.segments).toHaveLength(1)
    expect(tp.warnings.join(' ')).toMatch(/1 hole\(s\) are not larger than the 1\.00 mm tool/)
    const moves = tp.segments[0].moves
    const arcs = moves.filter((m) => m.kind === 'arc-ccw')
    expect(arcs).toHaveLength(8) // 3 levels × 2 halves + final full circle
    for (const a of arcs) expect(Math.hypot(a.x - a.cx!, a.y - a.cy!)).toBeCloseTo(1.0, 9)
    expect(arcs.at(-1)!.z).toBeCloseTo(-1.7, 9)
    expect(arcs.at(-3)!.z).toBeCloseTo(-1.7, 9)
    // monotonic descent
    for (let i = 1; i < arcs.length; i++) expect(arcs[i].z).toBeLessThanOrEqual(arcs[i - 1].z + 1e-12)

    const start = moves[moves.indexOf(arcs[0]) - 1]
    const lin = linearizeArcs(moves, 0.005, { x: moves[0].x, y: moves[0].y, z: moves[0].z })
    expect(lin.some((m) => m.kind === 'arc-ccw' || m.kind === 'arc-cw')).toBe(false)
    const linArcPart = lin
      .slice(lin.indexOf(lin.find((m) => m === start)!) + 1)
      .filter((m) => m.kind === 'feed')
    for (const m of linArcPart.slice(0, -1))
      expect(Math.hypot(m.x - arcs[0].cx!, m.y - arcs[0].cy!)).toBeCloseTo(1.0, 6)
    expect(linArcPart.at(-2)!.z).toBeCloseTo(-1.7, 9)
    // a CCW half circle has ~ πr length
    const t = estimateTime(lin, machine())
    expect(t).toBeGreaterThan(0)
  })
})

describe('alignment', () => {
  it('drills pins with a matching tool and mills them with a smaller one', () => {
    const mat = material()
    const bb = { minX: 0, minY: 0, maxX: 30, maxY: 20 }
    const base = { layers: [], material: mat, machine: machine(), boardBBox: bb }
    const drilled = generateToolpath({
      ...base,
      step: step('alignment', [], { cutDepth: 2.0 }),
      tool: tool('drill', 3)
    })
    const expected = alignmentPinPositions(mat, bb).map((p) => applyAffine(stockSideToWork(mat, 'top'), p))
    const got = drilled.segments.map((s) => ({ x: s.drill!.x, y: s.drill!.y }))
    expect(got).toHaveLength(2)
    for (const e of expected) expect(got.some((g) => Math.hypot(g.x - e.x, g.y - e.y) < 1e-9)).toBe(true)
    expect(drilled.warnings).toEqual([])

    const milled = generateToolpath({
      ...base,
      step: step('alignment', [], { cutDepth: 2.0, side: 'bottom' }),
      tool: tool('flat', 1)
    })
    expect(milled.segments).toHaveLength(2)
    expect(milled.segments[0].moves.some((m) => m.kind === 'arc-ccw')).toBe(true)
    const centres = milled.segments
      .map((s) => s.moves.find((m) => m.kind === 'arc-ccw')!)
      .map((m) => ({ x: m.cx!, y: m.cy! }))
    for (const e of expected) expect(centres.some((g) => Math.hypot(g.x - e.x, g.y - e.y) < 1e-9)).toBe(true)
  })
})

describe('stats and generateAll', () => {
  it('estimates time from feeds and rapids', () => {
    const m = machine({ maxFeedXY: 3000, maxFeedZ: 600 })
    const moves: Move[] = [
      { kind: 'rapid', x: 0, y: 0, z: 5 },
      { kind: 'rapid', x: 0, y: 0, z: 0.5 },
      { kind: 'plunge', x: 0, y: 0, z: -0.5, feed: 60 },
      { kind: 'feed', x: 100, y: 0, z: -0.5, feed: 600 },
      { kind: 'retract', x: 100, y: 0, z: 5 }
    ]
    const t = estimateTime(moves, m, { x: 0, y: 0, z: 5 })
    // plunge 1 mm @ 60 = 1 s; feed 100 mm @ 600 = 10 s × 1.15; rapids 0.45 s + 0.55 s + 2 × 0.05 s → 13.6 s
    expect(t).toBeCloseTo(13.6, 6)
  })

  it('toolpath stats are consistent', () => {
    const tp = isolate()
    const all = flattenMoves(tp)
    expect(all.length).toBeGreaterThan(10)
    expect(tp.stats.cutLength).toBeGreaterThan(2 * 4 * 2)
    expect(tp.stats.rapidLength).toBeGreaterThan(0)
    expect(tp.stats.plungeCount).toBe(2)
    expect(tp.stats.estimatedSeconds).toBeGreaterThan((tp.stats.cutLength / 300) * 60)
  })

  it('skips disabled steps and reports errors per step', () => {
    const res = generateAll({
      steps: [
        { ...step('isolate', ['cu']), id: 'a', toolId: 't-flat-0.2' },
        { ...step('isolate', ['cu']), id: 'b', toolId: 't-flat-0.2', enabled: false },
        { ...step('isolate', ['cu']), id: 'c', toolId: 'missing' },
        { ...step('drill', ['nope']), id: 'd', toolId: 't-flat-0.2' }
      ],
      tools: [tool('flat', 0.2)],
      layers: [layer('cu', 'copper', twoPads())],
      material: material(),
      machine: machine(),
      boardBBox
    })
    expect(res.toolpaths.map((t) => t.stepId)).toEqual(['a'])
    expect(res.errors.map((e) => e.stepId)).toEqual(['c', 'd'])
  })
})
