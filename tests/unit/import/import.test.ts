import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  buildImportedLayer,
  computeLayerStats,
  defaultLayerColor,
  detectLayer,
  expandInputs,
  isRelevantFile,
  summarizeLayerStatus,
  type ParseFn
} from '@core/import'
import { isExcellon, parseExcellon } from '@core/excellon'
import { emptyBBox, rectPath } from '@core/geometry'
import type { ImportedLayer, LayerSide, LayerType, ParsedLayer } from '@core/model/types'

const FIX = resolve(__dirname, '../../../fixtures')
const read = (dir: string, f: string): string => readFileSync(resolve(FIX, dir, f), 'utf8')

/** Stand-in Gerber parser so these tests don't depend on the Gerber module. */
function stubGerber(): ParsedLayer {
  return {
    format: 'gerber',
    geometry: [{ outer: rectPath(5, 5, 10, 10), holes: [] }],
    objects: [
      { id: 0, kind: 'flash', polarity: 'dark', aperture: 10, shape: [] },
      { id: 1, kind: 'flash', polarity: 'dark', aperture: 10, shape: [] },
      { id: 2, kind: 'draw', polarity: 'dark', aperture: 11, shape: [] },
      { id: 3, kind: 'arc', polarity: 'dark', aperture: 11, shape: [] },
      { id: 4, kind: 'region', polarity: 'dark', aperture: -1, shape: [] }
    ],
    strokes: [],
    bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    fileAttributes: {},
    sourceUnits: 'mm',
    warnings: []
  }
}
const parse: ParseFn = (text, name, det) =>
  isExcellon(text)
    ? parseExcellon(text, { fileName: name, plated: det.plating === 'npth' ? false : undefined })
    : stubGerber()

async function buildZip(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('gerbers/board-F_Cu.gbr', read('import', 'copper.gbr'))
  zip.file('gerbers/board-B_Cu.gbr', read('import', 'copper.gbr'))
  zip.file('gerbers/board-Edge_Cuts.gbr', read('import', 'outline.gbr'))
  zip.file('gerbers/board-PTH.drl', read('excellon', 'kicad-pth.drl'))
  zip.file('gerbers/board-NPTH.drl', read('excellon', 'kicad-npth.drl'))
  zip.file('gerbers/board-job.gbrjob', '{"Header":{"GenerationSoftware":{}}}')
  zip.file('bom.csv', read('import', 'bom.csv'))
  zip.file('__MACOSX/gerbers/._board-F_Cu.gbr', new Uint8Array([0, 5, 22, 7, 0, 0]))
  zip.file('.DS_Store', new Uint8Array([0, 0, 0, 1, 66, 117, 100, 49]))
  zip.file('docs/board.pdf', '%PDF-1.4 binary-ish')
  zip.file('docs/preview.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]))
  zip.folder('empty-dir')
  const inner = new JSZip()
  inner.file('board-F_Mask.gbr', read('import', 'copper.gbr'))
  zip.file('nested/masks.zip', await inner.generateAsync({ type: 'uint8array' }))
  return zip.generateAsync({ type: 'uint8array' })
}

describe('expandInputs', () => {
  it('unzips recursively, flattens names and drops junk', async () => {
    const files = await expandInputs([
      { name: 'project.zip', data: await buildZip() },
      { name: 'C:\\work\\extra-B_Mask.gbr', data: read('import', 'copper.gbr') },
      { name: 'image.png', data: new Uint8Array([137, 80, 78, 71, 0, 0]) },
      { name: 'loose.gbr', data: new TextEncoder().encode('\ufeff' + read('import', 'outline.gbr')) }
    ])
    expect(files.map((f) => f.name)).toEqual([
      'bom.csv',
      'board-B_Cu.gbr',
      'board-Edge_Cuts.gbr',
      'board-F_Cu.gbr',
      'board-job.gbrjob',
      'board-NPTH.drl',
      'board-PTH.drl',
      'board-F_Mask.gbr',
      'extra-B_Mask.gbr',
      'loose.gbr'
    ])
    expect(files.find((f) => f.name === 'board-F_Mask.gbr')!.path).toBe(
      'project.zip/nested/masks.zip/board-F_Mask.gbr'
    )
    expect(files.find((f) => f.name === 'loose.gbr')!.text.startsWith('G04')).toBe(true)
  })

  it('zip import end-to-end matches golden summary', async () => {
    const files = await expandInputs([{ name: 'project.zip', data: await buildZip() }])
    const relevant = files.filter((f) => isRelevantFile(f.name, f.text, 'kicad').relevant)
    const layers = relevant.map((f, i) => buildImportedLayer(f, 'kicad', parse, i, `L${i}`))
    const summary = {
      skipped: files
        .filter((f) => !relevant.includes(f))
        .map((f) => ({ name: f.name, reason: isRelevantFile(f.name, f.text, 'kicad').reason })),
      layers: layers.map((l) => ({
        id: l.id,
        fileName: l.fileName,
        type: l.type,
        side: l.side,
        plating: l.plating ?? null,
        confidence: l.confidence,
        color: l.color,
        stats: {
          ...l.stats,
          widthMm: Math.round(l.stats.widthMm * 1e4) / 1e4,
          heightMm: Math.round(l.stats.heightMm * 1e4) / 1e4
        }
      })),
      status: summarizeLayerStatus(layers)
    }
    const golden = resolve(FIX, 'import/zip-import.golden.json')
    if (process.env.UPDATE_GOLDEN) writeFileSync(golden, JSON.stringify(summary, null, 2) + '\n')
    expect(summary).toEqual(JSON.parse(readFileSync(golden, 'utf8')))
    expect(summary.skipped.map((s) => s.name).sort()).toEqual(['board-job.gbrjob', 'bom.csv'])
  })
})

describe('computeLayerStats', () => {
  it('gerber: flashes are pads, draws+arcs are tracks', () => {
    expect(computeLayerStats(stubGerber())).toEqual({
      widthMm: 10,
      heightMm: 10,
      points: 4,
      pads: 2,
      tracks: 2
    })
  })
  it('excellon: holes are pads, slots are tracks', () => {
    const s = computeLayerStats(parseExcellon(read('excellon', 'kicad-pth.drl')))
    expect(s.pads).toBe(7)
    expect(s.tracks).toBe(1)
    expect(s.widthMm).toBeCloseTo(32.8, 6)
    expect(s.points).toBeGreaterThan(7 * 12)
  })
  it('empty layer', () => {
    const p = { ...stubGerber(), geometry: [], objects: [], bbox: emptyBBox() }
    expect(computeLayerStats(p)).toEqual({ widthMm: 0, heightMm: 0, points: 0, pads: 0, tracks: 0 })
  })
})

describe('defaultLayerColor', () => {
  const types: [LayerType, LayerSide][] = [
    ['copper', 'top'],
    ['copper', 'bottom'],
    ['copper', 'inner'],
    ['soldermask', 'top'],
    ['soldermask', 'bottom'],
    ['silkscreen', 'top'],
    ['silkscreen', 'bottom'],
    ['paste', 'top'],
    ['outline', 'all'],
    ['drill', 'all'],
    ['fab', 'top'],
    ['other', 'none']
  ]
  it('returns hex colours, unique across a typical project', () => {
    const seen = new Set<string>()
    types.forEach(([t, s], i) => {
      const c = defaultLayerColor(t, s, i)
      expect(c).toMatch(/^#[0-9a-f]{6}$/)
      seen.add(c)
    })
    expect(seen.size).toBe(types.length)
  })
  it('varies by index for the same type', () => {
    const cs = new Set(Array.from({ length: 30 }, (_, i) => defaultLayerColor('copper', 'inner', i)))
    expect(cs.size).toBe(30)
  })
  it('top copper is reddish, bottom copper is blue', () => {
    const rgb = (c: string): number[] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
    const [r1, , b1] = rgb(defaultLayerColor('copper', 'top', 0))
    const [r2, , b2] = rgb(defaultLayerColor('copper', 'bottom', 0))
    expect(r1).toBeGreaterThan(b1)
    expect(b2).toBeGreaterThan(r2)
  })
})

describe('buildImportedLayer', () => {
  it('assembles a drill layer with plating from parsed holes', () => {
    const l = buildImportedLayer(
      { name: 'board-NPTH.drl', text: read('excellon', 'kicad-npth.drl') },
      'kicad',
      parse,
      3,
      'x'
    )
    expect(l).toMatchObject({
      id: 'x',
      type: 'drill',
      side: 'all',
      plating: 'npth',
      order: 3,
      autoDetected: true
    })
    expect(l.stats.pads).toBe(4)
    expect(l.rawText).toContain('M48')
    expect(l.parsed?.format).toBe('excellon')
  })
  it('survives parser exceptions', () => {
    const l = buildImportedLayer(
      { name: 'board-F_Cu.gbr', text: read('import', 'copper.gbr') },
      null,
      () => {
        throw new Error('boom')
      },
      0,
      'y'
    )
    expect(l.type).toBe('copper')
    expect(l.parsed?.warnings[0]).toMatch(/boom/)
    expect(l.stats.points).toBe(0)
  })
  it('passes detection to the parser', () => {
    let seen = ''
    buildImportedLayer(
      { name: 'board-B_Mask.gbr', text: read('import', 'copper.gbr') },
      'kicad',
      (_t, _n, d) => {
        seen = `${d.type}/${d.side}`
        return stubGerber()
      },
      0,
      'z'
    )
    expect(seen).toBe('soldermask/bottom')
  })
})

describe('summarizeLayerStatus', () => {
  const layer = (type: LayerType): ImportedLayer => ({
    ...buildImportedLayer({ name: 'x.gbr', text: read('import', 'copper.gbr') }, null, stubGerber, 0, type),
    type
  })
  it('reports presence and requirement levels', () => {
    const s = summarizeLayerStatus([layer('copper'), layer('drill')])
    expect(s).toEqual([
      { key: 'copper', requirement: 'required', present: true },
      { key: 'outline', requirement: 'recommended', present: false },
      { key: 'drill', requirement: 'recommended', present: true },
      { key: 'silkscreen', requirement: 'optional', present: false },
      { key: 'soldermask', requirement: 'optional', present: false },
      { key: 'fab', requirement: 'optional', present: false }
    ])
    expect(summarizeLayerStatus([]).every((e) => !e.present)).toBe(true)
  })
  it('detection is consistent for zip content names', () => {
    expect(detectLayer('board-Edge_Cuts.gbr', read('import', 'outline.gbr'), 'kicad').type).toBe('outline')
  })
})
