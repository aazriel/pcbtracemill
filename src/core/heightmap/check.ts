import type { HeightMap, ProbeGridConfig } from '../model/types'
import { buildHeightMap, gridStep, probePoints, type ProbePoint } from './grid'
import { parseProbeResults, type ProbeLogFormat } from './parse'

export interface ProbeCheck {
  /** Problems that make the results unusable: no height map is built. */
  errors: string[]
  /** Notes about points that were left out or look odd; the map is still built. */
  warnings: string[]
  /** The points to build the map from (bad ones removed). */
  points: ProbePoint[]
}

const fmt = (v: number, d = 2): string => String(Math.round(v * 10 ** d) / 10 ** d)

/**
 * Sanity checks on probe results before they become a height map. A probe that never touches the
 * copper (bad clip, oxidised board, broken wire) still produces a "result" on controllers that do not
 * stop on a failed probe (Mach3 `G31`): the depth limit. A perfectly flat map built from those numbers
 * would silently cut nothing at all, so such results are rejected with an explanation.
 *
 * - Points at the program's maximum probe depth never touched anything.
 * - All points at exactly the same height cannot be real (copper is never that flat).
 * - Mach3 / LinuxCNC write the position where the probe stopped; when it differs from where the
 *   program sent the machine, an axis was stopped (soft limit) or X0 / Y0 was not where expected.
 */
export function checkProbePoints(
  points: ProbePoint[],
  cfg: ProbeGridConfig | undefined,
  format: ProbeLogFormat
): ProbeCheck {
  const errors: string[] = []
  const warnings: string[] = []
  if (!points.length) return { errors, warnings, points }
  const n = points.length

  // ── 0. The same point on every line: nothing was measured at all.
  const p0 = points[0]
  if (
    n >= 4 &&
    points.every(
      (p) => Math.abs(p.x - p0.x) < 1e-6 && Math.abs(p.y - p0.y) < 1e-6 && Math.abs(p.z - p0.z) < 1e-6
    )
  ) {
    errors.push(
      `Every line of the file is the same point (X${fmt(p0.x, 3)} Y${fmt(p0.y, 3)} Z${fmt(p0.z, 3)}), ${n} times. ` +
        'The controller wrote one position over and over instead of where each touch happened.'
    )
    if (format === 'mach3') errors.push(MACH3_DIGITIZE_HINT)
    return { errors, warnings, points }
  }

  // ── 1. Never touched: Z at the maximum probe depth (GRBL never reports those points).
  let missed: boolean[] = new Array<boolean>(n).fill(false)
  let limit: number | null = null
  if (format !== 'grbl') {
    if (cfg && cfg.probeDepth < 0) {
      limit = cfg.probeDepth
      missed = points.map((p) => p.z <= limit! + 0.005)
    } else {
      // Unknown program: many points sharing the lowest value, and that value is a round number.
      const lo = Math.min(...points.map((p) => p.z))
      const atLo = points.map((p) => Math.abs(p.z - lo) < 1e-4)
      const count = atLo.filter(Boolean).length
      if (lo < 0 && count >= 3 && count >= n * 0.25 && Math.abs(lo * 10 - Math.round(lo * 10)) < 1e-6) {
        limit = lo
        missed = atLo
      }
    }
  }
  const missedCount = missed.filter(Boolean).length
  const zs = points.map((p) => p.z)
  const allSame = n >= 4 && Math.max(...zs) - Math.min(...zs) < 1e-6

  if (missedCount > 0 && limit !== null) {
    const depth = `Z${fmt(limit, 3)}`
    if (missedCount === n) {
      errors.push(
        `The probe never touched the board: all ${n} points stopped at the maximum probe depth (${depth}). ` +
          'The controller did not see the bit touching the copper.'
      )
    } else if (missed[0]) {
      errors.push(
        `Point 1 (the height reference) never touched the board: it stopped at the maximum probe depth (${depth}). ` +
          `${missedCount} of ${n} points did the same. Without point 1 the heights cannot be trusted.`
      )
    } else if (missedCount >= n * 0.3) {
      errors.push(
        `${missedCount} of ${n} points never touched the board (they stopped at the maximum probe depth, ${depth}). ` +
          'That is too many to fill in.'
      )
    } else {
      warnings.push(
        `${missedCount} of ${n} point${missedCount === 1 ? '' : 's'} never touched the board (stopped at ${depth}). ` +
          'They are left out and filled in from their neighbours – check the copper there is clean.'
      )
    }
  } else if (allSame) {
    errors.push(
      `All ${n} points report exactly the same height (Z${fmt(zs[0], 3)}). A real board is never that flat – ` +
        'the probe most likely never touched it, or the file holds the commanded positions instead of the measured ones.'
    )
  }

  // ── 2. Did the machine get where the program sent it? (Mach3 / LinuxCNC log work coordinates.)
  if (cfg && format !== 'grbl') {
    const plan = probePoints(cfg)
    const { dx, dy } = gridStep(cfg)
    const tol = Math.max(0.05, 0.1 * Math.min(dx || Infinity, dy || Infinity))
    if (n !== plan.length)
      warnings.push(
        `The file has ${n} points but the probe program has ${plan.length}. Was it stopped early, or is it from another program?`
      )
    let off = 0
    let example = ''
    const m = Math.min(n, plan.length)
    for (let i = 0; i < m; i++) {
      const a = plan[i]
      const b = points[i]
      if (Math.abs(a.x - b.x) > tol || Math.abs(a.y - b.y) > tol) {
        off++
        if (!example)
          example = `point ${i + 1} was sent to X${fmt(a.x)} Y${fmt(a.y)} but recorded at X${fmt(b.x)} Y${fmt(b.y)}`
      }
    }
    if (off > 0) {
      const text =
        `${off} of ${m} points were recorded somewhere else than the program sent the machine (${example}). ` +
        'An axis was probably stopped by a soft limit, or X0 / Y0 was set in another place than the program expects.'
      if (off >= Math.max(2, m * 0.1)) errors.push(text)
      else warnings.push(text)
    }
  }

  if (errors.length && format === 'mach3') errors.push(MACH3_DIGITIZE_HINT)
  const keep = points.filter((_, i) => !missed[i])
  return { errors, warnings, points: errors.length ? points : keep }
}

/** Mach3's digitize file (M40/M41) is unreliable with many motion controllers. */
export const MACH3_DIGITIZE_HINT =
  'Mach3: if you saw the bit stop on the copper at different heights, the probing itself worked but Mach3 ' +
  'recorded the wrong numbers in its digitize file (M40 / M41) – this happens with some motion controllers. ' +
  'If it keeps happening, make a new probe program with “Mach3 records with: PCB TraceMill macros”: they wait ' +
  'until the machine has stopped and write the real position.'

/** What to check when the results are rejected – shown under the errors. */
export const PROBE_FAILURE_TIPS: string[] = [
  'Probe clip on the bit shank and ground clip on the copper – test it: touching them together must light the probe signal in your control software.',
  'Clean the copper (fine sandpaper or a scouring pad, then alcohol). Oxide, lacquer and fingerprints insulate.',
  'Start the probe program with the bit just above the copper at point 1 (Z zeroed there), not high up.',
  'X0 / Y0 must be where the probe dialog shows them, and the probe area must be inside the machine’s travel.'
]

export interface ProbeImportResult {
  map: HeightMap | null
  /** Why no map was built (empty when `map` is set). */
  errors: string[]
  warnings: string[]
  format: ProbeLogFormat
}

/** Parse a probe log, check it and build the height map (null with `errors` when unusable). */
export function importProbeLog(text: string, cfg?: ProbeGridConfig): ProbeImportResult {
  const r = parseProbeResults(text)
  if (r.points.length < 4)
    return {
      map: null,
      errors: ['Not enough probe points found (need at least 4).'],
      warnings: r.warnings,
      format: r.format
    }
  const chk = checkProbePoints(r.points, cfg, r.format)
  const warnings = [...chk.warnings, ...r.warnings]
  if (chk.errors.length) return { map: null, errors: chk.errors, warnings, format: r.format }
  try {
    return { map: buildHeightMap(chk.points, cfg, r.format), errors: [], warnings, format: r.format }
  } catch (e) {
    return { map: null, errors: [e instanceof Error ? e.message : String(e)], warnings, format: r.format }
  }
}
