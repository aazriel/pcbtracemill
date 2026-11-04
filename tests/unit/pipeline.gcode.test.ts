import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importFiles } from '@core/pipeline/import'
import { runCam } from '@core/pipeline/cam'
import { computeBoardBBox } from '@core/model/board'
import { defaultMaterial, recipe, resetMaterialToDefault } from '@core/cam'
import { STARTER_TOOLS } from '@core/tools'
import { MACHINE_PRESETS } from '@core/machines'
import { interpretGcode } from '@core/gcode'
import { defaultProbeGrid, generateProbeProgram, buildHeightMap, applyHeightMap } from '@core/heightmap'
import { serializeProject, deserializeProject } from '@core/project'
import type { ExportGrouping } from '@core/model/types'

const dir = join(__dirname, '../../fixtures/boards/demo-kicad')

async function setup() {
  const files = readdirSync(dir).map((name) => ({ name, data: readFileSync(join(dir, name), 'utf8') }))
  const { layers } = await importFiles(files, 'kicad', 0, 'L')
  const bbox = computeBoardBBox(layers)
  const base = defaultMaterial(bbox)
  const material = resetMaterialToDefault(
    { ...base, doubleSided: true, alignment: { ...base.alignment, enabled: true } },
    bbox
  )
  return { layers, material }
}

describe('end-to-end core: Gerbers → G-code', () => {
  for (const machine of MACHINE_PRESETS) {
    for (const grouping of ['combined', 'per-step', 'per-tool'] as ExportGrouping[]) {
      it(`${machine.name} / ${grouping}`, async () => {
        const { layers, material } = await setup()
        let n = 0
        const steps = recipe({ layers, tools: STARTER_TOOLS, material, machine, newId: () => `s${n++}` })
        const res = runCam({
          projectName: 'demo',
          layers,
          steps,
          tools: STARTER_TOOLS,
          material,
          machine,
          grouping
        })
        expect(res.validations.filter((v) => v.level === 'error')).toEqual([])
        expect(res.notes).toEqual([])
        expect(res.files.length).toBeGreaterThan(0)
        if (grouping === 'combined') {
          expect(res.files).toHaveLength(1)
          expect(res.files[0].text).toMatch(/FLIP THE BOARD/)
        }
        for (const f of res.files) {
          const sim = interpretGcode(f.text, { lineMeta: f.lineMeta })
          expect(sim.warnings, f.name).toEqual([])
          expect(sim.moves.length).toBeGreaterThan(3)
          // never cut deeper than through the board + spoilboard allowance
          expect(sim.bounds.min[2]).toBeGreaterThan(-(material.thickness + 3))
          // stays inside the machine envelope
          expect(sim.bounds.max[0] - sim.bounds.min[0]).toBeLessThan(machine.workArea.x)
        }
      })
    }
  }

  it('auto-level round trip and project save/load', async () => {
    const { layers, material } = await setup()
    const machine = MACHINE_PRESETS.find((m) => m.postProcessor === 'grbl')!
    let n = 0
    const steps = recipe({ layers, tools: STARTER_TOOLS, material, machine, newId: () => `s${n++}` })
    const res = runCam({
      projectName: 'demo',
      layers,
      steps,
      tools: STARTER_TOOLS,
      material,
      machine,
      grouping: 'per-step'
    })
    const iso = res.files.find((f) => /isolate/i.test(f.name))!
    const grid = defaultProbeGrid({ minX: 0, minY: 0, maxX: material.width, maxY: material.height }, 10)
    expect(generateProbeProgram(grid, machine)).toMatch(/G38\.2/)
    const log: string[] = []
    for (let iy = 0; iy < grid.countY; iy++)
      for (let ix = 0; ix < grid.countX; ix++) {
        const x = grid.minX + ((grid.maxX - grid.minX) * ix) / (grid.countX - 1)
        const y = grid.minY + ((grid.maxY - grid.minY) * iy) / (grid.countY - 1)
        log.push(`[PRB:${x.toFixed(3)},${y.toFixed(3)},${(0.002 * x - 0.001 * y).toFixed(4)}:1]`)
      }
    const map = buildHeightMap(
      log.map((l) => {
        const m = /PRB:([^,]+),([^,]+),([^:]+)/.exec(l)!
        return { x: +m[1], y: +m[2], z: +m[3] }
      }),
      grid
    )
    const leveled = applyHeightMap(iso.text, map)
    expect(interpretGcode(leveled).warnings).toEqual([])
    expect(leveled.length).toBeGreaterThan(iso.text.length)

    const text = serializeProject({
      version: 1,
      name: 'demo',
      layers,
      machine,
      material,
      tools: STARTER_TOOLS,
      steps,
      heightMap: map,
      settings: {
        edaTool: 'kicad',
        autoRegenerate: true,
        exportGrouping: 'per-step',
        realisticColors: false,
        highlightOnHover: true
      }
    })
    const back = deserializeProject(text)
    expect(back.steps).toEqual(steps)
    expect(back.layers[0].parsed).toBeUndefined()
    expect(back.layers[0].rawText.length).toBeGreaterThan(100)
  })
})
