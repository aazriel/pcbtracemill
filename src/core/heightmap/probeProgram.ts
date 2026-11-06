import type { MachineProfile, ProbeGridConfig } from '../model/types'
import { fmtNum } from '../post/format'
import { gridStep, probePoints } from './grid'

type ProbeDialect = 'grbl' | 'linuxcnc' | 'mach3' | 'generic'

/** File name LinuxCNC writes probe results to (relative to the LinuxCNC config directory). */
export const LINUXCNC_PROBE_FILE = 'probe-results.txt'

/** Where the TraceMill Mach3 macros write the probe results (editable at the top of the macros). */
export const MACH3_PROBE_FILE = 'C:/Mach3/TraceMill-probe.txt'

/**
 * Mach3 macros used by the probe program instead of the built-in digitize file (M40/M41). The
 * digitize file is written when the G31 is *interpreted*, which with many motion-controller plugins
 * (UC100, ESS, …) happens before the move is finished: it then holds the target Z and stale X/Y
 * although the machine probed correctly. M402 waits until the machine has stopped and writes the
 * DRO position, which is where the probe really stopped.
 */
const CRLF = String.fromCharCode(13, 10)

export function mach3ProbeMacros(file = MACH3_PROBE_FILE): { name: string; text: string }[] {
  const head = (what: string): string[] => [
    `' TraceMill - ${what}`,
    "' Copy into the folder Mach3/macros/<your profile, e.g. Mach3Mill>/ and restart Mach3.",
    `Const ResultFile = "${file}"`
  ]
  return [
    {
      name: 'M401.m1s',
      text:
        [
          ...head('M401: start a new probe results file (used by the TraceMill probe program).'),
          'Open ResultFile For Output As #1',
          'Close #1',
          'Message "TraceMill probing: results go to " & ResultFile'
        ].join(CRLF) + CRLF
    },
    {
      name: 'M402.m1s',
      text:
        [
          ...head('M402: write where the probe stopped (call right after every G31).'),
          "' Wait until the machine has really stopped, then read the position (DROs, work coordinates).",
          'While IsMoving()',
          '  Sleep 20',
          'Wend',
          'Sleep 50',
          'x = GetDRO(0)',
          'y = GetDRO(1)',
          'z = GetDRO(2)',
          "' Str() always writes a decimal point, whatever the Windows language settings are.",
          'Open ResultFile For Append As #1',
          'Print #1, Trim(Str(x)) & "," & Trim(Str(y)) & "," & Trim(Str(z))',
          'Close #1'
        ].join(CRLF) + CRLF
    }
  ]
}

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
    L.push(c('RESULTS: needs the TraceMill macros M401.m1s and M402.m1s in C:/Mach3/macros/<profile>/'))
    L.push(c('Save them from the TraceMill probe dialog. M401 starts the file, M402 after every G31'))
    L.push(c(`waits for the machine to stop and writes the DRO X,Y,Z to ${MACH3_PROBE_FILE}`))
    L.push(c('Import that file. The Mach3 digitize file M40/M41 is not used: with many motion'))
    L.push(c('controllers it records the target Z and old X/Y instead of where the probe stopped.'))
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
  if (dialect === 'mach3') L.push('M401 (TraceMill: start a new results file)')
  pts.forEach((p, i) => {
    L.push(`G0 X${n(p.x)} Y${n(p.y)}${i === 0 ? ' (first point = height reference)' : ''}`)
    L.push(`${probe} Z${n(depth)} F${fmtNum(feed, 1)}`)
    if (dialect === 'mach3') L.push('M402 (TraceMill: write where the probe stopped)')
    L.push(`G0 Z${n(clear)}`)
  })
  if (dialect === 'linuxcnc') L.push('(PROBECLOSE)')
  L.push(`G0 X${n(pts[0].x)} Y${n(pts[0].y)}`)
  L.push(c('Probing finished. Remove the probe clip before milling.'))
  L.push(dialect === 'linuxcnc' ? 'M2' : 'M30')
  if (dialect === 'linuxcnc') L.push('%')
  return L.join('\n') + '\n'
}
