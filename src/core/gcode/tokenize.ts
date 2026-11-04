/**
 * Line tokenizer for RS-274 / NIST style G-code as written by TraceMill posts and common
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
  /** Parse problems (unknown characters, missing numbers, parameters). */
  errors: string[]
}

const isLetter = (c: string): boolean => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
const isDigit = (c: string): boolean => c >= '0' && c <= '9'

/** Split one line of G-code into address words and comments. Case-insensitive. */
export function tokenizeLine(line: string): TokenizedLine {
  const out: TokenizedLine = { words: [], comments: [], percent: false, blockDelete: false, errors: [] }
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
          out.errors.push(`Parameters/expressions are not supported: "${s.slice(i).trim()}"`)
          break
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
