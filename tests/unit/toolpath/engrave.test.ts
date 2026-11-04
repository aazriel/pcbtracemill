import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importFiles } from '@core/pipeline/import'
import { computeBoardBBox } from '@core/model/board'
import { createStep, defaultMaterial, validateStep } from '@core/cam'
import { STARTER_TOOLS } from '@core/tools'
import { MACHINE_PRESETS } from '@core/machines'
import { generateToolpath } from '@core/toolpath'

const dir = join(__dirname, '../../../fixtures/boards/demo-kicad')

describe('engrave step', () => {
  it('follows silkscreen centre-lines and warns when crossing copper', async () => {
    const files = readdirSync(dir).map((name) => ({ name, data: readFileSync(join(dir, name), 'utf8') }))
    const { layers } = await importFiles(files, 'kicad', 0, 'L')
    const silk = layers.find((l) => l.type === 'silkscreen')!
    const bbox = computeBoardBBox(layers)
    const material = defaultMaterial(bbox)
    const machine = MACHINE_PRESETS[0]
    const step = createStep('engrave', {
      id: 'e1',
      layerIds: [silk.id],
      toolId: 'starter-vbit-30-0.1',
      material
    })
    expect(step.cutDepth).toBeCloseTo(0.065, 3)
    const v = validateStep(step, { layers, tools: STARTER_TOOLS, material, machine })
    expect(v.level).not.toBe('error')
    const tool = STARTER_TOOLS.find((t) => t.id === step.toolId)!
    const tp = generateToolpath({ step, tool, layers, material, machine, boardBBox: bbox })
    // 4 silkscreen rectangles + the notch arc → several segments, all at engraving depth
    expect(tp.segments.length).toBeGreaterThanOrEqual(4)
    const zs = tp.segments.flatMap((s) => s.moves.filter((m) => m.kind === 'feed').map((m) => m.z))
    expect(Math.min(...zs)).toBeCloseTo(-0.065, 3)
    // The chip outline crosses a top-side trace in the demo design.
    expect(tp.warnings.join(' ')).toMatch(/runs over copper on the top side/)
    // A V-bit is recommended; a drill is not allowed.
    expect(
      validateStep(
        { ...step, toolId: 'starter-drill-0.8' },
        { layers, tools: STARTER_TOOLS, material, machine }
      ).level
    ).toBe('error')
  })
})
