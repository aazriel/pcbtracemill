import type { MaterialIssue } from '@core/cam'
import type { StatusLevel } from '@renderer/components/ui/status'

export type MaterialSectionId = 'size' | 'copper' | 'placement' | 'origin' | 'sides'

const FIELD_SECTION: Record<string, MaterialSectionId> = {
  width: 'size',
  height: 'size',
  thickness: 'size',
  copperThickness: 'copper',
  offsetX: 'placement',
  offsetY: 'placement',
  rotation: 'placement',
  origin: 'origin',
  doubleSided: 'sides'
}

export function issueSection(field: string): MaterialSectionId {
  if (field.startsWith('alignment')) return 'sides'
  return FIELD_SECTION[field] ?? 'size'
}

export function sectionLevel(issues: MaterialIssue[], section: MaterialSectionId): StatusLevel {
  const mine = issues.filter((i) => issueSection(i.field) === section)
  if (mine.some((i) => i.level === 'error')) return 'error'
  if (mine.some((i) => i.level === 'warning')) return 'warning'
  return 'ok'
}

/** Inline messages for one field: `{ error, warning }` ready for FieldShell. */
export function fieldMessages(
  issues: MaterialIssue[],
  field: string
): { error: string | null; warning: string | null } {
  const mine = issues.filter((i) => i.field === field)
  return {
    error:
      mine
        .filter((i) => i.level === 'error')
        .map((i) => i.message)
        .join(' ') || null,
    warning:
      mine
        .filter((i) => i.level === 'warning')
        .map((i) => i.message)
        .join(' ') || null
  }
}

export function overallLevel(issues: MaterialIssue[]): StatusLevel {
  if (issues.some((i) => i.level === 'error')) return 'error'
  if (issues.some((i) => i.level === 'warning')) return 'warning'
  return 'ok'
}

export const ORIGIN_LABEL: Record<string, string> = {
  'bottom-left': 'Bottom-left corner (front left)',
  'bottom-right': 'Bottom-right corner (front right)',
  'top-left': 'Top-left corner (back left)',
  'top-right': 'Top-right corner (back right)',
  center: 'Centre of the material'
}

export const copperLabel = (mm: number): string => {
  const um = Math.round(mm * 1000 * 10) / 10
  const oz =
    Math.abs(mm - 0.035) < 1e-6
      ? ' (1 oz)'
      : Math.abs(mm - 0.07) < 1e-6
        ? ' (2 oz)'
        : Math.abs(mm - 0.018) < 1e-6
          ? ' (½ oz)'
          : ''
  return `${um} µm${oz}`
}

export const mm = (v: number, d = 1): string => (Number.isFinite(v) ? String(Number(v.toFixed(d))) : '—')
