import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addZTouchOff } from '@core/heightmap'

const post = (name: string): string => readFileSync(join(__dirname, '../../../fixtures/post', name), 'utf8')
const base = { x: 12.5, y: 7, feed: 50, safeZ: 5 }

describe('Z touch-off at point 1', () => {
  it('probes before the first spindle start and after every bit change (GRBL)', () => {
    const src = post('grbl-combined__demo_board.nc.golden.nc')
    const out = addZTouchOff(src, { ...base, dialect: 'grbl' })
    const lines = out.split('\n')
    const spindle = lines.filter((l) => /^M3\b/.test(l)).length
    expect(lines.filter((l) => l.startsWith('G38.2 Z-1 F50')).length).toBe(spindle)
    expect(lines.filter((l) => l.startsWith('G10 L20 P0 Z0')).length).toBe(spindle)
    // every probe is preceded by a move to point 1 at safe height and a rapid to Z1 (never below)
    const i = lines.findIndex((l) => l.startsWith('G38.2'))
    expect(lines.slice(i - 3, i)).toEqual(['G0 Z5', 'G0 X12.5 Y7', 'G0 Z1'])
    // spindle is off while the probe clip is on: the clip is removed (M0) before M3
    const k = lines.findIndex((l, j) => j > i && /^M3\b/.test(l))
    expect(lines.slice(i, k).some((l) => l.startsWith('M0') && /Remove the probe clip/.test(l))).toBe(true)
    // original lines are untouched
    for (const l of src.split('\n')) expect(lines).toContain(l)
  })

  it('uses G31 + G92 for Mach3 and converts to inches in G20 files', () => {
    const out = addZTouchOff(post('mach3-inch-combined__demo_board.tap.golden.nc'), {
      ...base,
      dialect: 'mach3'
    })
    expect(out).toMatch(/G31 Z-0\.0394 F2/)
    expect(out).toMatch(/G92 Z0/)
    expect(out).toMatch(/G0 X0\.4921 Y0\.2756/)
  })

  it('writes semicolon comments for the generic dialect', () => {
    const out = addZTouchOff(post('generic-combined__demo_board.gcode.golden.nc'), {
      ...base,
      dialect: 'generic',
      probeCommand: 'G38.2'
    })
    expect(out).toMatch(/^; ==== Z TOUCH-OFF 1/m)
    expect(out).not.toMatch(/^\(==== Z TOUCH/m)
  })
})

describe('Mach3 probe macros', () => {
  it('M402 waits for the machine to stop and writes the DRO position with CRLF line ends', async () => {
    const { mach3ProbeMacros, MACH3_PROBE_FILE } = await import('@core/heightmap')
    const [m401, m402] = mach3ProbeMacros()
    expect(m401.name).toBe('M401.m1s')
    expect(m401.text).toContain(`Const ResultFile = "${MACH3_PROBE_FILE}"`)
    expect(m401.text).toContain('For Output')
    expect(m402.text).toMatch(/While IsMoving\(\)\r\n {2}Sleep 20\r\nWend/)
    expect(m402.text).toContain('GetDRO(2)')
    expect(m402.text).toContain('For Append')
  })
})
