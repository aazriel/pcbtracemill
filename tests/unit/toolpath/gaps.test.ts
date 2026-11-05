import { describe, expect, it } from 'vitest'
import { rectPath } from '@core/geometry'
import { narrowestGap } from '@core/toolpath'
import type { PolygonSet } from '@core/model/types'

const pads = (...centres: number[]): PolygonSet =>
  centres.map((cx) => ({ outer: rectPath(cx, 0, 1, 1), holes: [] }))

describe('narrowestGap', () => {
  it('measures the closest distance between two copper features', () => {
    // 1 mm squares centred 1.3 mm and 2.0 mm apart -> gaps of 0.3 and 1.0 mm
    const gap = narrowestGap(pads(0, 1.3, 3.3), 1.2)
    expect(gap).not.toBeNull()
    expect(gap!).toBeCloseTo(0.3, 2)
  })

  it('returns null when nothing is closer than the limit', () => {
    expect(narrowestGap(pads(0, 3), 1)).toBeNull()
  })

  it('skips gaps narrower than ignoreBelow', () => {
    const gap = narrowestGap(pads(0, 1.1, 2.6), 1, 0.15)
    expect(gap!).toBeCloseTo(0.5, 2)
  })
})
