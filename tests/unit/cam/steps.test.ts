import { describe, expect, it } from 'vitest'
import {
  STEP_KIND_INFO,
  combineValidation,
  createStep,
  defaultMaterial,
  isToolAllowed,
  layersForStep,
  toolsForStep,
  validateStep
} from '@core/cam'
import { STARTER_TOOLS } from '@core/tools'
import { MACHINE_PRESETS } from '@core/machines'
import type { CamStep, StepKind, ToolType } from '@core/model/types'
import { layer } from './fixtures'

const machine = MACHINE_PRESETS[0]
const material = defaultMaterial({ minX: 0, minY: 0, maxX: 50, maxY: 40 })
const layers = [
  layer('top', 'copper', 'top'),
  layer('bot', 'copper', 'bottom'),
  layer('drl', 'drill', 'all', [0.8, 1.0]),
  layer('edge', 'outline', 'all'),
  layer('silk', 'silkscreen', 'top')
]
const tools = STARTER_TOOLS
const tool = (id: string) => tools.find((t) => t.id === id)!
const ctx = { layers, tools, material, machine }

const issuesIn = (s: CamStep, section: string, level = 'error') =>
  validateStep(s, ctx).issues.filter((i) => i.section === section && i.level === level)

describe('tool / step compatibility matrix', () => {
  const matrix: Record<StepKind, ToolType[]> = {
    drill: ['drill'],
    clear: ['flat', 'vbit', 'ball'],
    cutout: ['corn', 'flat'],
    holeMill: ['flat', 'corn'],
    isolate: ['vbit', 'flat', 'ball'],
    alignment: ['drill', 'flat'],
    engrave: ['vbit', 'ball', 'flat']
  }
  const all: ToolType[] = ['flat', 'ball', 'drill', 'vbit', 'corn']
  for (const kind of Object.keys(matrix) as StepKind[]) {
    it(kind, () => {
      for (const type of all) {
        const t = tools.find((x) => x.type === type)!
        const r = isToolAllowed(kind, t)
        expect(r.ok, `${kind}/${type}`).toBe(matrix[kind].includes(type))
        expect(r.message.length).toBeGreaterThan(0)
      }
      const listed = toolsForStep(kind, tools)
      expect(listed.every((x) => matrix[kind].includes(x.tool.type))).toBe(true)
      // recommended first
      const firstNot = listed.findIndex((x) => !x.recommended)
      if (firstNot >= 0) expect(listed.slice(firstNot).every((x) => !x.recommended)).toBe(true)
    })
  }
  it('explains expected tool types', () => {
    expect(isToolAllowed('drill', tool('starter-vbit-30-0.1')).message).toMatch(/drill bit/)
  })
  it('isolation recommends the fine V-bits', () => {
    const rec = toolsForStep('isolate', tools)
      .filter((x) => x.recommended)
      .map((x) => x.tool.id)
    expect(rec).toContain('starter-vbit-30-0.1')
    expect(rec).not.toContain('starter-vbit-90-0.2')
  })
})

describe('layersForStep', () => {
  it('filters by type and side', () => {
    expect(layersForStep('isolate', layers).map((l) => l.id)).toEqual(['top', 'bot'])
    expect(layersForStep('isolate', layers, 'bottom').map((l) => l.id)).toEqual(['bot'])
    expect(layersForStep('drill', layers).map((l) => l.id)).toEqual(['drl'])
    expect(layersForStep('cutout', layers).map((l) => l.id)).toEqual(['edge'])
    expect(layersForStep('alignment', layers)).toEqual([])
  })
  it('every kind has info', () => {
    for (const k of Object.keys(STEP_KIND_INFO) as StepKind[]) expect(STEP_KIND_INFO[k].icon).toBeTruthy()
  })
})

describe('createStep defaults', () => {
  it('uses material-based depths', () => {
    expect(createStep('isolate', { id: 'a', material }).cutDepth).toBeCloseTo(0.1)
    expect(createStep('cutout', { id: 'a', material }).cutDepth).toBeCloseTo(1.7)
    expect(createStep('drill', { id: 'a', material }).cutDepth).toBeCloseTo(1.9)
    const s = createStep('isolate', { id: 'x', side: 'bottom', layerIds: ['bot'], toolId: 't' })
    expect(s.side).toBe('bottom')
    expect(s.safeZ).toBeNull()
    expect(s.name).toContain('bottom')
  })
})

describe('validateStep', () => {
  const iso = () =>
    createStep('isolate', { id: 'i', layerIds: ['top'], toolId: 'starter-vbit-30-0.1', material })

  it('a good isolation step is ok', () => {
    expect(validateStep(iso(), ctx).level).toBe('ok')
  })
  it('missing tool → error in tool section', () => {
    const s = { ...iso(), toolId: null }
    expect(issuesIn(s, 'tool')).toHaveLength(1)
    expect(validateStep(s, ctx).level).toBe('error')
    expect(issuesIn({ ...iso(), toolId: 'gone' }, 'tool')).toHaveLength(1)
  })
  it('wrong tool type → error', () => {
    expect(issuesIn({ ...iso(), toolId: 'starter-drill-1.0' }, 'tool')[0].message).toMatch(/V-bit/)
  })
  it('layer problems', () => {
    expect(issuesIn({ ...iso(), layerIds: [] }, 'layer')).toHaveLength(1)
    expect(issuesIn({ ...iso(), layerIds: ['silk'] }, 'layer')).toHaveLength(1)
    expect(issuesIn({ ...iso(), layerIds: ['nope'] }, 'layer')).toHaveLength(1)
    expect(issuesIn({ ...iso(), layerIds: ['bot'] }, 'layer', 'warning')).toHaveLength(1)
  })
  it('1 mm isolation depth → warning mentioning copper thickness', () => {
    const w = issuesIn({ ...iso(), cutDepth: 1 }, 'general', 'warning')
    expect(w.some((i) => /1 mm deep.*0\.035 mm/.test(i.message))).toBe(true)
  })
  it('depth beyond flute length → error', () => {
    const s = createStep('cutout', { id: 'c', layerIds: ['edge'], toolId: 'starter-corn-0.8', material })
    s.cutDepth = 5
    expect(issuesIn(s, 'general').some((i) => /cutting length/.test(i.message))).toBe(true)
  })
  it('cutout shallower than material → error; depth <= 0 → error; safeZ <= 0 → error', () => {
    const s = createStep('cutout', { id: 'c', layerIds: ['edge'], toolId: 'starter-corn-1.5', material })
    expect(validateStep(s, ctx).level).toBe('ok')
    expect(issuesIn({ ...s, cutDepth: 1.0 }, 'general')).toHaveLength(1)
    expect(issuesIn({ ...s, cutDepth: 0 }, 'general')).toHaveLength(1)
    expect(issuesIn({ ...s, safeZ: 0 }, 'general')).toHaveLength(1)
  })
  it('bottom side on single-sided material → warning', () => {
    const s = createStep('isolate', {
      id: 'b',
      side: 'bottom',
      layerIds: ['bot'],
      toolId: 'starter-vbit-30-0.1',
      material
    })
    expect(issuesIn(s, 'general', 'warning').some((i) => /single-sided/.test(i.message))).toBe(true)
  })
  it('params: passes, overlap, tabs', () => {
    const s = iso()
    s.params.isolation.passes = 0
    s.params.isolation.overlap = 0.95
    expect(issuesIn(s, 'params')).toHaveLength(2)
    const c = createStep('cutout', { id: 'c', layerIds: ['edge'], toolId: 'starter-corn-1.5', material })
    c.params.cutout.tabs = 0
    expect(issuesIn(c, 'params', 'warning')).toHaveLength(1)
  })
  it('hole milling tool bigger than smallest hole → error', () => {
    const s = createStep('holeMill', { id: 'h', layerIds: ['drl'], toolId: 'starter-flat-1.0', material })
    expect(issuesIn(s, 'tool').some((i) => /too big/.test(i.message))).toBe(true)
  })
  it('drill much bigger than holes → warning', () => {
    const s = createStep('drill', { id: 'd', layerIds: ['drl'], toolId: 'starter-drill-1.5', material })
    expect(issuesIn(s, 'tool', 'warning').length).toBeGreaterThan(0)
  })
  it('combineValidation adds results warnings', () => {
    const v = combineValidation(validateStep(iso(), ctx), ['Some areas could not be reached'])
    expect(v.level).toBe('warning')
    expect(v.issues.at(-1)).toEqual({
      level: 'warning',
      section: 'results',
      message: 'Some areas could not be reached'
    })
  })
})
