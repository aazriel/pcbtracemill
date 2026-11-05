import { describe, expect, it } from 'vitest'
import type { Tool } from '@core/model/types'
import { toolsForStep } from '@core/cam'

const tool = (id: string, type: Tool['type'], d: number, over: Partial<Tool> = {}): Tool => ({
  id,
  name: id,
  type,
  geometry: { diameter: d, fluteLength: 6, flutes: 2 },
  feeds: { spindleRpm: 10000, feedXY: 300, feedZ: 100, stepDown: 0.5, stepOver: 0.4 },
  notes: '',
  builtIn: true,
  number: 1,
  ...over
})

const best = (r: ReturnType<typeof toolsForStep>): string | undefined => r.find((c) => c.best)?.tool.id

describe('toolsForStep with the step numbers', () => {
  const drills = [
    tool('d04', 'drill', 0.4),
    tool('d08', 'drill', 0.8),
    tool('d09', 'drill', 0.9),
    tool('d10', 'drill', 1)
  ]

  it('recommends the drill of the hole size, then slightly larger ones', () => {
    const r = toolsForStep('drill', drills, { holeDiameters: [0.8, 0.8, 0.8] })
    expect(best(r)).toBe('d08')
    expect(
      r
        .filter((c) => c.recommended)
        .map((c) => c.tool.id)
        .sort()
    ).toEqual(['d08', 'd09'])
    expect(r.find((c) => c.tool.id === 'd04')!.reason).toMatch(/too small/)
  })

  it('prefers your own tools for the best choice', () => {
    const own = tool('my09', 'drill', 0.9, { builtIn: false })
    expect(best(toolsForStep('drill', [...drills, own], { holeDiameters: [0.8] }))).toBe('my09')
  })

  it('hole milling: widest end mill that fits the smallest hole and is long enough', () => {
    const mills = [
      tool('f08', 'flat', 0.8),
      tool('f15', 'flat', 1.5),
      tool('f20', 'flat', 2, { geometry: { diameter: 2, fluteLength: 1, flutes: 2 } })
    ]
    const r = toolsForStep('holeMill', mills, { holeDiameters: [2.0, 3.2], thickness: 1.6 })
    expect(best(r)).toBe('f15')
    expect(r.find((c) => c.tool.id === 'f20')!.recommended).toBe(false)
  })

  it('cutout: a bit too short to cut through is not recommended', () => {
    const r = toolsForStep(
      'cutout',
      [
        tool('c15', 'corn', 1.5, { geometry: { diameter: 1.5, fluteLength: 1, flutes: 2 } }),
        tool('c20', 'corn', 2)
      ],
      {
        thickness: 1.6
      }
    )
    expect(best(r)).toBe('c20')
    expect(r.find((c) => c.tool.id === 'c15')!.reason).toMatch(/cannot cut through/)
  })

  it('alignment: drill of the pin size', () => {
    const r = toolsForStep('alignment', [tool('d30', 'drill', 3), tool('d32', 'drill', 3.2)], {
      pinDiameter: 3
    })
    expect(best(r)).toBe('d30')
  })
})
