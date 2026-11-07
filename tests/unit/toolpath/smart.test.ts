import { describe, expect, it } from 'vitest'
import type { Path, PolygonSet, Toolpath } from '@core/model/types'
import {
  applyAffine,
  difference,
  offset,
  pointInPolygonSet,
  polygonSetBBox,
  rectPath,
  strokePaths,
  transformPolygonSet,
  unionPaths
} from '@core/geometry'
import { boardToWorkTransform, generateToolpath, gapCenterlines } from '@core/toolpath'
import { effectiveCutWidth } from '@core/tools'
import { layer, machine, material, step, tool } from './fixtures'

const vbit = (() => {
  const t = tool('vbit', 1)
  t.geometry.tipAngle = 10
  t.geometry.tipDiameter = 0.1
  return t
})()
const DEPTH = 0.03

function run(
  copper: PolygonSet,
  smart: boolean,
  extra = 0
): {
  tp: Toolpath
  cuts: Path[]
  work: PolygonSet
  toWork: (x: number, y: number) => { x: number; y: number }
} {
  const bb = polygonSetBBox(copper)
  const mat = material({
    width: bb.maxX - bb.minX + 10,
    height: bb.maxY - bb.minY + 10,
    offsetX: 5,
    offsetY: 5,
    doubleSided: false
  })
  const st = step('isolate', ['cu'], { cutDepth: DEPTH })
  st.params.isolation = { ...st.params.isolation, passes: 1, smart, smartMaxGap: 1, extraClearance: extra }
  const tp = generateToolpath({
    step: st,
    tool: vbit,
    layers: [layer('cu', 'copper', copper)],
    material: mat,
    machine: machine(),
    boardBBox: bb
  })
  // the grooves actually cut (feed moves below the surface)
  const cuts: Path[] = []
  for (const s of tp.segments) {
    let cur: Path = []
    for (const m of s.moves) {
      if (m.kind !== 'rapid' && m.kind !== 'retract' && m.kind !== 'dwell' && m.z < 0)
        cur.push({ x: m.x, y: m.y })
      else {
        if (cur.length > 1) cuts.push(cur)
        cur = m.z < 0 ? [{ x: m.x, y: m.y }] : []
      }
    }
    if (cur.length > 1) cuts.push(cur)
  }
  const M = boardToWorkTransform(mat, bb, 'top')
  return { tp, cuts, work: transformPolygonSet(M, copper), toWork: (x, y) => applyAffine(M, { x, y }) }
}

/** Groups of copper features still joined by uncut copper (each group > 1 = a short). */
function shorts(work: PolygonSet, cuts: Path[]): number {
  const w = effectiveCutWidth(vbit, DEPTH)
  const b = polygonSetBBox(work)
  const area = [
    {
      outer: rectPath((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, b.maxX - b.minX + 6, b.maxY - b.minY + 6),
      holes: []
    }
  ]
  const left = difference(area, strokePaths(cuts, w))
  const owner = new Map<number, number>()
  for (const poly of work) {
    const p = offset([poly], -0.005)[0]?.outer[0]
    if (!p) continue
    const k = left.findIndex((r) => pointInPolygonSet(p, [r]))
    owner.set(k, (owner.get(k) ?? 0) + 1)
  }
  return [...owner.values()].filter((n) => n > 1).length
}

/** How many grooves cross the straight line between two points. */
function crossings(cuts: Path[], a: { x: number; y: number }, b: { x: number; y: number }): number {
  let n = 0
  const side = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number }
  ): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  for (const c of cuts)
    for (let i = 1; i < c.length; i++)
      if (
        side(a, b, c[i - 1]) * side(a, b, c[i]) < 0 &&
        side(c[i - 1], c[i], a) * side(c[i - 1], c[i], b) < 0
      )
        n++
  return n
}

describe('smart clearance (D-034)', () => {
  it('finds the middle of a gap', () => {
    const lines = gapCenterlines(
      unionPaths([rectPath(0, 0, 2, 2)]).concat(unionPaths([rectPath(2.3, 0, 2, 2)])),
      { maxGap: 1 }
    )
    expect(lines).toHaveLength(1)
    for (const p of lines[0]) expect(p.x).toBeCloseTo(1.15, 3)
  })

  it('cuts a narrow gap once, in its middle; a wide gap along both sides', () => {
    // two traces 0.4 mm apart, a third 3 mm away
    const copper = unionPaths([rectPath(10, 10, 10, 1), rectPath(10, 11.4, 10, 1), rectPath(10, 15.4, 10, 1)])
    const smart = run(copper, true)
    const normal = run(copper, false)
    expect(shorts(smart.work, smart.cuts)).toBe(0)
    expect(shorts(normal.work, normal.cuts)).toBe(0)
    // work coordinates: the board's min corner is at (5, 5)
    const yA = 5 + 0.5 // middle of the first trace
    const yB = 5 + 1.9 // middle of the second
    const yC = 5 + 5.9 // the far one
    const x = 5 + 5
    expect(crossings(normal.cuts, { x, y: yA }, { x, y: yB })).toBe(2)
    expect(crossings(smart.cuts, { x, y: yA }, { x, y: yB })).toBe(1)
    expect(crossings(smart.cuts, { x, y: yB }, { x, y: yC })).toBe(2)
    expect(smart.tp.stats.cutLength).toBeLessThan(normal.tp.stats.cutLength)
  })

  it('keeps a thermal relief and a pad inside a copper pour isolated', () => {
    const pour = difference(unionPaths([rectPath(0, 0, 20, 20)]), unionPaths([rectPath(0, 0, 3.4, 3.4)]))
    // the pad, and a spoke-connected pad (thermal) in another hole of the same pour
    const pad = unionPaths([rectPath(0, 0, 2.6, 2.6)])
    const thermalHole = difference(
      unionPaths([rectPath(6, 0, 3.4, 3.4)]),
      unionPaths([rectPath(6, 0, 2.6, 2.6), rectPath(6, 0, 0.5, 4)])
    )
    const copper = unionPaths([...pour.flatMap((p) => [p.outer, ...p.holes])], true)
    const all = [...difference(copper, thermalHole), ...pad]
    const r = run(all, true)
    expect(shorts(r.work, r.cuts)).toBe(0)
  })

  it('still cuts a thermal slot that the extra clearance would close', () => {
    // pour with a 0.25 mm wide thermal slot around a spoke-connected pad
    const slotted = difference(
      unionPaths([rectPath(0, 0, 20, 20)]),
      difference(
        unionPaths([rectPath(0, 0, 3.1, 3.1)]),
        unionPaths([rectPath(0, 0, 2.6, 2.6), rectPath(0, 0, 0.5, 4)])
      )
    )
    const r = run([...slotted, ...unionPaths([rectPath(15, 15, 2, 2)])], true, 0.1)
    expect(shorts(r.work, r.cuts)).toBe(0)
    // a line from the pad across the slot on its right side meets the slot cut
    expect(crossings(r.cuts, r.toWork(0.9, 0.6), r.toWork(2.2, 0.6))).toBeGreaterThanOrEqual(1)
  })

  it('keeps three features that meet in one spot isolated', () => {
    const copper = unionPaths([rectPath(10, 10, 2, 2), rectPath(12.6, 10, 2, 2), rectPath(11.3, 7.5, 4, 1.6)])
    const r = run(copper, true)
    expect(shorts(r.work, r.cuts)).toBe(0)
  })
})
