/**
 * Gerber RS-274X tokenizer.
 *
 * A Gerber file is a stream of `*`-terminated "words". Extended commands are wrapped in
 * `%...%` and may hold several `*`-terminated commands (an aperture macro uses that to carry
 * its statements). Line breaks carry no meaning and may appear anywhere, so they are removed.
 */

export type GerberBlock =
  { type: 'ext'; commands: string[]; line: number } | { type: 'word'; text: string; line: number }

const NL = /[\r\n]/g

function countNewlines(text: string, from: number, to: number): number {
  let n = 0
  for (let i = from; i < to; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

export function tokenize(text: string): GerberBlock[] {
  const blocks: GerberBlock[] = []
  const n = text.length
  let i = 0
  let line = 1
  while (i < n) {
    const c = text.charCodeAt(i)
    if (c === 10) {
      line++
      i++
      continue
    }
    if (c === 13 || c === 32 || c === 9) {
      i++
      continue
    }
    if (c === 37 /* % */) {
      let end = text.indexOf('%', i + 1)
      if (end < 0) end = n
      const body = text.slice(i + 1, end).replace(NL, '')
      const commands: string[] = []
      for (const part of body.split('*')) {
        const t = part.trim()
        if (t) commands.push(t)
      }
      if (commands.length) blocks.push({ type: 'ext', commands, line })
      line += countNewlines(text, i, end)
      i = end + 1
      continue
    }
    // Ordinary word: up to the next '*' (or a '%' when the '*' is missing).
    let star = text.indexOf('*', i)
    if (star < 0) star = n
    const pct = text.indexOf('%', i)
    const end = pct >= 0 && pct < star ? pct : star
    const word = text.slice(i, end).replace(NL, '').trim()
    if (word) blocks.push({ type: 'word', text: word, line })
    line += countNewlines(text, i, end)
    i = end === star ? end + 1 : end
  }
  return blocks
}
