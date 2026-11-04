/**
 * Read-only G-code viewer.
 *  - `GcodeViewer` uses Monaco (syntax colouring, hover help, find with Ctrl+F) and highlights /
 *    auto-scrolls to `activeLine`. Clicking a line calls `onLineClick` (0-based line index).
 *  - `GcodeLines` is a fast virtualised fallback with the same props (no Monaco).
 * If Monaco fails to load the viewer falls back to `GcodeLines` automatically.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { Loader2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { setupMonaco } from './monaco'
import { GCODE_LANGUAGE_ID, GCODE_THEME_ID, describeWord } from './language'

export interface GcodeViewerProps {
  value: string
  /** 0-based line to highlight (e.g. the line the simulated machine is executing). */
  activeLine?: number | null
  /** Keep the active line scrolled into view. Default true. */
  followActive?: boolean
  /** Called with the 0-based line index the user clicked. */
  onLineClick?: (line: number) => void
  className?: string
  'data-testid'?: string
}

const STYLE_ID = 'tm-gcode-viewer-style'
function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const s = document.createElement('style')
  s.id = STYLE_ID
  s.textContent = `
.tm-gcode-active { background: rgba(14,165,233,0.22); box-shadow: inset 0 0 0 1px rgba(56,189,248,0.45); }
.tm-gcode-active-gutter { background: #38bdf8; width: 3px !important; margin-left: 3px; border-radius: 2px; }
.tm-gcode-done { opacity: 0.55; }
`
  document.head.appendChild(s)
}

class MonacoBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

let monacoFailed = false
try {
  setupMonaco()
  ensureStyles()
} catch (e) {
  monacoFailed = true
  console.warn('Monaco could not be initialised, using the simple G-code list.', e)
}

export function GcodeViewer(props: GcodeViewerProps): React.JSX.Element {
  const fallback = <GcodeLines {...props} />
  if (monacoFailed) return fallback
  return (
    <MonacoBoundary fallback={fallback}>
      <MonacoGcode {...props} />
    </MonacoBoundary>
  )
}

function MonacoGcode({
  value,
  activeLine,
  followActive = true,
  onLineClick,
  className,
  ...rest
}: GcodeViewerProps): React.JSX.Element {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const decoRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null)
  const clickRef = useRef(onLineClick)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    clickRef.current = onLineClick
  }, [onLineClick])

  const onMount: OnMount = useCallback((editor) => {
    editorRef.current = editor
    decoRef.current = editor.createDecorationsCollection([])
    editor.onMouseDown((e) => {
      const ln = e.target.position?.lineNumber
      if (ln && clickRef.current) clickRef.current(ln - 1)
    })
    setReady(true)
  }, [])

  useEffect(() => {
    const ed = editorRef.current
    const deco = decoRef.current
    if (!ready || !ed || !deco) return
    const model = ed.getModel()
    if (activeLine === null || activeLine === undefined || activeLine < 0 || !model) {
      deco.clear()
      return
    }
    const ln = Math.min(model.getLineCount(), activeLine + 1)
    deco.set([
      {
        range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 },
        options: {
          isWholeLine: true,
          className: 'tm-gcode-active',
          linesDecorationsClassName: 'tm-gcode-active-gutter'
        }
      }
    ])
    if (followActive) ed.revealLineInCenterIfOutsideViewport(ln, 1)
  }, [activeLine, followActive, ready, value])

  return (
    <div className={cn('h-full min-h-0 w-full', className)} data-testid={rest['data-testid']}>
      <Editor
        value={value}
        language={GCODE_LANGUAGE_ID}
        theme={GCODE_THEME_ID}
        onMount={onMount}
        loading={
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Loading G-code viewer…
          </div>
        }
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: false },
          fontSize: 12,
          lineHeight: 18,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          scrollBeyondLastLine: false,
          renderLineHighlight: 'none',
          folding: false,
          glyphMargin: false,
          lineNumbersMinChars: 5,
          lineDecorationsWidth: 8,
          wordWrap: 'off',
          contextmenu: false,
          automaticLayout: true,
          smoothScrolling: false,
          renderWhitespace: 'none',
          occurrencesHighlight: 'off',
          selectionHighlight: false,
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
        }}
      />
    </div>
  )
}

// ───────────────────────────────────────────── lightweight fallback

const ROW_H = 18

const TOKEN_RE =
  /(\(.*?\)|;.*$)|(N\d+)|(G0*0(?!\d))|(G0*[123](?![\d.]))|(G\d+(?:\.\d+)?)|(M\d+)|([XYZ][-+]?[\d.]+)|([IJKR][-+]?[\d.]+)|(F[-+]?[\d.]+)|(S[-+]?[\d.]+)|(T\d+)/gi
const TOKEN_CLS = [
  'text-slate-500 italic',
  'text-slate-600',
  'font-semibold text-orange-400',
  'font-semibold text-sky-400',
  'text-violet-400',
  'font-semibold text-pink-400',
  'text-rose-300',
  'text-violet-300',
  'text-yellow-300',
  'text-orange-300',
  'font-semibold text-teal-300'
]

function colourLine(line: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  TOKEN_RE.lastIndex = 0
  for (let m = TOKEN_RE.exec(line); m; m = TOKEN_RE.exec(line)) {
    if (m.index > last) out.push(line.slice(last, m.index))
    let g = 1
    while (g < m.length && m[g] === undefined) g++
    const word = m[0]
    const help = g > 1 ? describeWord(word) : null
    out.push(
      <span
        key={m.index}
        className={TOKEN_CLS[g - 1]}
        title={help ? `${help.title}: ${help.text}` : undefined}
      >
        {word}
      </span>
    )
    last = m.index + word.length
    if (word.length === 0) TOKEN_RE.lastIndex++
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

/** Virtualised read-only G-code list (no Monaco). */
export function GcodeLines({
  value,
  activeLine,
  followActive = true,
  onLineClick,
  className,
  ...rest
}: GcodeViewerProps): React.JSX.Element {
  const lines = useMemo(() => value.split(/\r?\n/), [value])
  const ref = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [height, setHeight] = useState(400)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el || !followActive || activeLine === null || activeLine === undefined || activeLine < 0) return
    const y = activeLine * ROW_H
    if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - ROW_H)
      el.scrollTop = Math.max(0, y - el.clientHeight / 2)
  }, [activeLine, followActive])
  const first = Math.max(0, Math.floor(scroll / ROW_H) - 10)
  const last = Math.min(lines.length, Math.ceil((scroll + height) / ROW_H) + 10)
  const digits = String(lines.length).length
  return (
    <div
      ref={ref}
      className={cn('h-full overflow-auto bg-[#0b1120] font-mono text-[12px]', className)}
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      data-testid={rest['data-testid']}
    >
      <div style={{ height: lines.length * ROW_H, position: 'relative' }}>
        {lines.slice(first, last).map((l, k) => {
          const i = first + k
          return (
            <div
              key={i}
              onClick={() => onLineClick?.(i)}
              className={cn(
                'absolute left-0 right-0 flex cursor-pointer whitespace-pre hover:bg-slate-800/60',
                i === activeLine && 'bg-sky-500/20 ring-1 ring-sky-400/40 ring-inset'
              )}
              style={{ top: i * ROW_H, height: ROW_H, lineHeight: `${ROW_H}px` }}
            >
              <span className="w-12 shrink-0 pr-2 text-right text-slate-600 select-none">
                {String(i + 1).padStart(digits, ' ')}
              </span>
              <span className="text-slate-300">{colourLine(l)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
