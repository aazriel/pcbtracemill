/** Presentation metadata for machine profiles (labels, capability list, field → error mapping). */
import type { MachineProfile, PostProcessorId } from '@core/model/types'

export const POST_LABEL: Record<PostProcessorId, string> = {
  mach3: 'Mach3',
  grbl: 'GRBL',
  linuxcnc: 'LinuxCNC',
  generic: 'Generic'
}

export const POST_OPTIONS: { value: PostProcessorId; label: string }[] = [
  { value: 'mach3', label: 'Mach3 / Mach4' },
  { value: 'grbl', label: 'GRBL (Candle, UGS, bCNC, Carbide Motion…)' },
  { value: 'linuxcnc', label: 'LinuxCNC' },
  { value: 'generic', label: 'Generic (plain, widely compatible)' }
]

export type CapabilityKey =
  'supportsArcs' | 'supportsCannedCycles' | 'supportsToolChange' | 'supportsProbing' | 'spindleSpeedControl'

export const CAPABILITIES: { key: CapabilityKey; label: string; short: string }[] = [
  { key: 'supportsArcs', label: 'Arcs', short: 'Smooth curves (G2/G3)' },
  { key: 'supportsCannedCycles', label: 'Canned drill cycles', short: 'One-line drilling (G81/G83)' },
  { key: 'supportsToolChange', label: 'Auto tool change', short: 'Changes bits by itself (M6)' },
  { key: 'supportsProbing', label: 'Probing', short: 'Can measure board height' },
  { key: 'spindleSpeedControl', label: 'Spindle speed control', short: 'Sets RPM from G-code' }
]

/** "Mach3 · .tap" */
export function outputSummary(m: MachineProfile): string {
  return `${POST_LABEL[m.postProcessor] ?? m.postProcessor} · .${m.fileExtension}`
}

/** "300 × 200 × 60 mm" */
export function workAreaSummary(m: MachineProfile): string {
  const r = (v: number): string => String(Math.round(v * 10) / 10)
  return `${r(m.workArea.x)} × ${r(m.workArea.y)} × ${r(m.workArea.z)} mm`
}

export type MachineFieldKey = keyof MachineProfile

/** Maps a validateMachine() message to the field it is about (so it can be shown inline). */
const ERROR_FIELDS: [RegExp, MachineFieldKey][] = [
  [/needs a name/i, 'name'],
  [/^Work area/i, 'workArea'],
  [/XY feed/i, 'maxFeedXY'],
  [/Z feed/i, 'maxFeedZ'],
  [/^Minimum spindle/i, 'spindleMin'],
  [/^Maximum spindle/i, 'spindleMax'],
  [/spin-up/i, 'spindleSpinUpSec'],
  [/^Decimal/i, 'decimals'],
  [/^Safe Z/i, 'safeZ'],
  [/^Travel Z/i, 'travelZ'],
  [/^Tool change Z/i, 'toolChangeZ'],
  [/^File extension/i, 'fileExtension'],
  [/probe command/i, 'probeCommand']
]

export function errorField(message: string): MachineFieldKey | null {
  for (const [re, key] of ERROR_FIELDS) if (re.test(message)) return key
  return null
}

/** Groups errors by field; messages that match no field are returned under `null`. */
export function errorsByField(errors: string[]): Map<MachineFieldKey | null, string[]> {
  const map = new Map<MachineFieldKey | null, string[]>()
  for (const e of errors) {
    const k = errorField(e)
    map.set(k, [...(map.get(k) ?? []), e])
  }
  return map
}
