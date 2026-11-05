import { describe, expect, it } from 'vitest'
import type { CamStep, Toolpath } from '@core/model/types'
import { rectPath, unionPaths } from '@core/geometry'
import { generateToolpath } from '@core/toolpath'
import { hole, layer, machine, material, step, tool } from './fixtures'

const twoPads = unionPaths([rectPath(10, 10, 2, 2), rectPath(20, 10, 2, 2)])
const boardBBox = { minX: 5, minY: 5, maxX: 25, maxY: 15 }

function isolate(skip: CamStep['skip']): Toolpath {
  return generateToolpath({
    step: step('isolate', ['cu'], { skip }),
    tool: tool('flat', 0.2),
    layers: [layer('cu', 'copper', twoPads)],
    material: material(),
    machine: machine(),
    boardBBox
  })
}

function drill(skip: CamStep['skip']): Toolpath {
  return generateToolpath({
    step: step('drill', ['drl'], { cutDepth: 1.7, skip }),
    tool: tool('drill', 0.8),
    layers: [layer('drl', 'drill', [], { holes: [hole(10, 10, 0.8), hole(20, 10, 0.8), hole(12, 10, 0.8)] })],
    material: material({ offsetX: 0, offsetY: 0 }),
    machine: machine(),
    boardBBox: { minX: 10, minY: 10, maxX: 20, maxY: 15 }
  })
}

describe('skip parts', () => {
  it('leaves a skipped copper area without isolation, and says so', () => {
    expect(isolate(undefined).segments).toHaveLength(2)
    const tp = isolate({ enabled: true, items: [{ kind: 'copper', x: 20.3, y: 10.2 }] })
    expect(tp.segments).toHaveLength(1)
    expect(tp.warnings.join(' ')).toMatch(/skipped as you chose/)
  })

  it('ignores the list while skipping is switched off', () => {
    const tp = isolate({ enabled: false, items: [{ kind: 'copper', x: 20, y: 10 }] })
    expect(tp.segments).toHaveLength(2)
    expect(tp.warnings).toEqual([])
  })

  it('reports picks that no longer hit copper', () => {
    const tp = isolate({ enabled: true, items: [{ kind: 'copper', x: 15, y: 10 }] })
    expect(tp.segments).toHaveLength(2)
    expect(tp.warnings.join(' ')).toMatch(/no longer on the copper/)
  })

  it('does not drill skipped holes', () => {
    expect(drill(undefined).segments).toHaveLength(3)
    const tp = drill({ enabled: true, items: [{ kind: 'hole', x: 20, y: 10, d: 0.8 }] })
    expect(tp.segments).toHaveLength(2)
    expect(tp.warnings.join(' ')).toMatch(/1 hole is skipped/)
  })
})
