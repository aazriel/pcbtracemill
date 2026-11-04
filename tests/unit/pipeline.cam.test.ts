import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importFiles } from '@core/pipeline/import'
import { computeBoardBBox } from '@core/model/board'
import { defaultMaterial, recipe, resetMaterialToDefault, validateStep } from '@core/cam'
import { STARTER_TOOLS } from '@core/tools'
import { MACHINE_PRESETS } from '@core/machines'
import { generateAll } from '@core/toolpath'

const dir = join(__dirname, '../../fixtures/boards/demo-kicad')

describe('CAM pipeline on the demo board', () => {
  it('plans a double-sided job and generates every toolpath', async () => {
    const files = readdirSync(dir).map((name) => ({ name, data: readFileSync(join(dir, name), 'utf8') }))
    const { layers } = await importFiles(files, 'kicad', 0, 'L')
    const bbox = computeBoardBBox(layers)
    const base = defaultMaterial(bbox)
    const material = resetMaterialToDefault(
      { ...base, doubleSided: true, alignment: { ...base.alignment, enabled: true } },
      bbox
    )
    const machine = MACHINE_PRESETS[0]
    let n = 0
    const steps = recipe({ layers, tools: STARTER_TOOLS, material, machine, newId: () => `s${n++}` })
    const kinds = steps.map((s) => `${s.kind}:${s.side}`)
    expect(kinds[0]).toBe('alignment:top')
    expect(kinds).toContain('isolate:top')
    expect(kinds).toContain('isolate:bottom')
    expect(kinds[kinds.length - 1].startsWith('cutout')).toBe(true)
    for (const s of steps) {
      const v = validateStep(s, { layers, tools: STARTER_TOOLS, material, machine })
      expect(v.level, `${s.name}: ${v.issues.map((i) => i.message).join('; ')}`).not.toBe('error')
    }
    const t0 = Date.now()
    const res = generateAll({ layers, material, machine, boardBBox: bbox, steps, tools: STARTER_TOOLS })
    expect(res.errors).toEqual([])
    expect(res.toolpaths.length).toBe(steps.length)
    for (const tp of res.toolpaths)
      console.log(
        tp.stepName,
        tp.side,
        tp.segments.length,
        Math.round(tp.stats.cutLength),
        tp.stats.plungeCount,
        Math.round(tp.stats.estimatedSeconds),
        tp.warnings
      )
    for (const tp of res.toolpaths) {
      expect(tp.stats.cutLength + tp.stats.plungeCount).toBeGreaterThan(0)
      expect(tp.warnings.filter((w) => /outside the stock/.test(w))).toEqual([])
    }
    expect(Date.now() - t0).toBeLessThan(5000)
  })
})
