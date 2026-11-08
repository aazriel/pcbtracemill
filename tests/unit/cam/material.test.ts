import { describe, expect, it } from 'vitest'
import {
  boardCentred,
  defaultMaterial,
  resetMaterialToDefault,
  resizeKeepingCentre,
  validateMaterial
} from '@core/cam'

const bbox = { minX: 10, minY: 20, maxX: 60, maxY: 60 } // 50 x 40

describe('material', () => {
  it('defaults: board + 5 mm, centred', () => {
    const m = defaultMaterial(bbox)
    expect(m.width).toBe(55)
    expect(m.height).toBe(45)
    expect(m.offsetX).toBe(2.5)
    expect(m.offsetY).toBe(2.5)
    expect(m.thickness).toBe(1.6)
    expect(m.copperThickness).toBe(0.035)
    expect(m.origin).toBe('bottom-left')
    expect(m.doubleSided).toBe(false)
    expect(m.alignment).toEqual({ enabled: false, axis: 'x', pinDiameter: 3, margin: 3 })
    expect(m.useDefaults).toBe(true)
    expect(validateMaterial(m, bbox)).toEqual([])
  })
  it('detects stock too small after rotation and which side is short', () => {
    const m = { ...defaultMaterial(bbox), rotation: 90 } // board now 40 x 50
    const issues = validateMaterial(m, bbox)
    expect(
      issues.some((i) => i.field === 'height' && i.level === 'error' && /too short/.test(i.message))
    ).toBe(true)
    const shifted = { ...defaultMaterial(bbox), offsetX: 6 }
    const s = validateMaterial(shifted, bbox)
    expect(s.some((i) => i.field === 'offsetX' && /RIGHT/.test(i.message))).toBe(true)
    expect(validateMaterial({ ...defaultMaterial(bbox), offsetY: -1 }, bbox)[0].message).toMatch(/BOTTOM/)
  })
  it('alignment pins that do not fit → error; reset makes them fit', () => {
    const m = { ...defaultMaterial(bbox), doubleSided: true }
    m.alignment = { ...m.alignment, enabled: true }
    const issues = validateMaterial(m, bbox)
    expect(issues.filter((i) => i.field === 'alignment' && i.level === 'error')).toHaveLength(2)
    const r = resetMaterialToDefault({ ...m, rotation: 90, thickness: 1.0 }, bbox)
    expect(r.thickness).toBe(1.0)
    expect(r.rotation).toBe(90) // rotation is preserved by reset
    expect(validateMaterial(r, bbox)).toEqual([])
    expect(r.height).toBe(55) // board is rotated 90°, so its 50 mm side runs along Y
  })
  it('thickness / copper sanity', () => {
    const m = { ...defaultMaterial(bbox), thickness: 0, copperThickness: 35 }
    const issues = validateMaterial(m, bbox)
    expect(issues.some((i) => i.field === 'thickness' && i.level === 'error')).toBe(true)
    expect(issues.some((i) => i.field === 'copperThickness')).toBe(true)
    const w = validateMaterial({ ...defaultMaterial(bbox), copperThickness: 0.5 }, bbox)
    expect(w[0].level).toBe('warning')
  })

  it('a new stock size keeps a centred board centred (D-036)', () => {
    const m = defaultMaterial(bbox) // 55 x 45, board 50 x 40 centred
    expect(boardCentred(m, bbox)).toBe(true)
    const r = resizeKeepingCentre(m, { ...m, width: 100, height: 80 }, bbox)
    expect(r.offsetX).toBe(25)
    expect(r.offsetY).toBe(20)
    expect(boardCentred(r, bbox)).toBe(true)
  })

  it('an axis placed by the user keeps its offset when the size changes', () => {
    const m = { ...defaultMaterial(bbox), offsetX: 1 } // X moved to the left, Y still centred
    const r = resizeKeepingCentre(m, { ...m, width: 100, height: 80 }, bbox)
    expect(r.offsetX).toBe(1)
    expect(r.offsetY).toBe(20)
    expect(boardCentred(r, bbox)).toBe(false)
  })
})
