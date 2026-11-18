import { describe, expect, it } from 'vitest'
import type { Tool } from '@core/model/types'
import {
  groupHolesByDrill,
  pickAlignmentTool,
  pickCutoutTool,
  pickHoleMillTool,
  pickIsolationTool
} from '@core/cam/recipe'
import { STARTER_TOOLS } from '@core/tools'

const own = (base: Tool, over: Partial<Tool> = {}, geo: Partial<Tool['geometry']> = {}): Tool => ({
  ...base,
  ...over,
  id: `my-${base.id}`,
  name: `My ${base.name}`,
  builtIn: false,
  geometry: { ...base.geometry, ...geo }
})
const kit = STARTER_TOOLS
const first = (type: Tool['type']): Tool => kit.find((t) => t.type === type)!

describe('the recipe prefers your own tools', () => {
  it('isolation: your own V-bit (10° 0.1 mm) over the kit 30° V-bit', () => {
    const mine = own(first('vbit'), {}, { tipAngle: 10, tipDiameter: 0.1 })
    expect(pickIsolationTool([...kit, mine])?.id).toBe(mine.id)
    expect(pickIsolationTool(kit)?.builtIn).toBe(true)
  })

  it('cutout: your own corn bit in the 1–2 mm range', () => {
    const corn = kit.find((t) => t.type === 'corn')!
    const mine = own(corn, {}, { diameter: 1.2 })
    expect(pickCutoutTool([...kit, mine])?.id).toBe(mine.id)
  })

  it('drilling: your own drill of the same size, never a different size', () => {
    const d = kit.filter((t) => t.type === 'drill')[0]
    const same = own(d)
    const g = groupHolesByDrill([d.geometry.diameter], [...kit, same]).groups
    expect(g[0].tool.id).toBe(same.id)
    const bigger = own(d, {}, { diameter: d.geometry.diameter + 0.3 })
    expect(groupHolesByDrill([d.geometry.diameter], [...kit, bigger]).groups[0].tool.builtIn).toBe(true)
  })

  it('alignment and hole milling: own tool of the right size first', () => {
    const d = kit.find((t) => t.type === 'drill')!
    const pin = own(d, {}, { diameter: 3 })
    expect(pickAlignmentTool([...kit, pin], 3)?.id).toBe(pin.id)
    const fl = kit.find((t) => t.type === 'flat')
    if (fl) {
      const best = pickHoleMillTool(kit, 10)!
      const mine = own(best)
      expect(pickHoleMillTool([...kit, mine], 10)?.id).toBe(mine.id)
    }
  })
})
