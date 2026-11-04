import type { SimMove } from '@core/model/types'
import {
  createStock,
  faceMirrorAffine,
  IDENTITY_AFFINE,
  SimRunner,
  MAT_THROUGH,
  rasterizeCopperMask,
  trailPolyline,
  type Affine,
  type SimStock
} from '@core/sim'
import { makeTool, movesFrom } from './helpers'

const vbit = makeTool('v', 'vbit', 3.175, { tipAngle: 30, tipDiameter: 0.1 })
const endmill = makeTool('e', 'flat', 1)
const tools = { v: vbit, e: endmill }

/** Deterministic pseudo-random program: isolation-like zig-zags with ramps, plunges and rapids. */
function program(count: number, w: number, h: number, seed = 1): SimMove[] {
  let s = seed
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  const pts: [number, number, number][] = [[1, 1, 2]]
  let x = 1
  let y = 1
  for (let k = 0; k < count; k++) {
    const r = rnd()
    if (r < 0.02) {
      pts.push([x, y, 2])
      x = 1 + rnd() * (w - 2)
      y = 1 + rnd() * (h - 2)
      pts.push([x, y, 2], [x, y, -0.1])
    } else {
      x = Math.min(w - 1, Math.max(1, x + (rnd() - 0.5) * 2))
      y = Math.min(h - 1, Math.max(1, y + (rnd() - 0.5) * 2))
      pts.push([x, y, r < 0.1 ? -0.05 - rnd() * 0.1 : -0.1])
    }
  }
  return movesFrom(pts, 'v', 'iso')
}

function makeRunner(
  moves: SimMove[],
  w: number,
  h: number,
  res: number,
  extra: { maxCheckpoints?: number } = {}
) {
  return new SimRunner({
    moves,
    tools,
    sides: { iso: 'top', iso2: 'bottom', cut: 'top' },
    stockTop: createStock({ width: w, height: h, thickness: 1.6, copperThickness: 0.035, resolution: res }),
    stockBottom: createStock({
      width: w,
      height: h,
      thickness: 1.6,
      copperThickness: 0.035,
      resolution: res
    }),
    workToStock: { top: IDENTITY_AFFINE, bottom: faceMirrorAffine(w, h, 'x') },
    ...extra
  })
}

function same(a: SimStock | null, b: SimStock | null): boolean {
  if (!a || !b) return false
  if (a.top.length !== b.top.length) return false
  for (let i = 0; i < a.top.length; i++) if (a.top[i] !== b.top[i] || a.mat[i] !== b.mat[i]) return false
  return true
}

describe('SimRunner', () => {
  const moves = program(600, 20, 15)
  const total = moves[moves.length - 1].tEnd

  it('seek forward/backward is deterministic', () => {
    const t1 = total * 0.73 + 0.0123
    const t0 = total * 0.31 + 0.0071
    const direct = makeRunner(moves, 20, 15, 0.03)
    direct.seek(t1)
    const ref = direct.snapshot('top')

    const r = makeRunner(moves, 20, 15, 0.03, { maxCheckpoints: 4 })
    r.seek(t1)
    expect(same(r.snapshot('top'), ref)).toBe(true)
    r.seek(t0)
    r.seek(t1)
    expect(same(r.snapshot('top'), ref)).toBe(true)
    // Random seek sequence, ending at t1.
    for (const f of [0.9, 0.05, 0.5, 0.51, 0.2, 1, 0, 0.74]) r.seek(total * f + 0.003)
    r.seek(t1)
    expect(same(r.snapshot('top'), ref)).toBe(true)
    expect(r.checkpointStats().count).toBeLessThanOrEqual(5)

    // Going back to t0 equals a direct seek to t0.
    const d0 = makeRunner(moves, 20, 15, 0.03)
    d0.seek(t0)
    r.seek(t0)
    expect(same(r.snapshot('top'), d0.snapshot('top'))).toBe(true)
    r.seek(0)
    expect(r.snapshot('top')!.top.every((v) => v === 0)).toBe(true)
  })

  it('partial segments stamp only up to the current time', () => {
    const mv = movesFrom(
      [
        [2, 5, 0.5],
        [2, 5, -0.05],
        [8, 5, -0.05]
      ],
      'e',
      'cut'
    )
    const r = makeRunner(mv, 10, 10, 0.02)
    const tPl = mv[0].tEnd
    r.seek(tPl + (mv[1].tEnd - tPl) / 2) // halfway along X: tool at x = 5
    const s = r.stock('top')!
    const at = (x: number, y: number): number => s.top[Math.floor(y / 0.02) * s.nx + Math.floor(x / 0.02)]
    expect(at(4, 5)).toBeCloseTo(-0.05, 5)
    expect(at(5.4, 5)).toBeCloseTo(-0.05, 5)
    expect(at(5.6, 5)).toBe(0)
    const pos = r.toolPosition(tPl + (mv[1].tEnd - tPl) / 2)!
    expect(pos.x).toBeCloseTo(5, 6)
    expect(pos.z).toBeCloseTo(-0.05, 6)
    expect(pos.line).toBe(2)
    expect(pos.side).toBe('top')
    expect(r.currentLine(0.0001)).toBe(1)
    r.finish()
    expect(at(7.4, 5)).toBeCloseTo(-0.05, 5)
  })

  it('bottom-side moves use the bottom affine and through-cuts appear on both faces', () => {
    const w = 10
    const h = 10
    const cut = movesFrom(
      [
        [3, 3, 1],
        [3, 3, -1.8],
        [3, 6, -1.8]
      ],
      'e',
      'cut'
    )
    const iso = movesFrom(
      [
        [7, 2, 1],
        [7, 2, -0.1],
        [7, 4, -0.1]
      ],
      'e',
      'iso2',
      600,
      cut[cut.length - 1].tEnd
    )
    const r = makeRunner([...cut, ...iso], w, h, 0.02)
    r.finish()
    const top = r.stock('top')!
    const bot = r.stock('bottom')!
    const idx = (s: SimStock, x: number, y: number): number =>
      Math.floor(y / s.res) * s.nx + Math.floor(x / s.res)
    expect(top.mat[idx(top, 3, 4.5)]).toBe(MAT_THROUGH)
    // Through-cut mirrored to the bottom face at (w - x, y).
    expect(bot.mat[idx(bot, w - 3, 4.5)]).toBe(MAT_THROUGH)
    // Bottom isolation at work (7, 3) lands at stock (3, 3) of the bottom face.
    expect(bot.top[idx(bot, 3, 3)]).toBeCloseTo(-0.1, 5)
    expect(top.top[idx(top, 7, 3)]).toBe(0)
    expect(r.toolPosition(r.totalTime)!.side).toBe('bottom')
    expect(r.toolPosition(r.totalTime)!.stockX).toBeCloseTo(3, 6)
    // Dirty regions are transferable copies.
    const reg = r.takeDirtyRegion('bottom')!
    expect(reg.top.length).toBe((reg.x1 - reg.x0) * (reg.y1 - reg.y0))
    expect(r.takeDirtyRegion('bottom')).toBeNull()
  })

  it('performance: 20k short moves on a 100×80 mm stock at 0.05 mm', () => {
    const moves20k = program(20000, 100, 80, 7)
    const tStart = performance.now()
    const r = makeRunner(moves20k, 100, 80, 0.05)
    const tInit = performance.now()
    r.finish()
    const tRun = performance.now()
    r.seek(r.totalTime * 0.5)
    const tBack = performance.now()
    console.log(
      `[sim perf] cells=${r.stock('top')!.nx * r.stock('top')!.ny} moves=${moves20k.length} init=${(tInit - tStart).toFixed(0)}ms ` +
        `finish=${(tRun - tInit).toFixed(0)}ms seekBack=${(tBack - tRun).toFixed(0)}ms checkpoints=${r.checkpointStats().count} ` +
        `ckptMB=${(r.checkpointStats().bytes / 1048576).toFixed(1)}`
    )
    expect(tRun - tInit).toBeLessThan(8000) // ~0.4 s idle; generous for shared CI runners
  })
})

describe('rasterizeCopperMask', () => {
  it('fills polygons with holes (nonzero) through an affine', () => {
    const sq = (x0: number, y0: number, x1: number, y1: number) => [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 }
    ]
    const outer = sq(1, 1, 5, 5)
    const hole = sq(2, 2, 3, 3).reverse()
    const grid = { nx: 100, ny: 100, res: 0.1 }
    const m = rasterizeCopperMask([{ outer, holes: [hole] }], grid)
    let count = 0
    for (const v of m) count += v
    expect(count).toBe(1600 - 100)
    expect(m[25 * 100 + 25]).toBe(0)
    expect(m[15 * 100 + 15]).toBe(1)
    const mir: Affine = faceMirrorAffine(10, 10, 'x')
    const mm = rasterizeCopperMask([{ outer, holes: [hole] }], grid, mir)
    expect(mm[15 * 100 + (99 - 15)]).toBe(1)
    expect(mm[15 * 100 + 15]).toBe(0)
    const st = createStock({
      width: 10,
      height: 10,
      thickness: 1.6,
      copperThickness: 0.035,
      resolution: 0.1,
      copperMask: m
    })
    expect(st.copperMask).toBe(m)
  })
})

describe('trailPolyline', () => {
  it('returns recent points ending at the interpolated position', () => {
    const mv = movesFrom(
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0]
      ],
      'e'
    )
    const t = mv[1].tEnd + (mv[2].tEnd - mv[1].tEnd) / 2
    const p = trailPolyline(mv, t, 10)
    expect(Array.from(p)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0.5, 1, 0])
    const q = trailPolyline(mv, t, 2)
    expect(Array.from(q)).toEqual([1, 1, 0, 0.5, 1, 0])
  })
})
