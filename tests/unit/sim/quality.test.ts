import { describe, expect, it } from 'vitest'
import { RenderQuality, SETTLE_MS } from '@renderer/sim/quality'

/** 20 idle frames at the screen rate, then `n` frames drawn back to back `drawMs` apart. */
function run(q: RenderQuality, screenMs: number, drawMs: number, n: number, dpr = 2): number {
  let t = 0
  for (let i = 0; i < 20; i++) q.frame((t += screenMs), dpr, false, false)
  let last = 0
  for (let i = 0; i < n; i++) last = q.frame((t += drawMs), dpr, true, true)!
  return last
}

describe('adaptive simulation resolution (D-042)', () => {
  it('drawing slower than the screen lowers the resolution', () => {
    expect(run(new RenderQuality(), 1000 / 60, 60, 60)).toBeLessThan(0.6)
  })

  it('a 30 Hz screen (or remote desktop) that keeps up is not blurred', () => {
    expect(run(new RenderQuality(), 1000 / 30, 1000 / 30, 200)).toBe(1)
  })

  it('fast frames climb back to the moving maximum', () => {
    expect(run(new RenderQuality(), 1000 / 60, 1000 / 60, 300, 1)).toBe(1)
  })

  it('frames that wait for the simulation (not drawn back to back) do not blur it', () => {
    const q = new RenderQuality()
    const start = q.level
    let t = 0
    for (let i = 0; i < 200; i++) {
      t += 1000 / 60
      // a new simulation result every third screen refresh
      q.frame(t, 2, i % 3 === 0, false)
    }
    expect(q.level).toBeGreaterThanOrEqual(start)
  })

  it('a still picture is drawn sharp exactly once', () => {
    const q = new RenderQuality()
    run(q, 1000 / 60, 60, 10)
    const t = 20 * (1000 / 60) + 10 * 60
    expect(q.frame(t + 50, 2, false, false)).toBeNull()
    expect(q.frame(t + SETTLE_MS + 60, 2, false, false)).toBe(2)
    expect(q.frame(t + SETTLE_MS + 120, 2, false, false)).toBeNull()
  })
})
