/**
 * Small UI helpers for the tool library (labels, tabs, numbering, type switching).
 */
import type { StepKind, Tool, ToolType } from '@core/model/types'
import { createTool, TOOL_TYPE_INFO } from '@core/tools'
import { STEP_KIND_INFO } from '@core/cam'

export type ToolTab = 'all' | ToolType

export const TOOL_TABS: { value: ToolTab; label: string }[] = [
  { value: 'all', label: 'All tools' },
  { value: 'flat', label: 'Flat end mill' },
  { value: 'ball', label: 'Ball end mill' },
  { value: 'drill', label: 'Drill' },
  { value: 'vbit', label: 'V-bit' },
  { value: 'corn', label: 'Corn / PCB router' }
]

export const TOOL_TYPES: ToolType[] = ['vbit', 'flat', 'ball', 'drill', 'corn']

/** Short in-sentence names for tool types. */
export const TOOL_NOUN: Record<ToolType, string> = {
  vbit: 'V-bit',
  flat: 'flat end mill',
  ball: 'ball end mill',
  drill: 'drill bit',
  corn: 'corn (PCB router) bit'
}

/** Accent colour per tool type (tailwind classes). */
export const TOOL_ACCENT: Record<ToolType, string> = {
  vbit: 'text-amber-300',
  flat: 'text-sky-300',
  ball: 'text-violet-300',
  drill: 'text-emerald-300',
  corn: 'text-orange-300'
}

export function typeList(types: ToolType[]): string {
  const names = types.map((t) => TOOL_NOUN[t])
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

/** "This step needs: V-bit, flat end mill or ball end mill". */
export function stepNeedsText(kind: StepKind): string {
  return `This step needs: ${typeList(STEP_KIND_INFO[kind].allowedToolTypes)}`
}

/** Smallest positive tool number not used by any tool. */
export function nextToolNumber(tools: Tool[]): number {
  const used = new Set(tools.map((t) => t.number))
  let n = 1
  while (used.has(n)) n++
  return n
}

/** Formats a size compactly: 3.175 → "3.175", 1 → "1.0", 0.10 → "0.1". */
export function fmtMm(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—'
  if (Number.isInteger(v)) return v.toFixed(1)
  return String(Number(v.toFixed(3)))
}

/** One-line geometry summary for cards. */
export function toolSummary(t: Tool): string {
  const g = t.geometry
  if (t.type === 'vbit') return `${g.tipAngle ?? '?'}° · tip ${fmtMm(g.tipDiameter)} mm`
  if (t.type === 'drill') return `Ø ${fmtMm(g.diameter)} mm · ${g.pointAngle ?? 118}° point`
  return `Ø ${fmtMm(g.diameter)} mm · ${fmtMm(g.fluteLength)} mm long`
}

/**
 * Returns a copy of `t` converted to another type: geometry fields that only exist for the new type get
 * sensible defaults, fields that do not apply are dropped, and sizes that still make sense are kept.
 */
export function changeToolType(t: Tool, type: ToolType): Tool {
  if (t.type === type) return t
  const fresh = createTool(type)
  const keepSize = t.type !== 'vbit' && type !== 'vbit'
  const g = { ...fresh.geometry }
  if (keepSize) {
    g.diameter = t.geometry.diameter
    g.fluteLength = t.geometry.fluteLength
  }
  if (type !== 'corn' && t.type !== 'corn' && type !== 'vbit' && t.type !== 'vbit')
    g.flutes = t.geometry.flutes
  const og = t.geometry
  const autoName =
    !t.name.trim() ||
    t.name === defaultToolName(t.type, og.diameter, og.tipAngle, og.tipDiameter) ||
    t.name.startsWith(TOOL_TYPE_INFO[t.type].label)
  return {
    ...t,
    type,
    geometry: g,
    feeds: { ...fresh.feeds },
    name: autoName ? defaultToolName(type, g.diameter, g.tipAngle, g.tipDiameter) : t.name
  }
}

export function defaultToolName(type: ToolType, d: number, tipAngle?: number, tip?: number): string {
  switch (type) {
    case 'vbit':
      return `V-bit ${tipAngle ?? 30}° ${fmtMm(tip ?? 0.1)} mm`
    case 'drill':
      return `Drill ${fmtMm(d)} mm`
    case 'corn':
      return `Corn router bit ${fmtMm(d)} mm`
    case 'ball':
      return `Ball end mill ${fmtMm(d)} mm`
    default:
      return `Flat end mill ${fmtMm(d)} mm`
  }
}

/** Width of the cut at the surface for a tool plunged `depth` mm (V-bit and ball depend on depth). */
export function cutWidthAt(t: Tool, depth: number): number {
  const g = t.geometry
  const d = Math.max(0, depth)
  if (t.type === 'vbit') {
    const half = ((g.tipAngle ?? 60) * Math.PI) / 360
    return Math.min(g.diameter, Math.max((g.tipDiameter ?? 0) + 2 * d * Math.tan(half), 1e-3))
  }
  if (t.type === 'ball') {
    const R = g.diameter / 2
    if (d >= R) return g.diameter
    return 2 * Math.sqrt(Math.max(0, R * R - (R - d) * (R - d)))
  }
  return g.diameter
}

/** Deep-equal for tools (flat JSON objects). */
export function sameTool(a: Tool | null | undefined, b: Tool | null | undefined): boolean {
  if (!a || !b) return a === b
  return deepEqual(a, b)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}
