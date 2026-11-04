/**
 * The 'gcode' Monaco language: Monarch tokenizer (G/M words, axis coordinates, feeds, comments),
 * a dark theme matching TraceMill, and plain-language hover help from `gcodeLanguageKeywords`.
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { gcodeLanguageKeywords, type GcodeKeyword } from '@core/gcode'

export const GCODE_LANGUAGE_ID = 'gcode'
export const GCODE_THEME_ID = 'tracemill-gcode'

/** Normalises "G00" → "G0", "g1" → "G1", "G38.2" stays. */
export function normaliseCode(word: string): string {
  const m = /^([A-Za-z])\s*([-+]?\d*\.?\d*)$/.exec(word.trim())
  if (!m) return word.toUpperCase()
  const letter = m[1].toUpperCase()
  if (!m[2]) return letter
  const n = Number(m[2])
  return Number.isFinite(n) ? `${letter}${n}` : `${letter}${m[2]}`
}

const byCode = new Map<string, GcodeKeyword>()
for (const k of [
  ...gcodeLanguageKeywords.gCodes,
  ...gcodeLanguageKeywords.mCodes,
  ...gcodeLanguageKeywords.words
])
  byCode.set(k.code.toUpperCase(), k)

/** Plain-language explanation of a G-code word (e.g. "G1", "X12.5"), or null. */
export function describeWord(word: string): { title: string; text: string } | null {
  const code = normaliseCode(word)
  const letter = code[0]
  if (letter === 'G' || letter === 'M') {
    const k = byCode.get(code)
    return k
      ? { title: code, text: k.description }
      : { title: code, text: 'Machine command (not used by TraceMill).' }
  }
  const k = byCode.get(letter)
  if (!k) return null
  const value = code.slice(1)
  return { title: value ? `${letter} = ${value}` : letter, text: k.description }
}

export function registerGcodeLanguage(monaco: typeof Monaco): void {
  if (monaco.languages.getLanguages().some((l) => l.id === GCODE_LANGUAGE_ID)) return
  monaco.languages.register({ id: GCODE_LANGUAGE_ID, extensions: ['.nc', '.tap', '.ngc', '.gcode', '.cnc'] })
  monaco.languages.setLanguageConfiguration(GCODE_LANGUAGE_ID, {
    comments: { lineComment: ';', blockComment: ['(', ')'] },
    wordPattern: /([A-Za-z][-+]?\d*\.?\d+)|([A-Za-z])/
  })
  monaco.languages.setMonarchTokensProvider(GCODE_LANGUAGE_ID, {
    ignoreCase: true,
    tokenizer: {
      root: [
        [/\(.*?\)/, 'comment'],
        [/;.*$/, 'comment'],
        [/^%.*$/, 'comment'],
        [/N\d+/, 'linenum'],
        [/G0*0(?!\d)/, 'gcode.rapid'],
        [/G0*[123](?![\d.])/, 'gcode.motion'],
        [/G\d+(\.\d+)?/, 'gcode.other'],
        [/M\d+/, 'mcode'],
        [/X[-+]?(\d+\.?\d*|\.\d+)/, 'axis.x'],
        [/Y[-+]?(\d+\.?\d*|\.\d+)/, 'axis.y'],
        [/Z[-+]?(\d+\.?\d*|\.\d+)/, 'axis.z'],
        [/[IJKR][-+]?(\d+\.?\d*|\.\d+)/, 'arc'],
        [/F[-+]?(\d+\.?\d*|\.\d+)/, 'feed'],
        [/S[-+]?(\d+\.?\d*|\.\d+)/, 'spindle'],
        [/T\d+/, 'tool'],
        [/[A-Z][-+]?(\d+\.?\d*|\.\d+)/, 'param'],
        [/\s+/, 'white']
      ]
    }
  })
  monaco.editor.defineTheme(GCODE_THEME_ID, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
      { token: 'linenum', foreground: '475569' },
      { token: 'gcode.rapid', foreground: 'fb923c', fontStyle: 'bold' },
      { token: 'gcode.motion', foreground: '38bdf8', fontStyle: 'bold' },
      { token: 'gcode.other', foreground: 'a78bfa' },
      { token: 'mcode', foreground: 'f472b6', fontStyle: 'bold' },
      { token: 'axis.x', foreground: 'fca5a5' },
      { token: 'axis.y', foreground: '86efac' },
      { token: 'axis.z', foreground: '93c5fd' },
      { token: 'arc', foreground: 'c4b5fd' },
      { token: 'feed', foreground: 'fde047' },
      { token: 'spindle', foreground: 'fdba74' },
      { token: 'tool', foreground: '5eead4', fontStyle: 'bold' },
      { token: 'param', foreground: 'cbd5e1' }
    ],
    colors: {
      'editor.background': '#0b1120',
      'editor.foreground': '#cbd5e1',
      'editorLineNumber.foreground': '#334155',
      'editorLineNumber.activeForeground': '#94a3b8',
      'editor.lineHighlightBackground': '#1e293b80',
      'editor.selectionBackground': '#0ea5e955',
      'editorGutter.background': '#0b1120',
      'scrollbarSlider.background': '#33415580',
      'scrollbarSlider.hoverBackground': '#475569a0',
      'editorHoverWidget.background': '#0f172a',
      'editorHoverWidget.border': '#334155'
    }
  })
  monaco.languages.registerHoverProvider(GCODE_LANGUAGE_ID, {
    provideHover(model, position) {
      const w = model.getWordAtPosition(position)
      if (!w) return null
      const d = describeWord(w.word)
      if (!d) return null
      return {
        range: new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn),
        contents: [{ value: `**${d.title}**` }, { value: d.text }]
      }
    }
  })
}
