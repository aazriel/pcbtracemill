import type { HeightMap, MachineProfile, ProbeGridConfig } from '../model/types'
import { fmtNum } from '../post/format'
import { gridStep, probePoints } from './grid'

type ProbeDialect = 'grbl' | 'linuxcnc' | 'mach3' | 'generic'

/** File name LinuxCNC writes probe results to (relative to the LinuxCNC config directory). */
export const LINUXCNC_PROBE_FILE = 'probe-results.txt'

/** Where the TraceMill Mach3 macros write the probe results (editable at the top of the macros). */
export const MACH3_PROBE_FILE = 'C:/Mach3/TraceMill-probe.txt'

/** First Mach3 variable that holds a height (cell k of the grid is #(MACH3_VAR_BASE + k)). */
export const MACH3_VAR_BASE = 500
/** Mach3 variables #500-#999 are used, so at most this many grid cells. */
export const MACH3_VAR_MAX_CELLS = 500
/**
 * Mach3 G-code-only probing: after the first (fast) touch lift this far – far enough for a board
 * pressed down by the overshoot to spring back – and touch again slowly at MACH3_RETOUCH_FEED
 * (1 mm in 3 s). The slow touch is the height that is recorded.
 */
export const MACH3_RETOUCH_LIFT = 1
export const MACH3_RETOUCH_FEED = 20
/** The cutting bit touches off at most this fast (a 0.1 mm V-bit tip). */
export const MACH3_SLOW_FEED = 10
/** Variables used for bookkeeping by the Mach3 G-code-only probe program. */
const VAR_G92 = 498
const VAR_DONE = 499

/**
 * The height map of a Mach3 G-code-only probe run: TraceMill never sees the heights, they stay in
 * Mach3 variables and the corrected files read them (D-025).
 */
export function mach3VariablesHeightMap(cfg: ProbeGridConfig): HeightMap {
  return {
    config: cfg,
    z: new Array<number>(cfg.countX * cfg.countY).fill(0),
    source: `Mach3 variables #${MACH3_VAR_BASE}-#${MACH3_VAR_BASE + cfg.countX * cfg.countY - 1}`,
    mach3Vars: MACH3_VAR_BASE
  }
}

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
export interface ProbeProgramOptions {
  /**
   * How Mach3 records the points: its built-in digitize file (M40 / M41 macros that ship with most
   * Mach3 installs, default) or the TraceMill macros M401 / M402 – only for setups where the digitize
   * file records wrong numbers.
   */
  mach3Recorder?: Mach3Recorder
}

/**
 * How Mach3 records the probed heights:
 *  - `variables` (default): no file at all. Each touch is read in G-code through the G92 offset
 *    (#5213) and kept in Mach3 variables #500…; the corrected files read them (D-025). Works with
 *    motion controllers that never report the probe trip position (#2000-#2002 stay stale).
 *  - `digitize`: Mach3's own M40 / M41 digitize file, imported into TraceMill.
 *  - `macros`: the TraceMill macros M401 / M402 write the DRO position to a file.
 */
export type Mach3Recorder = 'variables' | 'digitize' | 'macros'

export function generateProbeProgram(
  cfg: ProbeGridConfig,
  machine: MachineProfile,
  opts: ProbeProgramOptions = {}
): string {
  const dialect: ProbeDialect = machine.postProcessor
  const recorder: Mach3Recorder = opts.mach3Recorder ?? 'variables'
  const macros = dialect === 'mach3' && recorder === 'macros'
  const vars = dialect === 'mach3' && recorder === 'variables'
  if (vars && cfg.countX * cfg.countY > MACH3_VAR_MAX_CELLS)
    throw new Error(
      `Mach3 can keep at most ${MACH3_VAR_MAX_CELLS} heights - use fewer points (now ${cfg.countX} x ${cfg.countY}).`
    )
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
  L.push(
    c(
      vars
        ? 'Work offsets stay as they are - G92 is used for a moment at each point and put back. Heights are relative to point 1.'
        : 'This program does not change work offsets. Heights are relative to the first probed point.'
    )
  )
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
    if (vars) {
      L.push(c('RESULTS: no file. Every height is kept in Mach3 variables'))
      L.push(c(`#${MACH3_VAR_BASE}-#${MACH3_VAR_BASE + cfg.countX * cfg.countY - 1} until Mach3 is closed.`))
      L.push(c('The corrected TraceMill files read them - run them in the same Mach3 session.'))
      L.push(c('Do not close Mach3 between probing and milling, or probe again.'))
      L.push(
        c(
          `Each point: fast touch, up ${fmtNum(MACH3_RETOUCH_LIFT, 1)} mm, slow touch at F${MACH3_RETOUCH_FEED}, height read with G92 / #5213.`
        )
      )
    } else if (macros) {
      L.push(c('RESULTS: needs the TraceMill macros M401.m1s and M402.m1s in C:/Mach3/macros/<profile>/'))
      L.push(c('Save them from the TraceMill probe dialog. M401 starts the file, M402 after every G31'))
      L.push(c(`waits for the machine to stop and writes the DRO X,Y,Z to ${MACH3_PROBE_FILE}`))
      L.push(c('Import that file.'))
    } else {
      L.push(
        c('RESULTS: M40 / M41 must exist as macros: M40.m1s containing OpenDigFile and M41.m1s CloseDigFile.')
      )
      L.push(c('M40 asks for a file name, each G31 then appends X,Y,Z to it. Import that file.'))
    }
    L.push(
      c('WARNING: if nothing is touched Mach3 signals an error and stops - check the clip, then restart.')
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
  if (vars) {
    L.push(`#${VAR_DONE}=0 (heights not complete yet)`)
    L.push(`#${VAR_G92}=#5213 (keep the G92 Z offset that is active now)`)
  } else if (dialect === 'mach3')
    L.push(macros ? 'M401 (TraceMill: start a new results file)' : 'M40 (open digitize file)')
  pts.forEach((p, i) => {
    L.push(`G0 X${n(p.x)} Y${n(p.y)}${i === 0 ? ' (first point = height reference)' : ''}`)
    L.push(`${probe} Z${n(depth)} F${fmtNum(feed, 1)}`)
    if (macros) L.push('M402 (TraceMill: write where the probe stopped)')
    if (vars) {
      const v = MACH3_VAR_BASE + p.iy * cfg.countX + p.ix
      L.push('G91')
      L.push(`G0 Z${n(MACH3_RETOUCH_LIFT)}`)
      L.push('G90')
      L.push(`${probe} Z${n(depth)} F${fmtNum(Math.min(feed, MACH3_RETOUCH_FEED), 1)}`)
      L.push('G92 Z0')
      L.push(`#${v}=[#5213-#${VAR_G92}]`)
      L.push(`G92 Z#${v}`)
    }
    L.push(`G0 Z${n(clear)}`)
  })
  if (vars) {
    // heights relative to point 1, then fill cells that were not probed from their neighbours
    const ref = MACH3_VAR_BASE + pts[0].iy * cfg.countX + pts[0].ix
    const probed = new Set(pts.map((p) => p.iy * cfg.countX + p.ix))
    L.push(c('Make every height relative to point 1'))
    for (const k of [...probed].sort((a, b) => a - b))
      if (MACH3_VAR_BASE + k !== ref) L.push(`#${MACH3_VAR_BASE + k}=[#${MACH3_VAR_BASE + k}-#${ref}]`)
    const fills: string[] = []
    for (let k = 0; k < cfg.countX * cfg.countY; k++) {
      if (probed.has(k)) continue
      const near = [...probed]
        .map((q) => ({
          q,
          d2:
            ((q % cfg.countX) - (k % cfg.countX)) ** 2 * dx * dx +
            (Math.floor(q / cfg.countX) - Math.floor(k / cfg.countX)) ** 2 * dy * dy
        }))
        .sort((a, b) => a.d2 - b.d2 || a.q - b.q)
        .slice(0, 4)
      const ws = near.map((a) => 1 / Math.max(a.d2, 1e-12))
      const sum = ws.reduce((a, b) => a + b, 0)
      fills.push(
        `#${MACH3_VAR_BASE + k}=[${near.map((a, i) => `[${fmtNum(ws[i] / sum, 4)}*#${MACH3_VAR_BASE + a.q}]`).join('+')}]`
      )
    }
    L.push(`#${ref}=0`)
    if (fills.length) {
      L.push(c('Points outside the board were not probed - fill them in from the nearest ones'))
      L.push(...fills)
    }
    L.push(`#${VAR_DONE}=1 (heights complete)`)
  }
  if (dialect === 'linuxcnc') L.push('(PROBECLOSE)')
  if (dialect === 'mach3' && !macros && !vars) L.push('M41 (close digitize file)')
  L.push(`G0 X${n(pts[0].x)} Y${n(pts[0].y)}`)
  L.push(c('Probing finished. Remove the probe clip before milling.'))
  L.push(dialect === 'linuxcnc' ? 'M2' : 'M30')
  if (dialect === 'linuxcnc') L.push('%')
  return L.join('\n') + '\n'
}
