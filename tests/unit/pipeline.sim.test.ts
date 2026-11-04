import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importFiles } from '@core/pipeline/import'
import { runCam } from '@core/pipeline/cam'
import { setupSimulation } from '@core/pipeline/sim'
import { computeBoardBBox } from '@core/model/board'
import { defaultMaterial, recipe, resetMaterialToDefault } from '@core/cam'
import { STARTER_TOOLS } from '@core/tools'
import { MACHINE_PRESETS } from '@core/machines'
import { union } from '@core/geometry'
import { MAT_COPPER, MAT_FR4, MAT_THROUGH } from '@core/sim'

const dir = join(__dirname, '../../fixtures/boards/demo-kicad')

describe('simulation of the demo board', () => {
  it('mills copper on both faces and drills through', async () => {
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
    const cam = runCam({
      projectName: 'demo',
      layers,
      steps,
      tools: STARTER_TOOLS,
      material,
      machine,
      grouping: 'per-step'
    })
    expect(cam.combined).not.toBeNull()
    const cu = (side: string) =>
      union(...layers.filter((l) => l.type === 'copper' && l.side === side).map((l) => l.parsed!.geometry))
    const sim = setupSimulation({
      gcode: cam.combined!.text,
      lineMeta: cam.combined!.lineMeta,
      tools: STARTER_TOOLS,
      toolpaths: cam.toolpaths,
      material,
      boardBBox: bbox,
      designTop: cu('top'),
      designBottom: cu('bottom'),
      resolution: 0.1
    })
    expect(sim.warnings).toEqual([])
    expect(sim.markers.filter((m) => m.kind === 'step').length).toBe(steps.length)
    sim.runner.finish()
    const count = (side: 'top' | 'bottom', mat: number) => {
      const s = sim.runner.stock(side)!
      let c = 0
      for (const v of s.mat) if (v === mat) c++
      return c
    }
    for (const side of ['top', 'bottom'] as const) {
      expect(count(side, MAT_FR4), side).toBeGreaterThan(1000)
      expect(count(side, MAT_THROUGH), side).toBeGreaterThan(100)
      expect(count(side, MAT_COPPER), side).toBeGreaterThan(count(side, MAT_FR4))
      expect(sim.runner.stock(side)!.copperMask!.some((v) => v === 1)).toBe(true)
    }
    // Isolation must not destroy the design copper: cells inside the design stay copper.
    const top = sim.runner.stock('top')!
    let inside = 0
    let damaged = 0
    for (let i = 0; i < top.mat.length; i++)
      if (top.copperMask![i]) {
        inside++
        if (top.mat[i] === MAT_FR4) damaged++
      }
    expect(damaged / inside).toBeLessThan(0.08) // only drilled pad centres
    // Pins: rewinding to the start restores fresh copper.
    sim.runner.seek(0)
    expect(count('top', MAT_FR4)).toBe(0)
  })
})
