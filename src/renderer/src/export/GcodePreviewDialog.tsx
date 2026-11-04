import { useMemo, useRef, useState, type UIEvent } from 'react'
import { Copy, Download, Search } from 'lucide-react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { formatBytes } from '@renderer/lib/utils'

const LINE_H = 18
const OVERSCAN = 30

/** Minimal colouring: comments grey, rapids amber, cuts sky, other words plain. */
function GcodeLine({ text }: { text: string }): React.JSX.Element {
  const m = /^([^;(]*)(.*)$/.exec(text)
  const code = m?.[1] ?? text
  const comment = m?.[2] ?? ''
  const head = /^\s*(N\d+\s+)?(G0?0\b|G0?[123]\b|G38\.2|G31|M\d+|T\d+)?/i.exec(code)
  const cmd = head?.[2] ?? ''
  const pre = head?.[1] ?? ''
  const rest = code.slice((head?.[0] ?? '').length)
  const cls = /^G0?0$/i.test(cmd)
    ? 'text-amber-300'
    : /^G0?[123]$/i.test(cmd)
      ? 'text-sky-300'
      : /^(G38\.2|G31)$/i.test(cmd)
        ? 'text-fuchsia-300'
        : 'text-emerald-300'
  return (
    <>
      {pre && <span className="text-slate-600">{pre}</span>}
      {cmd && <span className={cls}>{cmd}</span>}
      <span className="text-slate-200">{rest}</span>
      {comment && <span className="text-slate-500">{comment}</span>}
    </>
  )
}

export function GcodePreviewDialog({
  open,
  onOpenChange,
  name,
  text,
  note,
  onSave
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  name: string
  text: string
  note?: string
  onSave?: () => void
}): React.JSX.Element {
  const lines = useMemo(() => text.replace(/\n$/, '').split(/\r?\n/), [text])
  const [scrollTop, setScrollTop] = useState(0)
  const [query, setQuery] = useState('')
  const [hit, setHit] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const viewH = 520
  const first = Math.max(0, Math.floor(scrollTop / LINE_H) - OVERSCAN)
  const last = Math.min(lines.length, Math.ceil((scrollTop + viewH) / LINE_H) + OVERSCAN)
  const gutter = String(lines.length).length

  const find = (): void => {
    const q = query.trim().toLowerCase()
    if (!q) return
    const start = hit === null ? 0 : hit + 1
    let idx = lines.findIndex((l, i) => i >= start && l.toLowerCase().includes(q))
    if (idx < 0) idx = lines.findIndex((l) => l.toLowerCase().includes(q))
    if (idx < 0) return
    setHit(idx)
    ref.current?.scrollTo({ top: Math.max(0, idx * LINE_H - viewH / 3) })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={name}
      description={
        <>
          Read-only preview of the exact text that will be saved · {lines.length.toLocaleString()} lines ·{' '}
          {formatBytes(new TextEncoder().encode(text).length)}
          {note && <span className="mt-1 block text-sky-300">{note}</span>}
        </>
      }
      className="w-[min(94vw,900px)]"
      footer={
        <>
          <span className="mr-auto text-[11px] text-slate-500">
            <span className="text-amber-300">G0</span> = fast move in the air ·{' '}
            <span className="text-sky-300">G1/G2/G3</span> = cutting move · grey = comment for you
          </span>
          <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(text)}>
            <Copy /> Copy
          </Button>
          {onSave && (
            <Button onClick={onSave}>
              <Download /> Save
            </Button>
          )}
        </>
      }
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHit(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && find()}
            placeholder="Find text (Enter = next match), e.g. M6 or Step:"
            aria-label="Find in G-code"
            className="h-8 w-full rounded-md border border-slate-700 bg-slate-950 pl-7 pr-2 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
        </div>
        <Button size="sm" variant="secondary" onClick={find}>
          Find next
        </Button>
      </div>
      <div
        ref={ref}
        data-testid="gcode-preview"
        onScroll={(e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)}
        className="overflow-auto rounded-md border border-slate-800 bg-slate-950 font-mono text-[12px]"
        style={{ height: viewH }}
      >
        <div style={{ height: lines.length * LINE_H, position: 'relative' }}>
          {lines.slice(first, last).map((l, k) => {
            const i = first + k
            return (
              <div
                key={i}
                className={i === hit ? 'bg-sky-500/20' : undefined}
                style={{ position: 'absolute', top: i * LINE_H, height: LINE_H, left: 0, right: 0 }}
              >
                <span
                  className="inline-block select-none pr-3 pl-2 text-right text-slate-600"
                  style={{ width: `${gutter + 2}ch` }}
                >
                  {i + 1}
                </span>
                <span className="whitespace-pre">
                  <GcodeLine text={l} />
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </Dialog>
  )
}
