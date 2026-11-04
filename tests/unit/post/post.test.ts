import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { postProcess, groupToolpaths, fmtNum, slug } from '@core/post'
import type { PostContext } from '@core/post'
import { interpretGcode } from '@core/gcode'
import type { ExportGrouping, GcodeFile, MachineProfile } from '@core/model/types'
import { MACHINES, TOOLPATHS, TOOLS, machine } from './sample'

const GOLDEN_DIR = resolve(__dirname, '../../../fixtures/post')
const UPDATE = process.env.UPDATE_GOLDEN === '1'

function ctx(m: MachineProfile, grouping: ExportGrouping): PostContext {
  return {
    machine: m,
    tools: TOOLS,
    grouping,
    projectName: 'demo board',
    doubleSided: true,
    date: '2026-01-02'
  }
}

function checkGolden(caseName: string, files: GcodeFile[]): void {
  if (UPDATE && !existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true })
  for (const f of files) {
    const path = resolve(GOLDEN_DIR, `${caseName}__${f.name}.golden.nc`)
    if (UPDATE) writeFileSync(path, f.text)
    expect(existsSync(path), `missing golden ${path} (run with UPDATE_GOLDEN=1)`).toBe(true)
    expect(f.text).toBe(readFileSync(path, 'utf8'))
  }
}

const CASES: [string, keyof typeof MACHINES, ExportGrouping][] = [
  ['mach3-combined', 'mach3', 'combined'],
  ['mach3-per-step', 'mach3', 'per-step'],
  ['mach3-inch-combined', 'mach3inch', 'combined'],
  ['grbl-combined', 'grbl', 'combined'],
  ['grbl-per-tool', 'grbl', 'per-tool'],
  ['linuxcnc-combined', 'linuxcnc', 'combined'],
  ['generic-combined', 'generic', 'combined']
]

describe('post-processor goldens', () => {
  for (const [name, m, grouping] of CASES) {
    it(name, () => {
      const files = postProcess(TOOLPATHS, ctx(MACHINES[m], grouping))
      checkGolden(name, files)
    })
  }
})

describe('post-processor invariants', () => {
  for (const [name, m, grouping] of CASES) {
    it(`${name}: metadata, safety and program end`, () => {
      const mp = MACHINES[m]
      const files = postProcess(TOOLPATHS, ctx(mp, grouping))
      for (const f of files) {
        const lines = f.text.split('\n')
        expect(lines.pop()).toBe('')
        expect(f.lineMeta.length).toBe(lines.length)
        f.lineMeta.forEach((lm, i) => expect(lm.line).toBe(i))
        expect(f.sizeBytes).toBe(Buffer.byteLength(f.text, 'utf8'))
        expect(f.estimatedSeconds).toBeGreaterThan(0)
        expect(f.text).not.toMatch(/\r/)

        const sim = interpretGcode(f.text, { lineMeta: f.lineMeta })
        expect(sim.warnings).toEqual([])
        const scale = mp.outputUnits === 'inch' ? 25.4 : 1
        const clear = Math.min(mp.safeZ, mp.travelZ) - 1e-3 * scale
        for (const mv of sim.moves) {
          const xy = Math.hypot(mv.to[0] - mv.from[0], mv.to[1] - mv.from[1])
          if (mv.kind === 'rapid' && xy > 1e-6) {
            // XY rapids only above clearance height
            expect(mv.from[2]).toBeGreaterThanOrEqual(clear)
            expect(mv.to[2]).toBeGreaterThanOrEqual(clear)
          }
          // rapids stay above the copper (canned-cycle peck re-entry is controller-defined)
          if (mv.kind === 'rapid' && !/G8[1-3]|^X\S+ Y\S+$/.test(lines[mv.line]))
            expect(mv.to[2]).toBeGreaterThan(0)
        }
        // every cutting move is tagged with its step
        for (const mv of sim.moves.filter((x) => x.kind === 'feed')) expect(mv.stepId).not.toBeNull()

        const code = lines.map((l) => l.replace(/^N\d+\s+/, '')).filter((l) => l && !/^[(;%]/.test(l))
        const end = mp.postProcessor === 'linuxcnc' ? 'M2' : 'M30'
        expect(code[code.length - 1]).toBe(end)
        expect(code.slice(-4)).toContain('M5')
        // header lines carry no step
        expect(f.lineMeta[0].stepId).toBeNull()
      }
    })
  }

  it('per-tool grouping merges consecutive same-tool steps but never across a side change', () => {
    const groups = groupToolpaths(TOOLPATHS, ctx(MACHINES.grbl, 'per-tool'))
    expect(groups.map((g) => g.name)).toEqual([
      'demo_board_T1_30deg-v-bit-0-1.nc',
      'demo_board_T2_0-8-mm-drill.nc',
      'demo_board_T3_1-0-mm-end-mill.nc',
      'demo_board_T1_30deg-v-bit-0-1_2.nc'
    ])
    expect(groups[2].toolpaths.map((t) => t.stepId)).toEqual(['s-holemill', 's-cutout'])
    const sameToolDifferentSide = [TOOLPATHS[0], { ...TOOLPATHS[4], side: 'bottom' as const }]
    expect(groupToolpaths(sameToolDifferentSide, ctx(MACHINES.grbl, 'per-tool')).length).toBe(2)
  })

  it('per-step naming', () => {
    const files = postProcess(TOOLPATHS, ctx(MACHINES.mach3, 'per-step'))
    expect(files.map((f) => f.name)).toEqual([
      'demo_board_01_isolation-top.tap',
      'demo_board_02_drill-0-8-mm.tap',
      'demo_board_03_hole-mill-3-mm.tap',
      'demo_board_04_board-cutout.tap',
      'demo_board_05_isolation-bottom.tap'
    ])
    expect(files[4].text).toMatch(/FLIPPED around the X axis/)
    expect(files[1].stepIds).toEqual(['s-drill'])
    expect(files[1].toolIds).toEqual(['t-drill'])
  })

  it('combined file contains a flip block and manual tool change pauses', () => {
    const [f] = postProcess(TOOLPATHS, ctx(MACHINES.grbl, 'combined'))
    expect(f.text).toContain(
      'M0 (FLIP THE BOARD NOW around the X axis, re-seat on the alignment pins, re-zero Z, then press Cycle Start)'
    )
    expect(f.text).toContain('M0 (Insert tool #2 0.8 mm drill, then press cycle start)')
    expect(f.text).not.toMatch(/M6|G8[0-3]|^N\d/m)
    const sim = interpretGcode(f.text)
    expect(sim.pauses.length).toBe(4) // T2, T3, flip, T1
    expect(f.stepIds.length).toBe(5)
    expect(f.toolIds).toEqual(['t-vbit', 't-drill', 't-mill'])
  })

  it('canned cycles and M6 on Mach3', () => {
    const [f] = postProcess(TOOLPATHS, ctx(MACHINES.mach3, 'combined'))
    expect(f.text).toMatch(/^G98 G83 X5 Y5 Z-1.8 R1 Q0.6 F100$/m)
    expect(f.text).toMatch(/^X15 Y5$/m)
    expect(f.text).toMatch(/^G81 X25 Y5 Z-1.8 R1 F100$/m)
    expect(f.text).toMatch(/^T2 M6 /m)
    expect(f.text).toMatch(/^G43 H2$/m)
    const sim = interpretGcode(f.text)
    expect(sim.toolChanges.map((t) => t.tool)).toEqual([1, 2, 3, 1])
  })

  it('inch output converts coordinates and feeds', () => {
    const [f] = postProcess(TOOLPATHS, ctx(MACHINES.mach3inch, 'combined'))
    expect(f.text).toMatch(/^G20$/m)
    expect(f.text).not.toMatch(/^G21$/m)
    // 300 mm/min → 11.81 in/min, X20 mm → 0.7874 in
    expect(f.text).toMatch(/G1 X0.7874 F11.81/)
    const mm = postProcess(TOOLPATHS, ctx(MACHINES.mach3, 'combined'))[0]
    const a = interpretGcode(f.text)
    const b = interpretGcode(mm.text)
    expect(a.bounds.max[0]).toBeCloseTo(b.bounds.max[0], 2)
  })

  it('linearises arcs when unsupported and omits S when no speed control', () => {
    const [f] = postProcess(TOOLPATHS, ctx(MACHINES.generic, 'combined'))
    expect(f.text).not.toMatch(/G[23] /)
    expect(f.text).not.toMatch(/ S\d/)
    expect(f.text).toMatch(/^N10 ; TraceMill/m)
    expect(f.text).toMatch(/ M8$/m)
    expect(f.text).toMatch(/ M9$/m)
  })

  it('clamps feeds to the machine maximum and the spindle to its range', () => {
    const m = machine({ maxFeedXY: 150, spindleMax: 9000 })
    const [f] = postProcess([TOOLPATHS[0]], ctx(m, 'combined'))
    expect(f.text).not.toMatch(/F300/)
    expect(f.text).toMatch(/F150/)
    expect(f.text).toMatch(/M3 S9000/)
  })

  it('lifts to safe Z before a rapid that starts below the copper', () => {
    const tp = {
      ...TOOLPATHS[0],
      segments: [
        {
          moves: [
            { kind: 'feed' as const, x: 0, y: 0, z: -0.1, feed: 100 },
            { kind: 'rapid' as const, x: 10, y: 0, z: -0.1 }
          ]
        }
      ]
    }
    const [f] = postProcess([tp], ctx(machine({}), 'combined'))
    const body = f.text.split('\n')
    const i = body.indexOf('G1 Z-0.1 F100')
    expect(i).toBeGreaterThan(0)
    expect(body.slice(i - 2, i)).toEqual(['G0 X0 Y0', 'G0 Z2'])
    expect(body.slice(i + 1, i + 5)).toEqual(['G0 Z5', 'G0 X10', 'G0 Z2', 'G1 Z-0.1 F60'])
  })

  it('throws a friendly error for unknown tools', () => {
    expect(() => postProcess([{ ...TOOLPATHS[0], toolId: 'nope' }], ctx(MACHINES.mach3, 'combined'))).toThrow(
      /not in the tool library/
    )
  })

  it('formats numbers', () => {
    expect(fmtNum(1.5, 4)).toBe('1.5')
    expect(fmtNum(-0.00001, 4)).toBe('0')
    expect(fmtNum(10, 3)).toBe('10')
    expect(slug('Isolation (top) #1')).toBe('isolation-top-1')
  })
})
