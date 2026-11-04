import { describe, expect, it } from 'vitest'
import { MACHINE_FIELD_HELP, MACHINE_PRESETS, createCustomMachine, validateMachine } from '@core/machines'

describe('machine presets', () => {
  it('are valid, built-in and uniquely identified', () => {
    expect(MACHINE_PRESETS.length).toBeGreaterThanOrEqual(9)
    expect(new Set(MACHINE_PRESETS.map((m) => m.id)).size).toBe(MACHINE_PRESETS.length)
    for (const m of MACHINE_PRESETS) {
      expect(validateMachine(m), m.id).toEqual([])
      expect(m.builtIn).toBe(true)
    }
  })
  it('uses the right dialect per controller', () => {
    for (const m of MACHINE_PRESETS) {
      if (m.postProcessor === 'grbl') {
        expect(m.supportsCannedCycles).toBe(false)
        expect(m.probeCommand).toBe('G38.2')
        expect(['nc', 'gcode']).toContain(m.fileExtension)
      }
      if (m.postProcessor === 'mach3') {
        expect(m.probeCommand).toBe('G31')
        expect(m.fileExtension).toBe('tap')
      }
      if (m.postProcessor === 'linuxcnc') expect(m.fileExtension).toBe('ngc')
    }
  })
  it('createCustomMachine copies without sharing nested objects', () => {
    const base = MACHINE_PRESETS[0]
    const c = createCustomMachine(base)
    expect(c.builtIn).toBe(false)
    expect(c.id).not.toBe(base.id)
    c.workArea.x = 1
    expect(base.workArea.x).not.toBe(1)
    expect(createCustomMachine().postProcessor).toBe('generic')
  })
  it('validateMachine reports errors', () => {
    const c = createCustomMachine()
    c.safeZ = 0
    c.spindleMin = 20000
    c.spindleMax = 1000
    c.fileExtension = '.nc'
    const errs = validateMachine(c)
    expect(errs.length).toBeGreaterThanOrEqual(3)
  })
  it('has help for every field', () => {
    for (const k of Object.keys(MACHINE_PRESETS[0]))
      expect(MACHINE_FIELD_HELP[k as keyof typeof MACHINE_FIELD_HELP]).toBeDefined()
  })
})
