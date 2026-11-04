import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { drillPlating, isExcellon, parseExcellon, scanExcellonPlating } from '@core/excellon'
import type { ParsedLayer } from '@core/model/types'

const FIX = resolve(__dirname, '../../../fixtures/excellon')
const read = (f: string): string => readFileSync(resolve(FIX, f), 'utf8')
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4

function summarize(p: ParsedLayer): unknown {
  const d = p.drills!
  const tools: Record<string, number> = {}
  for (const h of d.holes) tools[`T${h.toolNumber}`] = r4(h.diameter)
  for (const s of d.slots) tools[`T${s.toolNumber}`] = r4(s.diameter)
  return {
    format: p.format,
    sourceUnits: p.sourceUnits,
    plating: drillPlating(d),
    holeCount: d.holes.length,
    slotCount: d.slots.length,
    tools,
    holes: d.holes.map((h) => [r4(h.x), r4(h.y), r4(h.diameter), h.plated ? 'P' : 'N', h.toolNumber]),
    slots: d.slots.map((s) => [r4(s.start.x), r4(s.start.y), r4(s.end.x), r4(s.end.y), r4(s.diameter)]),
    bbox: [r4(p.bbox.minX), r4(p.bbox.minY), r4(p.bbox.maxX), r4(p.bbox.maxY)],
    polygons: p.geometry.length,
    warnings: p.warnings
  }
}

const CASES: [string, { fileName?: string; plated?: boolean }][] = [
  ['kicad-pth.drl', { fileName: 'board-PTH.drl' }],
  ['kicad-npth.drl', { fileName: 'board-NPTH.drl' }],
  ['altium-inch-tz.txt', { fileName: 'board-RoundHoles.TXT' }],
  ['eagle-header-tools.drd', { fileName: 'board.drd' }],
  ['slots-g85.drl', { fileName: 'slots.drl' }],
  ['routed-slots.drl', { fileName: 'routed.drl' }]
]

describe('parseExcellon golden summaries', () => {
  for (const [file, opts] of CASES) {
    it(file, () => {
      const summary = summarize(parseExcellon(read(file), opts))
      const golden = resolve(FIX, file.replace(/\.[^.]+$/, '.golden.json'))
      if (process.env.UPDATE_GOLDEN) {
        writeFileSync(golden, JSON.stringify(summary, null, 2) + '\n')
      }
      expect(summary).toEqual(JSON.parse(readFileSync(golden, 'utf8')))
    })
  }
})

describe('parseExcellon specifics', () => {
  it('KiCad metric with decimals: holes, modal Y reuse, routed slot', () => {
    const p = parseExcellon(read('kicad-pth.drl'))
    expect(p.sourceUnits).toBe('mm')
    expect(p.drills!.holes).toHaveLength(7)
    expect(p.drills!.holes[2]).toMatchObject({
      x: 115.5,
      y: -65.25,
      diameter: 0.4,
      plated: true,
      toolNumber: 1
    })
    expect(p.drills!.slots).toEqual([
      { start: { x: 140, y: -80 }, end: { x: 142, y: -80 }, diameter: 1.2, plated: true, toolNumber: 4 }
    ])
    expect(p.fileAttributes['.FileFunction']).toBe('Plated,1,2,PTH')
    expect(p.bbox.minX).toBeCloseTo(109.8, 3)
    expect(p.bbox.maxX).toBeCloseTo(142.6, 3)
    expect(p.warnings).toEqual([])
  })

  it('Altium inch TZ 2.4 without decimals', () => {
    const p = parseExcellon(read('altium-inch-tz.txt'))
    const h = p.drills!.holes
    expect(p.sourceUnits).toBe('inch')
    expect(h[0].x).toBeCloseTo(38.1, 9)
    expect(h[0].y).toBeCloseTo(25.4, 9)
    expect(h[1].x).toBeCloseTo(44.45, 9)
    expect(h[1].y).toBeCloseTo(25.4, 9)
    expect(h[2].y).toBeCloseTo(31.75, 9)
    expect(h[4].x).toBeCloseTo(-12.7, 9)
    expect(h[5].diameter).toBeCloseTo(3.175, 9)
    expect(h.every((x) => x.plated)).toBe(true)
  })

  it('Eagle tools in header, inch, default 2.4 format', () => {
    const p = parseExcellon(read('eagle-header-tools.drd'))
    const h = p.drills!.holes
    expect(h).toHaveLength(5)
    expect(h[0].x).toBeCloseTo(6.35, 9)
    expect(h[0].diameter).toBeCloseTo(0.59944, 9)
    expect(h[3].x).toBeCloseTo(30.48, 9)
    expect(h[3].y).toBeCloseTo(35.56, 9)
  })

  it('G85 slots with mixed decimal / integer coordinates', () => {
    const p = parseExcellon(read('slots-g85.drl'))
    expect(p.drills!.slots.map((s) => [s.start, s.end])).toEqual([
      [
        { x: 10, y: 10 },
        { x: 15, y: 10 }
      ],
      [
        { x: 20, y: 20 },
        { x: 20, y: 25 }
      ]
    ])
    expect(p.drills!.holes).toEqual([{ x: 30, y: 30, diameter: 0.8, plated: true, toolNumber: 2 }])
    // Slots are rendered as round-capped strokes.
    expect(p.bbox.minX).toBeCloseTo(9.5, 3)
    expect(p.strokes).toHaveLength(2)
  })

  it('M15/G01/M16 routing, LZ format and G91 incremental', () => {
    const p = parseExcellon(read('routed-slots.drl'))
    expect(p.drills!.slots).toHaveLength(2)
    expect(p.drills!.slots[1]).toMatchObject({ start: { x: 20, y: 10 }, end: { x: 20, y: 15 }, diameter: 2 })
    expect(p.drills!.holes.map((h) => [h.x, h.y])).toEqual([
      [5, 5],
      [6, 5],
      [7, 5]
    ])
  })

  it('NPTH detection from content, file name and options', () => {
    expect(drillPlating(parseExcellon(read('kicad-npth.drl')).drills)).toBe('npth')
    const plain = 'M48\nMETRIC\nT1C1.0\n%\nT1\nX1.0Y1.0\nM30\n'
    expect(parseExcellon(plain).drills!.holes[0].plated).toBe(true)
    expect(parseExcellon(plain, { fileName: 'board-NPTH.drl' }).drills!.holes[0].plated).toBe(false)
    expect(parseExcellon(plain, { fileName: 'board_npth.drl' }).drills!.holes[0].plated).toBe(false)
    expect(parseExcellon(plain, { plated: false }).drills!.holes[0].plated).toBe(false)
    expect(parseExcellon(';TYPE=NON_PLATED\n' + plain).drills!.holes[0].plated).toBe(false)
    // Content beats file name.
    expect(parseExcellon(';TYPE=PLATED\n' + plain, { fileName: 'x-NPTH.drl' }).drills!.holes[0].plated).toBe(
      true
    )
  })

  it('mixed plating via per-tool TA.AperFunction', () => {
    const text = [
      'M48',
      '; #@! TF.FileFunction,MixedPlating,1,2',
      'METRIC',
      '; #@! TA.AperFunction,Plated,PTH,ComponentDrill',
      'T1C0.8',
      '; #@! TA.AperFunction,NonPlated,NPTH,ComponentDrill',
      'T2C3.0',
      '%',
      'T1',
      'X1.0Y1.0',
      'T2',
      'X10.0Y10.0',
      'M30'
    ].join('\n')
    const p = parseExcellon(text)
    expect(p.drills!.holes.map((h) => h.plated)).toEqual([true, false])
    expect(drillPlating(p.drills)).toBe('mixed')
    expect(scanExcellonPlating(text)).toBe('mixed')
  })

  it('tools defined in body, headerless, KiCad FILE_FORMAT hint', () => {
    const p = parseExcellon(';FILE_FORMAT=4:4\nINCH,TZ\nT01C0.0300\nX10000Y20000\nM30\n')
    expect(p.drills!.holes[0].x).toBeCloseTo(25.4, 9)
    expect(p.drills!.holes[0].y).toBeCloseTo(50.8, 9)
  })

  it('guesses metric when no units are given and diameters are large', () => {
    const p = parseExcellon('M48\nT1C0.8\nT2C1.0\n%\nT1\nX1.5Y2.5\nM30\n')
    expect(p.sourceUnits).toBe('mm')
    expect(p.drills!.holes[0]).toMatchObject({ x: 1.5, y: 2.5, diameter: 0.8 })
  })

  it('stops at M30 and ignores comments', () => {
    const p = parseExcellon('M48\nMETRIC\nT1C1.0\n%\n; comment X99Y99\nT1\nX1.0Y1.0\nM30\nX5.0Y5.0\n')
    expect(p.drills!.holes).toHaveLength(1)
  })

  it('isExcellon', () => {
    expect(isExcellon(read('kicad-pth.drl'))).toBe(true)
    expect(isExcellon(read('altium-inch-tz.txt'))).toBe(true)
    expect(isExcellon(read('eagle-header-tools.drd'))).toBe(true)
    expect(isExcellon('%FSLAX46Y46*%\n%MOMM*%\nG04 x*\nD10*\nX0Y0D02*\nX1000000Y0D01*\nM02*\n')).toBe(false)
    expect(isExcellon('Designator,Footprint,Qty\nR1,0603,1\n')).toBe(false)
    expect(isExcellon('')).toBe(false)
  })
})
