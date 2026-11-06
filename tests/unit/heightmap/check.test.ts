import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkProbePoints, defaultProbeGrid, importProbeLog, probePoints } from '@core/heightmap'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../../fixtures/heightmap', name), 'utf8')

const grid = { ...defaultProbeGrid({ minX: 0, minY: 0, maxX: 40, maxY: 30 }, 10), probeDepth: -2 }
const plan = probePoints(grid)
const mach3 = (z: (i: number) => number, at = plan): string =>
  at.map((p, i) => `${p.x.toFixed(5)},${p.y.toFixed(5)},${z(i).toFixed(5)}`).join('\n')

describe('probe result checks', () => {
  it('rejects a real Mach3 log where the probe never touched (all points at the depth limit)', () => {
    const r = importProbeLog(fixture('mach3-no-contact.txt'))
    expect(r.map).toBeNull()
    expect(r.errors.join(' ')).toMatch(/never touched/)
  })

  it('rejects all points at the maximum depth of the known program', () => {
    const r = importProbeLog(
      mach3(() => -2),
      grid
    )
    expect(r.map).toBeNull()
    expect(r.errors[0]).toMatch(/all \d+ points stopped at the maximum probe depth/)
  })

  it('rejects when point 1 (the reference) did not touch', () => {
    const r = importProbeLog(
      mach3((i) => (i === 0 ? -2 : -0.01 * i)),
      grid
    )
    expect(r.map).toBeNull()
    expect(r.errors[0]).toMatch(/Point 1/)
  })

  it('leaves a few missed points out and fills them in', () => {
    const r = importProbeLog(
      mach3((i) => (i === 5 ? -2 : 0.001 * i)),
      grid
    )
    expect(r.map).not.toBeNull()
    expect(r.warnings[0]).toMatch(/1 of \d+ point never touched/)
    // the missed cell is interpolated, not -2
    expect(Math.min(...r.map!.z)).toBeGreaterThan(-0.1)
  })

  it('rejects identical heights everywhere', () => {
    const r = importProbeLog(
      mach3(() => -0.25),
      grid
    )
    expect(r.map).toBeNull()
    expect(r.errors[0]).toMatch(/exactly the same height/)
  })

  it('reports points recorded away from where the program sent the machine', () => {
    const stuck = plan.map((p) => ({ ...p, x: Math.max(p.x, 20) }))
    const chk = checkProbePoints(
      stuck.map((p, i) => ({ x: p.x, y: p.y, z: 0.001 * i })),
      grid,
      'mach3'
    )
    expect(chk.errors[0]).toMatch(/recorded somewhere else.*soft limit/)
  })

  it('accepts a good log', () => {
    const r = importProbeLog(
      mach3((i) => 0.002 * Math.sin(i)),
      grid
    )
    expect(r.errors).toEqual([])
    expect(r.map).not.toBeNull()
  })
})
