import { describe, expect, it } from 'vitest'
import { refreshStarterFeeds, STARTER_TOOLS } from '@core/tools'

describe('starter V-bit feeds', () => {
  it('0.1 mm tips cut at 50 mm/min (12 000 rpm)', () => {
    const v = STARTER_TOOLS.find((t) => t.id === 'starter-vbit-60-0.1')!
    expect(v.feeds).toMatchObject({ spindleRpm: 12000, feedXY: 50 })
  })

  it('updates untouched old starter feeds in a project, keeps edited ones', () => {
    const base = STARTER_TOOLS.find((t) => t.id === 'starter-vbit-30-0.1')!
    const old = { ...base, feeds: { ...base.feeds, feedXY: 200, feedZ: 80 } }
    const edited = { ...base, id: 'starter-vbit-60-0.1', feeds: { ...base.feeds, feedXY: 75, feedZ: 80 } }
    const out = refreshStarterFeeds([old, edited])
    expect(out[0].feeds).toMatchObject({ feedXY: 50, feedZ: 20 })
    expect(out[1]).toBe(edited)
    const current = [base]
    expect(refreshStarterFeeds(current)).toBe(current)
  })
})
