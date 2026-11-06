import type { PostProcessorId } from '../model/types'
import { tokenizeLine } from '../gcode/tokenize'
import { fmtNum } from '../post/format'

export interface TouchOffOptions {
  /** The height-map reference point (point 1 of the probe grid), work coordinates mm. */
  x: number
  y: number
  /** Probe feed mm/min – the same as while probing, so the trip overshoot is the same too. */
  feed: number
  /** Safe travel height, mm. */
  safeZ: number
  dialect: PostProcessorId
  /** Probe command for the generic dialect. */
  probeCommand?: string
  /**
   * Touch at most this fast (mm/min). The cutting bit touches here – a V-bit with a 0.1 mm tip
   * breaks at the usual probe feed before the controller stops – so one slow touch is used. It is
   * also the feed of the final touch of the Mach3 G-code-only probe program.
   */
  slowFeed?: number
}

/** The probe starts this far above the rough zero and searches this far below it (mm). */
export const TOUCH_OFF_START = 1
export const TOUCH_OFF_REACH = 1

/**
 * Insert a Z touch-off at the height-map reference point before the spindle starts for each bit
 * (the start of the file and after every bit change). The operator only needs to set Z zero
 * roughly (a sheet of paper); the program finds the copper at point 1 with the probe and sets Z0
 * there - the same point and the same probe feed the height map was measured relative to, so a
 * 0.1 mm isolation cut lands at the right depth whatever bit is in the spindle.
 *
 * GRBL / LinuxCNC use `G38.2` (stops with an error when nothing is touched) and `G10 L20 P0 Z0`;
 * Mach3 uses `G31` + `G92 Z0`; generic uses the machine's probe command + `G92 Z0`.
 */
export function addZTouchOff(gcode: string, o: TouchOffOptions): string {
  const lines = gcode.split(/\r?\n/)
  const out: string[] = []
  const parens = !/^\s*(N\d+\s*)?;/m.test(gcode)
  const c = (t: string): string => (parens ? `(${t.replace(/[()]/g, '')})` : `; ${t}`)
  let inch = false
  let needed = true // before the first spindle start, and after every M0 / M1 / M6
  let count = 0
  const probe = o.dialect === 'mach3' ? 'G31' : o.dialect === 'generic' ? o.probeCommand || 'G38.2' : 'G38.2'
  const setZero = o.dialect === 'grbl' || o.dialect === 'linuxcnc' ? 'G10 L20 P0 Z0' : 'G92 Z0'

  for (const line of lines) {
    const tok = tokenizeLine(line)
    let spindleOn = false
    let pause = false
    for (const w of tok.words) {
      if (w.letter === 'G' && Math.round(w.value) === 20) inch = true
      if (w.letter === 'G' && Math.round(w.value) === 21) inch = false
      if (w.letter === 'M') {
        const m = Math.round(w.value)
        if (m === 3 || m === 4) spindleOn = true
        if (m === 0 || m === 1 || m === 6) pause = true
      }
    }
    if (spindleOn && needed) {
      const s = inch ? 1 / 25.4 : 1
      const n = (v: number): string => fmtNum(v * s, inch ? 4 : 3)
      count++
      out.push(
        c(`==== Z TOUCH-OFF ${count}: find the copper at point 1 X${n(o.x)} Y${n(o.y)} and set Z0 there ====`)
      )
      out.push('M5')
      out.push(
        `M0 ${c('Z TOUCH-OFF: set Z zero ROUGHLY on the copper - a sheet of paper is enough - then clip the probe to the bit and press Cycle Start')}`
      )
      out.push(`G0 Z${n(o.safeZ)}`)
      out.push(`G0 X${n(o.x)} Y${n(o.y)}`)
      out.push(`G0 Z${n(TOUCH_OFF_START)}`)
      if (o.dialect === 'mach3')
        out.push(
          c('If nothing is touched Mach3 signals an error - watch the bit anyway, stop if it does not trip')
        )
      // One slow touch only: the cutting bit (often a V-bit with a 0.1 mm tip) is in the spindle
      out.push(
        `${probe} Z${n(-TOUCH_OFF_REACH)} F${fmtNum(Math.min(o.feed, o.slowFeed ?? o.feed) * s, 1)} ${c('slow - protects the tip')}`
      )
      out.push(`${setZero} ${c('Z0 = copper at point 1')}`)
      out.push(`G0 Z${n(o.safeZ)}`)
      out.push(`M0 ${c('Remove the probe clip from the bit, then press Cycle Start to mill')}`)
      needed = false
    }
    if (pause && !spindleOn) needed = true
    out.push(line)
  }
  return out.join('\n')
}
