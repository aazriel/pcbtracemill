import {
  createStock,
  stampMove,
  takeDirty,
  chooseResolution,
  MAT_COPPER,
  MAT_FR4,
  MAT_THROUGH,
  faceMirrorAffine,
  mirrorCell,
  buildToolProfile,
  profileHeight
} from '@core/sim'
import { makeTool } from './helpers'

const cell = (s: { nx: number; res: number }, x: number, y: number): number =>
  Math.floor(y / s.res) * s.nx + Math.floor(x / s.res)

describe('createStock', () => {
  it('auto resolution keeps cells under budget and is fine for small boards', () => {
    expect(chooseResolution(20, 20)).toBeCloseTo(0.02, 9)
    const r = chooseResolution(100, 80)
    expect(r).toBeGreaterThanOrEqual(0.02)
    expect(r).toBeLessThanOrEqual(0.05)
    expect(Math.ceil(100 / r) * Math.ceil(80 / r)).toBeLessThanOrEqual(4_000_000)
    const s = createStock({ width: 100, height: 80, thickness: 1.6, copperThickness: 0.035 })
    expect(s.nx * s.ny).toBeLessThanOrEqual(4_000_000)
    expect(s.top.every((v) => v === 0)).toBe(true)
  })
})

describe('tool profile', () => {
  it('inverts toolRadiusAtHeight for each type', () => {
    const res = 0.01
    const flat = buildToolProfile(makeTool('f', 'flat', 1), res)
    expect(profileHeight(flat, 0.3)).toBe(0)
    expect(profileHeight(flat, 0.51)).toBe(Infinity)
    const v = buildToolProfile(makeTool('v', 'vbit', 3.175, { tipAngle: 60, tipDiameter: 0.1 }), res)
    expect(profileHeight(v, 0.04)).toBe(0)
    expect(profileHeight(v, 0.5)).toBeCloseTo((0.5 - 0.05) / Math.tan(Math.PI / 6), 3)
    const b = buildToolProfile(makeTool('b', 'ball', 1), res)
    expect(profileHeight(b, 0.3)).toBeCloseTo(0.5 - Math.sqrt(0.25 - 0.09), 3)
    const d = buildToolProfile(makeTool('d', 'drill', 1, { pointAngle: 118 }), res)
    expect(profileHeight(d, 0.3)).toBeCloseTo(0.3 / Math.tan((118 * Math.PI) / 360), 3)
  })
})

describe('stampMove', () => {
  const res = 0.01
  const mk = () =>
    createStock({ width: 10, height: 10, thickness: 1.6, copperThickness: 0.035, resolution: res })

  it('flat end mill cuts a trench of width D with vertical walls', () => {
    const s = mk()
    const tool = makeTool('f', 'flat', 1)
    const rect = stampMove(s, [2, 5, -0.05], [8, 5, -0.05], tool)
    expect(rect).not.toBeNull()
    const i = Math.floor(5 / res)
    let cut = 0
    for (let j = 0; j < s.ny; j++) {
      const cy = (j + 0.5) * res
      const v = s.top[j * s.nx + i]
      const d = Math.abs(cy - 5)
      if (d <= 0.5 - 1e-9) expect(v).toBeCloseTo(-0.05, 6)
      else expect(v).toBe(0)
      if (v < 0) cut++
    }
    expect(cut * res).toBeCloseTo(1, 1)
    // Just outside R untouched, just inside full depth.
    expect(s.top[cell(s, 5, 5.505)]).toBe(0)
    expect(s.top[cell(s, 5, 5.495)]).toBeCloseTo(-0.05, 6)
    // Round ends.
    expect(s.top[cell(s, 1.505, 5.005)]).toBeCloseTo(-0.05, 6)
    expect(s.top[cell(s, 1.495, 5.005)]).toBe(0)
    expect(s.mat[cell(s, 5, 5)]).toBe(MAT_FR4)
    expect(s.mat[cell(s, 5, 6)]).toBe(MAT_COPPER)
    const d = takeDirty(s)
    expect(d).not.toBeNull()
    expect(d!.y1 - d!.y0).toBeGreaterThanOrEqual(99)
    expect(takeDirty(s)).toBeNull()
  })

  it('V-bit 60° at depth 0.1 cuts width tip + 2·0.1·tan30 with sloped walls', () => {
    const s = mk()
    const tip = 0.1
    const tool = makeTool('v', 'vbit', 3.175, { tipAngle: 60, tipDiameter: tip })
    stampMove(s, [2, 5, -0.1], [8, 5, -0.1], tool)
    const tan = Math.tan(Math.PI / 6)
    const expectedWidth = tip + 2 * 0.1 * tan
    const i = Math.floor(5 / res)
    let cut = 0
    for (let j = 0; j < s.ny; j++) {
      const cy = (j + 0.5) * res
      const d = Math.abs(cy - 5)
      const v = s.top[j * s.nx + i]
      const exp = d <= tip / 2 ? -0.1 : Math.min(0, -0.1 + (d - tip / 2) / tan)
      expect(v).toBeCloseTo(exp, 3)
      if (v < -1e-6) cut++
    }
    expect(Math.abs(cut * res - expectedWidth)).toBeLessThanOrEqual(2 * res)
    // Copper remains at the trench edge where the cut is shallower than the copper.
    const edge = 5 + expectedWidth / 2 - 0.005
    expect(s.top[cell(s, 5, edge)]).toBeGreaterThan(-0.035)
    expect(s.mat[cell(s, 5, edge)]).toBe(MAT_COPPER)
    expect(s.mat[cell(s, 5, 5)]).toBe(MAT_FR4)
  })

  it('ball end mill produces a rounded profile', () => {
    const s = mk()
    const tool = makeTool('b', 'ball', 1)
    stampMove(s, [2, 5, -0.3], [8, 5, -0.3], tool)
    const i = Math.floor(5 / res)
    for (let j = 0; j < s.ny; j++) {
      const d = Math.abs((j + 0.5) * res - 5)
      const v = s.top[j * s.nx + i]
      const exp = d < 0.5 ? Math.min(0, -0.3 + 0.5 - Math.sqrt(0.25 - d * d)) : 0
      expect(v).toBeCloseTo(exp, 3)
    }
  })

  it('shallow cut keeps copper, deeper cut exposes FR4', () => {
    const s = mk()
    const tool = makeTool('f', 'flat', 0.5)
    stampMove(s, [2, 2, -0.02], [4, 2, -0.02], tool)
    stampMove(s, [2, 6, -0.04], [4, 6, -0.04], tool)
    expect(s.top[cell(s, 3, 2)]).toBeCloseTo(-0.02, 6)
    expect(s.mat[cell(s, 3, 2)]).toBe(MAT_COPPER)
    expect(s.mat[cell(s, 3, 6)]).toBe(MAT_FR4)
  })

  it('skips moves above the surface and handles plunges', () => {
    const s = mk()
    const drill = makeTool('d', 'drill', 0.8, { pointAngle: 118 })
    expect(stampMove(s, [1, 1, 2], [9, 9, 2], drill)).toBeNull()
    expect(stampMove(s, [5, 5, 1], [5, 5, -0.5], drill)).not.toBeNull()
    expect(s.top[cell(s, 5.005, 5.005)]).toBeCloseTo(-0.5 + 0.005 / Math.tan((59 * Math.PI) / 180), 2)
    expect(s.top[cell(s, 5.5, 5)]).toBe(0)
  })

  it('ramps follow the interpolated tip Z', () => {
    const s = mk()
    const tool = makeTool('f', 'flat', 0.5)
    stampMove(s, [1, 5, 0], [9, 5, -0.8], tool)
    expect(s.top[cell(s, 5.005, 5.005)]).toBeCloseTo(-0.4, 1)
    expect(s.top[cell(s, 8.995, 5.005)]).toBeCloseTo(-0.8, 1)
  })

  it('through-cut sets air and marks the mirrored cell on the other face', () => {
    const top = mk()
    const bottom = mk()
    const m = faceMirrorAffine(10, 10, 'x')
    const tool = makeTool('c', 'flat', 1)
    stampMove(top, [2, 3, -1.7], [4, 3, -1.7], tool, { other: bottom, toOther: m })
    const i = Math.floor(3 / res)
    const j = Math.floor(3 / res)
    expect(top.mat[j * top.nx + i]).toBe(MAT_THROUGH)
    expect(top.top[j * top.nx + i]).toBeCloseTo(-1.6, 6)
    const oc = mirrorCell(top, bottom, m, i, j)
    expect(oc).toBe(j * bottom.nx + (bottom.nx - 1 - i))
    expect(bottom.mat[oc]).toBe(MAT_THROUGH)
    // Same cell on the bottom without mirroring stays intact.
    expect(bottom.mat[j * bottom.nx + i]).toBe(MAT_COPPER)
    expect(takeDirty(bottom)).not.toBeNull()
  })

  it('cuts from both faces that meet inside the board make a through-hole', () => {
    const top = mk()
    const bottom = mk()
    const m = faceMirrorAffine(10, 10, 'x')
    const tool = makeTool('c', 'flat', 1)
    stampMove(top, [5, 5, -1.0], [5, 5, -1.0], tool, { other: bottom, toOther: m })
    expect(top.mat[cell(top, 5, 5)]).toBe(MAT_FR4)
    stampMove(bottom, [5, 5, -0.7], [5, 5, -0.7], tool, { other: top, toOther: m })
    expect(bottom.mat[cell(bottom, 5, 5)]).toBe(MAT_THROUGH)
    expect(top.mat[cell(top, 5, 5)]).toBe(MAT_THROUGH)
    expect(bottom.mat[cell(bottom, 5, 5.6)]).toBe(MAT_COPPER)
  })
})
