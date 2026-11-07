import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ClearanceInfo, PolygonSet } from '@core/model/types'
import { defaultOverlap, maxIsolationDepth, planIsolation, recommendedProbeSpacing } from '@core/cam'
import { analyzeClearance } from '@core/toolpath'
import { parseGerber } from '@core/gerber'
import { rectPath } from '@core/geometry'
import { STARTER_TOOLS } from '@core/tools'

const vbit = STARTER_TOOLS.find((t) => t.id === 'starter-vbit-30-0.1')!
const flat = STARTER_TOOLS.find((t) => t.type === 'flat')!
const cu = { copperThickness: 0.035 }
const info = (clearance: number | null, perimeter = 1000): ClearanceInfo => ({
  clearance,
  atClearance: 10,
  typical: clearance,
  tiny: 0,
  places: 10,
  perimeter
})

/** Pads 1 mm wide in a row, `gap` mm apart, plus one odd pair `odd` mm apart. */
function pads(gap: number, n: number, odd?: number): PolygonSet {
  const out: PolygonSet = []
  let x = 0
  for (let i = 0; i < n; i++) {
    out.push({ outer: rectPath(x + 0.5, 0, 1, 2), holes: [] })
    x += 1 + gap
  }
  if (odd !== undefined) {
    out.push({ outer: rectPath(0.5, 10, 1, 2), holes: [] })
    out.push({ outer: rectPath(1.5 + odd, 10, 1, 2), holes: [] })
  }
  return out
}

describe('copper spacing analysis (D-031)', () => {
  it('finds the narrowest gap and the gap most places share', () => {
    const r = analyzeClearance(pads(0.2, 12, 0.13))
    expect(r.clearance).toBeCloseTo(0.13, 3)
    expect(r.atClearance).toBe(1)
    expect(r.typical).toBeCloseTo(0.2, 3)
    expect(r.places).toBe(12)
    expect(r.perimeter).toBeCloseTo(14 * 6, 3)
  })

  it('does not count copper that (almost) touches as a millable gap', () => {
    const r = analyzeClearance(pads(0.05, 6))
    expect(r.tiny).toBe(5)
    expect(r.clearance).toBeNull()
  })

  it('reports no clearance when everything is wide apart', () => {
    expect(analyzeClearance(pads(2, 4)).clearance).toBeNull()
  })

  it('measures the demo board', () => {
    const text = readFileSync(join(__dirname, '../../../fixtures/boards/demo-kicad/demo-F_Cu.gbr'), 'utf8')
    const r = analyzeClearance(parseGerber(text).geometry)
    expect(r.places).toBeGreaterThan(0)
    expect(r.perimeter).toBeGreaterThan(100)
  })
})

describe('isolation plan from the clearance (D-031)', () => {
  it('limits the depth for narrow gaps', () => {
    expect(maxIsolationDepth(0.15)).toBe(0.05)
    expect(maxIsolationDepth(0.2)).toBe(0.05)
    expect(maxIsolationDepth(0.3)).toBe(0.06)
    expect(maxIsolationDepth(0.4)).toBe(0.07)
    expect(maxIsolationDepth(0.5)).toBe(0.08)
    expect(maxIsolationDepth(0.6)).toBe(0.1)
    expect(maxIsolationDepth(1)).toBe(0.1)
    expect(maxIsolationDepth(null)).toBe(0.1)
  })

  it('0.2 mm gaps: smart clearance (one groove in the middle), 0.05 mm deep', () => {
    const p = planIsolation(vbit, info(0.2), cu)
    expect(p.smart).toBe(true)
    expect(p.smartMaxGap).toBe(1)
    expect(p.cutDepth).toBe(0.05)
    // groove 0.1 + 2*0.05*tan15deg = 0.127
    expect(p.width).toBeCloseTo(0.1268, 3)
    expect(p.extraClearance).toBe(0)
    expect(p.centred).toBe(true)
    expect(p.notes[0]).toMatch(/hard to mill/)
    expect(p.notes.join(' ')).toMatch(/cut ONCE, along its middle/)
  })

  it('a groove wider than the gap is reported, not centred', () => {
    const wide = { ...vbit, geometry: { ...vbit.geometry, tipDiameter: 0.2 } }
    const p = planIsolation(wide, info(0.2), cu)
    expect(p.tooWide).toBe(true)
    expect(p.extraClearance).toBe(0)
    expect(p.notes.join(' ')).toMatch(/finer V-bit/)
  })

  it('wide gaps: two passes unless the second one adds more than 30 min', () => {
    const quick = planIsolation(vbit, info(0.8, 1000), cu)
    expect(quick.passes).toBe(2)
    expect(quick.cutDepth).toBe(0.1)
    expect(quick.extraClearance).toBe(0)
    // 10 m of copper outline at 50 mm/min ≈ 3.7 h per pass
    const slow = planIsolation(vbit, info(0.8, 10000), cu)
    expect(slow.passes).toBe(1)
    expect(slow.notes.join(' ')).toMatch(/second one would add about 3 h/)
  })

  it('overlap follows the tool type', () => {
    expect(defaultOverlap(vbit)).toBe(0.5)
    expect(defaultOverlap(flat)).toBe(0.15)
  })

  it('probe spacing follows the clearance', () => {
    expect(recommendedProbeSpacing(0.2)).toBe(10)
    expect(recommendedProbeSpacing(0.5)).toBe(15)
    expect(recommendedProbeSpacing(1.2)).toBe(20)
    expect(recommendedProbeSpacing(null)).toBe(20)
  })
})
