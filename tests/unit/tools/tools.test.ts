import { describe, expect, it } from 'vitest'
import {
  STARTER_TOOLS,
  TOOL_FIELD_HELP,
  TOOL_TYPE_INFO,
  createTool,
  duplicateTool,
  effectiveCutWidth,
  validateTool
} from '@core/tools'
import type { ToolType } from '@core/model/types'

describe('starter kit', () => {
  it('every starter tool is valid and built-in', () => {
    for (const t of STARTER_TOOLS) {
      expect(validateTool(t), t.id).toEqual([])
      expect(t.builtIn).toBe(true)
    }
  })
  it('has unique ids and tool numbers', () => {
    expect(new Set(STARTER_TOOLS.map((t) => t.id)).size).toBe(STARTER_TOOLS.length)
    expect(new Set(STARTER_TOOLS.map((t) => t.number)).size).toBe(STARTER_TOOLS.length)
  })
  it('contains the expected kit', () => {
    const ids = STARTER_TOOLS.map((t) => t.id)
    for (const id of [
      'starter-vbit-30-0.1',
      'starter-vbit-90-0.2',
      'starter-flat-3.175',
      'starter-ball-2.0',
      'starter-drill-0.6',
      'starter-drill-3.0',
      'starter-corn-1.0'
    ])
      expect(ids).toContain(id)
    expect(STARTER_TOOLS.filter((t) => t.type === 'vbit')).toHaveLength(6)
    expect(STARTER_TOOLS.filter((t) => t.type === 'flat')).toHaveLength(7)
    expect(STARTER_TOOLS.filter((t) => t.type === 'ball')).toHaveLength(2)
    expect(STARTER_TOOLS.filter((t) => t.type === 'drill')).toHaveLength(13)
    expect(STARTER_TOOLS.filter((t) => t.type === 'corn')).toHaveLength(5)
  })
  it('V-bit 30/0.1 has conservative feeds and cuts ~0.15 mm at 0.1 depth', () => {
    const v = STARTER_TOOLS.find((t) => t.id === 'starter-vbit-30-0.1')!
    expect(v.feeds.spindleRpm).toBe(12000)
    expect(v.feeds.feedXY).toBeGreaterThanOrEqual(150)
    expect(v.feeds.feedXY).toBeLessThanOrEqual(300)
    expect(v.feeds.feedZ).toBeGreaterThanOrEqual(50)
    expect(v.feeds.feedZ).toBeLessThanOrEqual(100)
    expect(effectiveCutWidth(v, 0.1)).toBeCloseTo(0.1 + 0.2 * Math.tan(Math.PI / 12), 6)
  })
})

describe('createTool / duplicateTool / validateTool', () => {
  it('creates a valid tool of every type and applies overrides', () => {
    for (const type of Object.keys(TOOL_TYPE_INFO) as ToolType[]) {
      const t = createTool(type)
      expect(t.type).toBe(type)
      expect(t.builtIn).toBe(false)
      expect(validateTool(t)).toEqual([])
    }
    const t = createTool('flat', {
      id: 'x',
      geometry: { diameter: 0.5, fluteLength: 2, flutes: 2 },
      feeds: { ...STARTER_TOOLS[7].feeds, feedXY: 99 }
    })
    expect(t.id).toBe('x')
    expect(t.geometry.diameter).toBe(0.5)
    expect(t.feeds.feedXY).toBe(99)
    expect(t.feeds.spindleRpm).toBeGreaterThan(0)
  })
  it('duplicates as editable copy without sharing objects', () => {
    const src = STARTER_TOOLS[0]
    const d = duplicateTool(src, 'new')
    expect(d.id).toBe('new')
    expect(d.builtIn).toBe(false)
    expect(d.name).toBe(`${src.name} (copy)`)
    d.feeds.feedXY = 1
    expect(src.feeds.feedXY).not.toBe(1)
  })
  it('reports invalid values', () => {
    const t = createTool('vbit')
    t.geometry.diameter = 0
    t.geometry.tipAngle = 200
    t.feeds.feedXY = 0
    t.feeds.stepOver = 1.5
    const errs = validateTool(t)
    expect(errs.some((e) => /Diameter/.test(e))).toBe(true)
    expect(errs.some((e) => /tip angle/.test(e))).toBe(true)
    expect(errs.some((e) => /Cutting feed/.test(e))).toBe(true)
    expect(errs.some((e) => /Stepover/.test(e))).toBe(true)
  })
  it('has help for every field', () => {
    for (const h of Object.values(TOOL_FIELD_HELP)) expect(h.description.length).toBeGreaterThan(20)
    expect(TOOL_FIELD_HELP['feeds.stepOver']).toBeDefined()
  })
})
