import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importFiles } from '@core/pipeline/import'
import { summarizeLayerStatus } from '@core/import'
import { computeBoardBBox } from '@core/model/board'

const dir = join(__dirname, '../../fixtures/boards/demo-kicad')

describe('import pipeline on the demo KiCad board', () => {
  it('detects every layer and skips the BOM', async () => {
    const files = readdirSync(dir).map((name) => ({ name, data: readFileSync(join(dir, name), 'utf8') }))
    const res = await importFiles(files, 'kicad', 0, 'L')
    const byName = Object.fromEntries(res.layers.map((l) => [l.fileName, l]))
    expect(res.skipped.map((s) => s.name)).toEqual(['demo-bom.csv'])
    expect(byName['demo-F_Cu.gbr'].type).toBe('copper')
    expect(byName['demo-F_Cu.gbr'].side).toBe('top')
    expect(byName['demo-B_Cu.gbr'].side).toBe('bottom')
    expect(byName['demo-Edge_Cuts.gbr'].type).toBe('outline')
    expect(byName['demo-PTH.drl'].type).toBe('drill')
    expect(byName['demo-NPTH.drl'].plating).toBe('npth')
    expect(byName['demo-PTH.drl'].stats.pads).toBe(13)
    const bb = computeBoardBBox(res.layers)
    expect(bb.maxX - bb.minX).toBeCloseTo(50.1, 1)
    expect(bb.maxY - bb.minY).toBeCloseTo(30.1, 1)
    expect(summarizeLayerStatus(res.layers).every((s) => s.present || s.requirement === 'optional')).toBe(
      true
    )
  })
})
