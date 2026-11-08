/**
 * Display units. Everything in PCB TraceMill is stored and computed in millimetres; the project setting
 * `units` only changes what is shown and typed.
 */
import type { DisplayUnits } from '@core/model/types'
import { useProject } from '@renderer/store/project'

export const MM_PER_INCH = 25.4

export function useUnits(): DisplayUnits {
  return useProject((s) => s.settings.units ?? 'mm')
}

export function getUnits(): DisplayUnits {
  return useProject.getState().settings.units ?? 'mm'
}

/** How a unit label maps to the chosen display units: factor = shown per stored value. */
export function convertUnit(
  unit: string | undefined,
  units: DisplayUnits
): { unit?: string; factor: number } {
  if (units !== 'inch' || !unit) return { unit, factor: 1 }
  if (unit === 'mm') return { unit: 'in', factor: 1 / MM_PER_INCH }
  if (unit === 'mm/min') return { unit: 'in/min', factor: 1 / MM_PER_INCH }
  if (unit === 'mm²') return { unit: 'in²', factor: 1 / (MM_PER_INCH * MM_PER_INCH) }
  return { unit, factor: 1 }
}

/** A length (mm) written in the display units, e.g. "1.25 mm" or "0.0492 in". */
export function fmtLength(mm: number, units: DisplayUnits, mmDecimals = 3): string {
  if (!Number.isFinite(mm)) return '—'
  if (units === 'inch') return `${trim((mm / MM_PER_INCH).toFixed(mmDecimals + 1))} in`
  return `${trim(mm.toFixed(mmDecimals))} mm`
}

/** A length as a bare number in the display units (no unit label). */
export function lengthValue(mm: number, units: DisplayUnits, mmDecimals = 3): string {
  return units === 'inch' ? (mm / MM_PER_INCH).toFixed(mmDecimals + 1) : mm.toFixed(mmDecimals)
}

export function unitLabel(units: DisplayUnits): string {
  return units === 'inch' ? 'in' : 'mm'
}

function trim(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}
