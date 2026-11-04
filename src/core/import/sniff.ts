/**
 * Content sniffing helpers that work on raw text without the full Gerber parser
 * (detection must be cheap and must not depend on the Gerber module).
 */

/** True when the text looks like an RS-274X / X2 Gerber file. */
export function looksLikeGerber(text: string): boolean {
  const head = text.slice(0, 100000)
  if (/%FS[LTD]?[AI]?X\d\dY\d\d/.test(head)) return true
  if (/%MO(?:MM|IN)\*%/.test(head)) return true
  if (/%ADD\d+/.test(head)) return true
  // RS-274D style: G04 comments / D-codes terminated with '*'.
  const stars = (head.match(/(?:^|[\s*])(?:G04[^*]*|X-?\d+Y-?\d+D0?[123]|D\d+)\*/g) ?? []).length
  return stars >= 3
}

/** File-function value from X2 (`%TF.FileFunction,...*%`, `G04 #@! TF.FileFunction,...*` or Excellon `; #@! TF...`). */
export function readFileFunction(text: string): string | null {
  const head = text.slice(0, 50000)
  const m =
    /%TF\.FileFunction,([^*%]*)\*%/.exec(head) ??
    /G04 #@! TF\.FileFunction,([^*]*)\*/.exec(head) ??
    /;\s*#@!\s*TF\.FileFunction,([^\r\n]*)/.exec(head)
  return m ? m[1].trim() : null
}

export interface GerberSketch {
  flashes: number
  draws: number
  regions: number
  /** Largest circular aperture diameter used for draws, mm (Infinity for non-circular / unknown). */
  maxDrawWidth: number
  /** Every endpoint of every draw is shared by an even number of draws (closed loops only). */
  closed: boolean
}

/**
 * Light-weight Gerber scan: counts flashes / draws / regions and checks whether draws form closed
 * loops. Good enough to tell a board-outline layer from a copper/silk layer.
 */
export function sketchGerber(text: string): GerberSketch {
  let intDec = 6
  let intInt = 2
  let lz = true // leading zeros omitted (L) is the norm
  let toMm = 1
  const apertures = new Map<number, number>()
  let cur = -1
  let x = 0
  let y = 0
  let inRegion = false
  let lastOp = 2
  let flashes = 0
  let draws = 0
  let regions = 0
  let maxDrawWidth = 0
  const degree = new Map<string, number>()
  const key = (a: number, b: number): string => `${Math.round(a * 100)},${Math.round(b * 100)}`
  const bump = (k: string): void => {
    degree.set(k, (degree.get(k) ?? 0) + 1)
  }
  const parse = (s: string): number => {
    if (s.includes('.')) return parseFloat(s) * toMm
    const neg = s.startsWith('-')
    let d = s.replace(/^[-+]/, '')
    if (!lz) d = d.padEnd(intInt + intDec, '0') // trailing zeros omitted
    const v = parseInt(d, 10) / Math.pow(10, intDec)
    return (neg ? -v : v) * toMm
  }

  const parts = text.split('%')
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (i % 2 === 1) {
      // Extended command block(s).
      for (const cmd of part.split('*')) {
        const c = cmd.trim()
        const fs = /^FS([LTD])?[AI]?X(\d)(\d)Y(\d)(\d)/.exec(c)
        if (fs) {
          lz = fs[1] !== 'T'
          intInt = parseInt(fs[2], 10)
          intDec = parseInt(fs[3], 10)
        } else if (c === 'MOIN') toMm = 25.4
        else if (c === 'MOMM') toMm = 1
        else {
          const ad = /^ADD(\d+)([A-Za-z_.$][^,]*)(?:,(.*))?$/.exec(c)
          if (ad) {
            const n = parseInt(ad[1], 10)
            const first = ad[3] ? parseFloat(ad[3].split('X')[0]) : NaN
            apertures.set(n, ad[2] === 'C' && Number.isFinite(first) ? first * toMm : Infinity)
          }
        }
      }
      continue
    }
    for (const stmt of part.split('*')) {
      const s = stmt.replace(/\s+/g, '')
      if (s === '' || s.startsWith('G04')) continue
      if (s.startsWith('G36')) {
        inRegion = true
        regions++
        continue
      }
      if (s.startsWith('G37')) {
        inRegion = false
        continue
      }
      if (s === 'G70') toMm = 25.4
      else if (s === 'G71') toMm = 1
      const dm = /D(\d+)$/.exec(s)
      const d = dm ? parseInt(dm[1], 10) : null
      if (d !== null && d >= 10) {
        cur = d
        continue
      }
      const xm = /X([-+]?[\d.]+)/.exec(s)
      const ym = /Y([-+]?[\d.]+)/.exec(s)
      const nx = xm ? parse(xm[1]) : x
      const ny = ym ? parse(ym[1]) : y
      const op = d ?? (xm || ym ? lastOp : null)
      if (d !== null && d >= 1 && d <= 3) lastOp = d
      if (op === 1) {
        if (!inRegion) {
          draws++
          const w = apertures.get(cur) ?? Infinity
          if (w > maxDrawWidth) maxDrawWidth = w
          bump(key(x, y))
          bump(key(nx, ny))
        }
      } else if (op === 3) flashes++
      x = nx
      y = ny
    }
  }
  let closed = degree.size > 0
  for (const v of degree.values()) {
    if (v % 2 !== 0) {
      closed = false
      break
    }
  }
  return { flashes, draws, regions, maxDrawWidth, closed }
}

/** Heuristic: few thin draws forming closed loops, no pads/regions → board outline. */
export function looksLikeOutline(text: string): boolean {
  if (!looksLikeGerber(text)) return false
  const s = sketchGerber(text)
  return (
    s.draws >= 1 && s.flashes <= 2 && s.regions === 0 && s.maxDrawWidth <= 0.5 && s.closed && s.draws < 5000
  )
}
