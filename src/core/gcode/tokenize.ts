/**
 * Line tokenizer for RS-274 / NIST style G-code as written by PCB TraceMill posts and common
 * hobby controllers (Mach3, GRBL, LinuxCNC). Pure TypeScript, no DOM.
 */

export interface GcodeWord {
  /** Upper-case address letter, e.g. "G", "X". */
  letter: string
  /** Parsed numeric value. */
  value: number
  /** Raw text of the word as written (e.g. "x-1.5"). */
  raw: string
}

export interface TokenizedLine {
  words: GcodeWord[]
  /** Comment texts without delimiters, in order of appearance. */
  comments: string[]
  /** True when the line is a program delimiter ("%"). */
  percent: boolean
  /** True when the line starts with "/" (block delete). */
  blockDelete: boolean
  /** Parse problems (unknown characters, missing numbers, bad expressions). */
  errors: string[]
  /** Parameter assignments such as `#500=[#5213-#498]`, evaluated with the parameters given. */
  assigns: { param: number; value: number }[]
}

const isLetter = (c: string): boolean => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
const isDigit = (c: string): boolean => c >= '0' && c <= '9'

/**
 * Evaluate a NIST / Mach3 expression starting at `s[i]`: a parameter (`#500`, `#[#1+2]`) or a
 * bracketed expression with + - * / and unary signs. Unknown parameters read as 0. Returns the
 * value and the index after it, or null when it is not a valid expression.
 */
function readValue(s: string, i: number, params: Map<number, number>): { v: number; j: number } | null {
  let j = i
  const ws = (): void => {
    while (j < s.length && (s[j] === ' ' || s[j] === '	')) j++
  }
  const number = (): number | null => {
    ws()
    const st = j
    while (j < s.length && (isDigit(s[j]) || s[j] === '.')) j++
    return j > st ? Number(s.slice(st, j)) : null
  }
  const atom = (): number | null => {
    ws()
    const c = s[j]
    if (c === '-' || c === '+') {
      j++
      const a = atom()
      return a === null ? null : c === '-' ? -a : a
    }
    if (c === '#') {
      j++
      const k = atom()
      return k === null ? null : (params.get(Math.round(k)) ?? 0)
    }
    if (c === '[') {
      j++
      const v = sum()
      ws()
      if (v === null || s[j] !== ']') return null
      j++
      return v
    }
    return number()
  }
  const product = (): number | null => {
    let a = atom()
    for (;;) {
      ws()
      if (a === null || (s[j] !== '*' && s[j] !== '/')) return a
      const op = s[j++]
      const b = atom()
      if (b === null) return null
      a = op === '*' ? a * b : a / b
    }
  }
  const sum = (): number | null => {
    let a = product()
    for (;;) {
      ws()
      if (a === null || (s[j] !== '+' && s[j] !== '-')) return a
      const op = s[j++]
      const b = product()
      if (b === null) return null
      a = op === '+' ? a + b : a - b
    }
  }
  const v = atom()
  return v === null || !Number.isFinite(v) ? null : { v, j }
}

/**
 * Split one line of G-code into address words and comments. Case-insensitive. Parameters and
 * bracketed expressions (Mach3 / LinuxCNC style) are evaluated with `params` (unknown = 0).
 */
export function tokenizeLine(line: string, params: Map<number, number> = new Map()): TokenizedLine {
  const out: TokenizedLine = {
    words: [],
    comments: [],
    percent: false,
    blockDelete: false,
    errors: [],
    assigns: []
  }
  const s = line
  let i = 0
  const n = s.length
  while (i < n) {
    const c = s[i]
    if (c === ' ' || c === '\t' || c === '\r') {
      i++
      continue
    }
    if (c === '(') {
      const close = s.indexOf(')', i + 1)
      if (close < 0) {
        out.comments.push(s.slice(i + 1).trim())
        out.errors.push('Unclosed "(" comment')
        break
      }
      out.comments.push(s.slice(i + 1, close).trim())
      i = close + 1
      continue
    }
    if (c === ';') {
      out.comments.push(s.slice(i + 1).trim())
      break
    }
    if (c === '%') {
      out.percent = true
      i++
      continue
    }
    if (c === '/' && out.words.length === 0) {
      out.blockDelete = true
      i++
      continue
    }
    if (c === '#') {
      const k = readValue(s, i + 1, params)
      let j = k?.j ?? i + 1
      while (j < n && (s[j] === ' ' || s[j] === '	')) j++
      const v = k && s[j] === '=' ? readValue(s, j + 1, params) : null
      if (!k || !v) {
        out.errors.push(`Bad parameter assignment: "${s.slice(i).trim()}"`)
        break
      }
      out.assigns.push({ param: Math.round(k.v), value: v.v })
      i = v.j
      continue
    }
    if (isLetter(c)) {
      const letter = c.toUpperCase()
      let j = i + 1
      while (j < n && (s[j] === ' ' || s[j] === '\t')) j++
      const start = j
      if (j < n && (s[j] === '+' || s[j] === '-')) j++
      let digits = 0
      while (j < n && isDigit(s[j])) {
        j++
        digits++
      }
      if (j < n && s[j] === '.') {
        j++
        while (j < n && isDigit(s[j])) {
          j++
          digits++
        }
      }
      if (digits === 0) {
        if (j < n && (s[j] === '#' || s[j] === '[')) {
          const e = readValue(s, start, params)
          if (!e) {
            out.errors.push(`Bad expression: "${s.slice(i).trim()}"`)
            break
          }
          out.words.push({ letter, value: e.v, raw: s.slice(i, e.j) })
          i = e.j
          continue
        }
        out.errors.push(`Address "${letter}" without a number`)
        i = Math.max(j, i + 1)
        continue
      }
      const num = Number(s.slice(start, j).replace(/\s+/g, ''))
      out.words.push({ letter, value: num, raw: s.slice(i, j) })
      i = j
      continue
    }
    out.errors.push(`Unexpected character "${c}"`)
    i++
  }
  return out
}
