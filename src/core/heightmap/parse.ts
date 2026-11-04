import type { ProbePoint } from './grid'

export type ProbeLogFormat = 'grbl' | 'linuxcnc' | 'mach3' | 'csv' | 'unknown'

export interface ParsedProbeResults {
  points: ProbePoint[]
  format: ProbeLogFormat
  warnings: string[]
}

const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?'
const PRB_RE = new RegExp(
  `\\[PRB:\\s*(${NUM})\\s*,\\s*(${NUM})\\s*,\\s*(${NUM})(?:\\s*,\\s*${NUM})*\\s*(?::\\s*(\\d))?\\s*\\]`,
  'i'
)
const NUM_RE = new RegExp(`^${NUM}$`)

const isNum = (s: string): boolean => NUM_RE.test(s.trim())

/**
 * Parse a probe result log:
 *  - GRBL console log with `[PRB:x,y,z:1]` lines (failed probes `:0` are skipped),
 *  - LinuxCNC PROBEOPEN file: whitespace separated `x y z [a b c u v w]`,
 *  - Mach3 digitize file: `x,y,z[,a,b,c]` comma separated,
 *  - generic CSV / whitespace / semicolon table with or without a header (x, y, z columns).
 */
export function parseProbeResults(text: string): ParsedProbeResults {
  const warnings: string[] = []
  const lines = text.split(/\r?\n/)

  if (lines.some((l) => /\[PRB:/i.test(l))) {
    const points: ProbePoint[] = []
    lines.forEach((l, i) => {
      if (!/\[PRB:/i.test(l)) return
      const m = PRB_RE.exec(l)
      if (!m) {
        warnings.push(`Line ${i + 1}: unreadable PRB report`)
        return
      }
      if (m[4] === '0') {
        warnings.push(`Line ${i + 1}: probe did not make contact - point skipped`)
        return
      }
      points.push({ x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) })
    })
    if (points.length)
      warnings.push('GRBL reports machine coordinates; X/Y are aligned to the probe grid on import')
    return { points, format: 'grbl', warnings }
  }

  let header: string[] | null = null
  let sepKind: 'comma' | 'space' | 'semicolon' | null = null
  const rows: { cols: string[]; line: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw || /^(#|;|\/\/|\(|%)/.test(raw)) continue
    const kind: 'comma' | 'space' | 'semicolon' = raw.includes(',')
      ? 'comma'
      : raw.includes(';')
        ? 'semicolon'
        : 'space'
    const cols = raw
      .split(kind === 'comma' ? ',' : kind === 'semicolon' ? ';' : /\s+/)
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter((s, k, a) => s.length > 0 || (kind !== 'space' && k < a.length - 1))
    if (cols.length < 3 || !cols.slice(0, 3).every(isNum)) {
      if (!rows.length && !header && cols.some((s) => /^[a-z]/i.test(s))) {
        header = cols.map((s) => s.toLowerCase())
        sepKind = kind
        continue
      }
      // A row that does not start with numbers: try to pick numbers out by header later, else skip.
      if (header && cols.length >= header.length) rows.push({ cols, line: i })
      else warnings.push(`Line ${i + 1}: ignored "${raw.slice(0, 40)}"`)
      continue
    }
    if (!sepKind) sepKind = kind
    rows.push({ cols, line: i })
  }

  let ix = 0
  let iy = 1
  let iz = 2
  if (header) {
    const find = (axis: string): number =>
      header!.findIndex((h) =>
        new RegExp(`^(pos_?|probe_?|work_?)?${axis}(\\b|_|\\s|\\(|\\[|$)`, 'i').test(h)
      )
    const fx = find('x')
    const fy = find('y')
    const fz = find('z')
    if (fx >= 0 && fy >= 0 && fz >= 0) {
      ix = fx
      iy = fy
      iz = fz
    } else warnings.push('Header has no x / y / z columns; using the first three columns')
  }

  const points: ProbePoint[] = []
  for (const r of rows) {
    const x = Number(r.cols[ix])
    const y = Number(r.cols[iy])
    const z = Number(r.cols[iz])
    if ([r.cols[ix], r.cols[iy], r.cols[iz]].some((s) => s === undefined || !isNum(s))) {
      warnings.push(`Line ${r.line + 1}: not a probe point`)
      continue
    }
    points.push({ x, y, z })
  }

  let format: ProbeLogFormat = 'unknown'
  if (points.length) {
    if (header) format = 'csv'
    else if (sepKind === 'comma') format = 'mach3'
    else if (sepKind === 'space') format = 'linuxcnc'
    else format = 'csv'
  } else warnings.push('No probe points found')
  return { points, format, warnings }
}
