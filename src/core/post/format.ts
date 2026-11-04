import type { Tool } from '../model/types'

/** Format a number with at most `decimals` places, trailing zeros stripped, never "-0". */
export function fmtNum(v: number, decimals: number): string {
  let s = v.toFixed(Math.max(0, Math.min(8, decimals)))
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  if (s === '-0') s = '0'
  return s
}

/** File-name friendly slug: lower case, a-z0-9 and "-" only. */
export function slug(s: string): string {
  const out = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return out || 'untitled'
}

/** Project name made safe for file names (keeps case, replaces reserved characters). */
export function safeFileBase(s: string): string {
  const out = Array.from(s, (c) => (c.charCodeAt(0) < 32 ? '_' : c))
    .join('')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
  return out || 'untitled'
}

/** Remove characters that would terminate or confuse a G-code comment. */
export function sanitizeComment(s: string): string {
  return s
    .replace(/\(/g, '[')
    .replace(/\)/g, ']')
    .replace(/;/g, ',')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\x20-\x7e]/g, (c) => (c === '°' ? 'deg' : c === '—' || c === '–' ? '-' : '?'))
    .trim()
}

/** "1 h 02 min 03 s" style duration. */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min ${String(r).padStart(2, '0')} s`
  if (m > 0) return `${m} min ${String(r).padStart(2, '0')} s`
  return `${r} s`
}

const TYPE_WORD: Record<Tool['type'], string> = {
  flat: 'flat end mill',
  ball: 'ball end mill',
  drill: 'drill',
  vbit: 'V-bit',
  corn: 'corn end mill'
}

/** Human description of a tool, e.g. "#3 0.8 mm drill". */
export function toolLabel(tool: Tool): string {
  const g = tool.geometry
  let desc: string
  if (tool.type === 'vbit') {
    const parts = [`${g.tipAngle ?? 0}deg V-bit`]
    if (g.tipDiameter !== undefined) parts.push(`${fmtNum(g.tipDiameter, 3)} mm tip`)
    desc = parts.join(' ')
  } else desc = `${fmtNum(g.diameter, 3)} mm ${TYPE_WORD[tool.type]}`
  const name = tool.name.trim()
  const extra = name && name.toLowerCase() !== desc.toLowerCase() ? ` "${name}"` : ''
  return sanitizeComment(`#${tool.number} ${desc}${extra}`)
}
