/**
 * Gerber RS-274X / X2 import.
 */
import type { ParsedLayer } from '../model/types'
import { parseGerberText } from './parser'

export { tokenize, type GerberBlock } from './tokenizer'

/**
 * Content sniffing: true when `text` looks like a Gerber (RS-274X or legacy RS-274D-ish) file
 * rather than Excellon or anything else.
 */
export function isGerber(text: string): boolean {
  const head = text.slice(0, 65536)
  if (/%\s*FS[LTD]?[AI]?/.test(head) || /%\s*MO(MM|IN)/.test(head) || /%\s*ADD\d+/.test(head)) return true
  if (/^\s*M48\b/m.test(head)) return false
  if (/G0?4[^*\n]*\*/.test(head) && /D0?[123]\*/.test(head)) return true
  return /X[+-]?\d+Y[+-]?\d+D0?[123]\*/.test(head)
}

/**
 * Parses a Gerber file into a ParsedLayer (millimetres). Recoverable problems are reported in
 * `warnings`; throws only when the text is clearly not Gerber.
 */
export function parseGerber(text: string, opts?: { fileName?: string }): ParsedLayer {
  if (!isGerber(text)) {
    throw new Error(`${opts?.fileName ? `${opts.fileName}: ` : ''}not a Gerber file`)
  }
  return parseGerberText(text, opts)
}
