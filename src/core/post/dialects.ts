import type { MachineProfile, PostProcessorId } from '../model/types'

/**
 * Fully resolved output options for one export. A dialect turns a MachineProfile into these;
 * the emitter only looks at PostOptions, never at the dialect id.
 */
export interface PostOptions {
  dialect: PostProcessorId
  /** Emit G20 and convert all lengths/feeds to inches. */
  inch: boolean
  decimals: number
  /** Emit G2/G3 (else arcs are linearised). */
  arcs: boolean
  /** Emit G81/G83 for drill segments (else explicit moves). */
  cannedCycles: boolean
  /** Emit "Tn M6" (else M5 + M0 manual change). */
  toolChange: boolean
  /** After an M6, apply tool length offset with "G43 Hn". */
  toolLengthOffset: boolean
  /** Emit S words. */
  spindleSpeed: boolean
  spinUpSec: number
  lineNumbers: boolean
  comment: 'parens' | 'semicolon'
  /** Wrap the program in "%" lines. */
  percentWrap: boolean
  /** Modal setup lines after the units line (without units). */
  preamble: string[]
  /** Program end code. */
  endCode: 'M30' | 'M2'
  customHeader: string[]
  customFooter: string[]
}

export interface Dialect {
  id: PostProcessorId
  label: string
  /** One-line description shown in the UI. */
  description: string
  resolve(machine: MachineProfile): PostOptions
}

const splitLines = (s: string): string[] =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

/** Options every dialect starts from: the machine profile taken literally. */
function fromMachine(m: MachineProfile, dialect: PostProcessorId): PostOptions {
  return {
    dialect,
    inch: m.outputUnits === 'inch',
    decimals: Math.max(0, Math.min(6, Math.round(m.decimals))),
    arcs: m.supportsArcs,
    cannedCycles: m.supportsCannedCycles,
    toolChange: m.supportsToolChange,
    toolLengthOffset: false,
    spindleSpeed: m.spindleSpeedControl,
    spinUpSec: Math.max(0, m.spindleSpinUpSec),
    lineNumbers: m.lineNumbers,
    comment: m.commentStyle,
    percentWrap: false,
    preamble: ['G90 G94 G17'],
    endCode: 'M30',
    customHeader: splitLines(m.customHeader),
    customFooter: splitLines(m.customFooter)
  }
}

export const mach3: Dialect = {
  id: 'mach3',
  label: 'Mach3 / Mach4',
  description: 'Parenthesis comments, M6 tool change with G43 tool length offset, G81/G83 drilling, M30.',
  resolve(m) {
    return {
      ...fromMachine(m, 'mach3'),
      // Mach3 only reliably understands ( ) comments.
      comment: 'parens',
      toolLengthOffset: m.supportsToolChange,
      // G91.1: I/J relative to the arc start regardless of the "IJ mode" config setting.
      preamble: ['G90 G94 G17 G40 G49 G80', 'G91.1']
    }
  }
}

export const grbl: Dialect = {
  id: 'grbl',
  label: 'GRBL 1.1',
  description: 'No canned cycles, no line numbers, manual tool change via M0 unless the machine has an ATC.',
  resolve(m) {
    return {
      ...fromMachine(m, 'grbl'),
      // GRBL 1.1 has no G81/G83 (error:20); line numbers only waste the 128-byte RX buffer.
      cannedCycles: false,
      lineNumbers: false,
      preamble: ['G90 G94 G17']
    }
  }
}

export const linuxcnc: Dialect = {
  id: 'linuxcnc',
  label: 'LinuxCNC',
  description: '% wrapped, G64 P path blending, T M6 + G43, G81/G83 drilling, M2.',
  resolve(m) {
    const inch = m.outputUnits === 'inch'
    return {
      ...fromMachine(m, 'linuxcnc'),
      toolLengthOffset: m.supportsToolChange,
      percentWrap: true,
      // Blend tolerance 0.01 mm (0.0004 in): smooth motion without rounding trace corners noticeably.
      preamble: ['G90 G94 G17 G40 G49 G80', 'G91.1', inch ? 'G64 P0.0004' : 'G64 P0.01'],
      endCode: 'M2'
    }
  }
}

export const generic: Dialect = {
  id: 'generic',
  label: 'Generic RS-274',
  description: 'Honours every machine-profile flag literally, plus custom header/footer.',
  resolve(m) {
    return fromMachine(m, 'generic')
  }
}

/** Registry of all dialects, keyed by MachineProfile.postProcessor. */
export const DIALECTS: Record<PostProcessorId, Dialect> = { mach3, grbl, linuxcnc, generic }

export function resolvePostOptions(machine: MachineProfile): PostOptions {
  const d = DIALECTS[machine.postProcessor] ?? generic
  return d.resolve(machine)
}
