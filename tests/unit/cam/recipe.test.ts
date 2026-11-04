import { describe, expect, it } from 'vitest'
import { defaultMaterial, groupHolesByDrill, recipe, validateStep } from '@core/cam'
import { STARTER_TOOLS } from '@core/tools'
import { MACHINE_PRESETS } from '@core/machines'
import { layer } from './fixtures'

const machine = MACHINE_PRESETS[0]
const idGen = () => {
  let n = 0
  return () => `s${++n}`
}

describe('recipe', () => {
  const layers = [
    layer('top', 'copper', 'top'),
    layer('bot', 'copper', 'bottom'),
    layer('drl', 'drill', 'all', [0.3, 0.8, 0.8, 1.0, 1.02, 3.0, 4.2]),
    layer('edge', 'outline', 'all')
  ]
  const material = {
    ...defaultMaterial({ minX: 0, minY: 0, maxX: 50, maxY: 40 }),
    doubleSided: true
  }
  material.alignment = { ...material.alignment, enabled: true }

  it('double-sided: alignment → top → bottom → cutout', () => {
    const steps = recipe({ layers, tools: STARTER_TOOLS, material, machine, newId: idGen() })
    const seq = steps.map((s) => `${s.kind}:${s.side}`)
    expect(seq[0]).toBe('alignment:top')
    expect(seq[1]).toBe('isolate:top')
    expect(seq.at(-2)).toBe('isolate:bottom')
    expect(seq.at(-1)).toBe('cutout:bottom')
    const middle = seq.slice(2, -2)
    expect(
      middle.every((s) => s.endsWith(':top') && (s.startsWith('drill') || s.startsWith('holeMill')))
    ).toBe(true)
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length)

    expect(steps[0].toolId).toBe('starter-drill-3.0')
    expect(steps[1].toolId).toBe('starter-vbit-30-0.1')
    expect(steps.at(-1)!.toolId).toBe('starter-corn-1.5')
    // 0.3 → 0.3 drill, 0.8 → 0.8; 1.0,1.02 → 1.0; 3.0 → 3.0; 4.2 → hole milling
    const drills = steps.filter((s) => s.kind === 'drill').map((s) => s.toolId)
    expect(drills).toEqual([
      'starter-drill-0.3',
      'starter-drill-0.8',
      'starter-drill-1.0',
      'starter-drill-3.0'
    ])
    const hm = steps.find((s) => s.kind === 'holeMill')!
    expect(hm.params.holeMill.minDiameter).toBeCloseTo(4.199)
    const ctx = { layers, tools: STARTER_TOOLS, material, machine }
    for (const s of steps)
      expect(
        validateStep(s, ctx).level,
        `${s.name}: ${JSON.stringify(validateStep(s, ctx).issues)}`
      ).not.toBe('error')
  })

  it('single-sided top board has no alignment and cuts out from top', () => {
    const m = defaultMaterial({ minX: 0, minY: 0, maxX: 50, maxY: 40 })
    const steps = recipe({
      layers: [layers[0], layers[2], layers[3]],
      tools: STARTER_TOOLS,
      material: m,
      machine,
      newId: idGen()
    })
    expect(steps.some((s) => s.kind === 'alignment')).toBe(false)
    expect(steps[0].kind).toBe('isolate')
    expect(steps.at(-1)!.kind).toBe('cutout')
    expect(steps.every((s) => s.side === 'top')).toBe(true)
  })

  it('groupHolesByDrill sends oversize holes to milling', () => {
    const r = groupHolesByDrill([0.9, 5], STARTER_TOOLS)
    expect(r.groups.map((g) => g.tool.id)).toEqual(['starter-drill-0.9'])
    expect(r.toMill).toEqual([5])
  })
})
