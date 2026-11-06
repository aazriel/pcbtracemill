import type { MachineProfile, ProbeGridConfig } from '../model/types'
import { fmtNum } from '../post/format'
import { gridStep, probePoints } from './grid'

type ProbeDialect = 'grbl' | 'linuxcnc' | 'mach3' | 'generic'

/** File name LinuxCNC writes probe results to (relative to the LinuxCNC config directory). */
export const LINUXCNC_PROBE_FILE = 'probe-results.txt'

/**
 * Generate a serpentine grid probing program for auto-levelling.
 *
 * The program never changes work offsets (no G92 / G10): the operator zeroes Z on the copper
 * at the first probe point before running it, and TraceMill makes the height map relative to
 * that first point. Output is always metric (G21) regardless of the machine's output units.
 */
export function generateProbeProgram(cfg: ProbeGridConfig, machine: MachineProfile): string {
  const dialect: ProbeDialect = machine.postProcessor
  const probe = dialect === 'mach3' ? 'G31' : dialect === 'generic' ? machine.probeCommand : 'G38.2'
  const d = Math.max(3, Math.min(6, machine.decimals))
  const n = (v: number): string => fmtNum(v, d)
  const c = (t: string): string => `(${t.replace(/[()]/g, '')})`
  const pts = probePoints(cfg)
  const { dx, dy } = gridStep(cfg)
  const clear = Math.max(cfg.clearanceZ, 0.5)
  const depth = cfg.probeDepth < 0 ? cfg.probeDepth : -Math.abs(cfg.probeDepth || 2)
  const feed = cfg.probeFeed > 0 ? cfg.probeFeed : 50
  const L: string[] = []

  if (dialect === 'linuxcnc') L.push('%')
  L.push(c(`TraceMill auto-level probe program - ${dialect} - ${probe}`))
  L.push(
    c(
      `Grid ${cfg.countX} x ${cfg.countY} = ${pts.length} points, X${n(cfg.minX)}..${n(cfg.maxX)} Y${n(cfg.minY)}..${n(cfg.maxY)}, spacing ${fmtNum(dx, 2)} x ${fmtNum(dy, 2)} mm`
    )
  )
  L.push(c(`Probe feed ${fmtNum(feed, 1)} mm/min, max depth Z${n(depth)}, clearance Z${n(clear)}`))
  L.push(c('SAFETY: clip the probe wire to the bit and the ground clip to the copper board'))
  L.push(c('SAFETY: test continuity first - touch clip to bit and check the controller sees the probe'))
  L.push(c('SAFETY: start with the bit ABOVE the board, spindle OFF'))
  L.push(c('SAFETY: probe with a sturdy bit - flat end mill or steel pin - not a V-bit, a thin tip breaks'))
  L.push(
    c(
      `SETUP: zero X/Y as for milling and zero Z on the copper at the first point X${n(pts[0].x)} Y${n(pts[0].y)}`
    )
  )
  L.push(c('This program does not change work offsets. Heights are relative to the first probed point.'))
  L.push(c('After a bit change Z0 must be at the copper of the first point again.'))
  L.push(c('TraceMill corrected files can find it with the probe - set Z only roughly then.'))
  if (dialect === 'grbl') {
    L.push(
      c('RESULTS: GRBL prints [PRB:x,y,z:1] for every point. Save the sender console log and import it.')
    )
    L.push(c('GRBL reports machine coordinates. TraceMill aligns them to this grid using the first point.'))
    L.push(c('GRBL raises an ALARM if the probe never touches - nothing is damaged, check the clip.'))
  } else if (dialect === 'linuxcnc') {
    L.push(
      c(`RESULTS: written to ${LINUXCNC_PROBE_FILE} in the LinuxCNC config directory. Import that file.`)
    )
  } else if (dialect === 'mach3') {
    L.push(
      c('RESULTS: M40 / M41 must exist as macros: M40.m1s containing OpenDigFile and M41.m1s CloseDigFile.')
    )
    L.push(c('M40 asks for a file name, each G31 then appends X,Y,Z to it. Import that file.'))
    L.push(c('Without the macros, remove M40/M41 and note #2000-#2002 X,Y,Z after every G31 manually.'))
    L.push(
      c('WARNING: Mach3 G31 does not stop with an error when nothing is touched - watch the first point.')
    )
  } else {
    L.push(
      c(`RESULTS: collect the probed X Y Z of every ${probe} from your controller and import them as CSV.`)
    )
  }
  L.push('G21')
  L.push('G90 G94 G17')
  if (dialect === 'mach3') L.push('G91.1')
  L.push(`G0 Z${n(clear)}`)
  if (dialect === 'linuxcnc') L.push(`(PROBEOPEN ${LINUXCNC_PROBE_FILE})`)
  if (dialect === 'mach3') L.push('M40 (open digitize file)')
  pts.forEach((p, i) => {
    L.push(`G0 X${n(p.x)} Y${n(p.y)}${i === 0 ? ' (first point = height reference)' : ''}`)
    L.push(`${probe} Z${n(depth)} F${fmtNum(feed, 1)}`)
    L.push(`G0 Z${n(clear)}`)
  })
  if (dialect === 'linuxcnc') L.push('(PROBECLOSE)')
  if (dialect === 'mach3') L.push('M41 (close digitize file)')
  L.push(`G0 X${n(pts[0].x)} Y${n(pts[0].y)}`)
  L.push(c('Probing finished. Remove the probe clip before milling.'))
  L.push(dialect === 'linuxcnc' ? 'M2' : 'M30')
  if (dialect === 'linuxcnc') L.push('%')
  return L.join('\n') + '\n'
}
