/**
 * Program timeline: coloured band per step, step-boundary markers (one colour per step),
 * tool-change markers (one colour per tool, only inside steps that use more than one tool),
 * "↻ flip" markers where the job turns the board over, and a draggable playhead.
 */
import { useMemo, useRef, useState } from 'react'
import { cn } from '@renderer/lib/utils'
import { simEngine, useSim, type SimData } from './engine'
import { FLIP_COLOR, withAlpha } from './colors'

export function formatTime(s: number): string {
  if (!Number.isFinite(s)) return '--:--'
  const t = Math.max(0, Math.round(s))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  const mm = String(m).padStart(h ? 2 : 1, '0')
  return h ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`
}

interface MarkerView {
  key: string
  t: number
  kind: 'step' | 'tool' | 'flip'
  color: string
  label: string
}

function buildMarkers(d: SimData): MarkerView[] {
  const out: MarkerView[] = []
  let lastSide: string | null = null
  for (const m of d.markers) {
    const step = m.stepId ? d.stepById.get(m.stepId) : undefined
    const tool = m.toolId ? d.tools.get(m.toolId) : undefined
    if (m.kind === 'step') {
      if (lastSide && m.side !== lastSide)
        out.push({
          key: `flip-${m.t}`,
          t: m.t,
          kind: 'flip',
          color: FLIP_COLOR,
          label: `Flip the board — continue on the ${m.side} side`
        })
      lastSide = m.side
      out.push({
        key: `s-${m.t}-${m.stepId}`,
        t: m.t,
        kind: 'step',
        color: step?.color ?? '#94a3b8',
        label: `Step: ${step?.name ?? 'step'} (${m.side} side)${tool ? ` · ${tool.name}` : ''}`
      })
    } else if (step && step.toolIds.length > 1) {
      out.push({
        key: `t-${m.t}-${m.toolId}`,
        t: m.t,
        kind: 'tool',
        color: tool?.color ?? '#facc15',
        label: `Tool change: ${tool?.name ?? 'tool'} (in “${step.name}”)`
      })
    }
  }
  return out
}

export function Timeline(): React.JSX.Element {
  const data = useSim((s) => s.data)
  const target = useSim((s) => s.target)
  const time = useSim((s) => s.time)
  const barRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const dragging = useRef(false)
  const markers = useMemo(() => (data ? buildMarkers(data) : []), [data])
  const total = data?.totalTime || 1

  const timeAt = (clientX: number): number => {
    const r = barRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * total
  }
  const stepAt = (t: number): SimData['steps'][number] | undefined =>
    data?.steps.find((s) => t >= s.t0 && t <= s.t1)

  const pct = (t: number): string => `${(t / total) * 100}%`
  const hoverStep = hover ? stepAt(hover.t) : undefined

  return (
    <div className="select-none px-3 pb-2 pt-1" data-testid="sim-timeline">
      <div
        ref={barRef}
        className={cn(
          'relative h-9 cursor-pointer rounded-md border border-slate-700 bg-slate-900',
          !data && 'pointer-events-none opacity-50'
        )}
        onPointerDown={(e) => {
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          dragging.current = true
          simEngine.pause()
          simEngine.seek(timeAt(e.clientX))
        }}
        onPointerMove={(e) => {
          const t = timeAt(e.clientX)
          const r = barRef.current?.getBoundingClientRect()
          setHover({ x: r ? e.clientX - r.left : 0, t })
          if (dragging.current) simEngine.seek(t)
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onPointerLeave={() => setHover(null)}
        role="slider"
        aria-label="Program time"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(target)}
      >
        {/* step bands */}
        <div className="absolute inset-0 overflow-hidden rounded-md">
          {data?.steps.map((s) => (
            <div
              key={s.id}
              className="absolute inset-y-0 flex items-center overflow-hidden border-l px-1.5"
              style={{
                left: pct(s.t0),
                width: pct(Math.max(0, s.t1 - s.t0)),
                background: `linear-gradient(180deg, ${withAlpha(s.color, 0.32)}, ${withAlpha(s.color, 0.16)})`,
                borderColor: withAlpha(s.color, 0.9)
              }}
            >
              <span className="truncate text-[10px] font-medium text-slate-200/90">{s.name}</span>
            </div>
          ))}
          {/* played part */}
          <div className="absolute inset-y-0 left-0 bg-white/10" style={{ width: pct(time) }} />
        </div>
        {/* markers */}
        {markers.map((m) =>
          m.kind === 'step' ? (
            <div
              key={m.key}
              title={m.label}
              className="absolute -top-1 bottom-0 w-[3px] -translate-x-1/2 rounded-full"
              style={{ left: pct(m.t), background: m.color, boxShadow: `0 0 6px ${withAlpha(m.color, 0.7)}` }}
              data-marker="step"
            />
          ) : m.kind === 'tool' ? (
            <div
              key={m.key}
              title={m.label}
              className="absolute bottom-0.5 size-2.5 -translate-x-1/2 rotate-45 border border-slate-950"
              style={{ left: pct(m.t), background: m.color }}
              data-marker="tool"
            />
          ) : (
            <div
              key={m.key}
              title={m.label}
              className="absolute -top-3 -translate-x-1/2 rounded-full border border-slate-950 bg-slate-100 px-1 text-[10px] leading-[14px] font-bold text-slate-900 shadow"
              style={{ left: pct(m.t) }}
              data-marker="flip"
            >
              ↻ flip
            </div>
          )
        )}
        {/* playhead */}
        <div className="pointer-events-none absolute -bottom-1 -top-1" style={{ left: pct(target) }}>
          <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]" />
          <div className="absolute -top-1 size-3 -translate-x-1/2 rounded-full border-2 border-slate-950 bg-white" />
        </div>
        {hover && data && (
          <div
            className="pointer-events-none absolute bottom-full z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 shadow-xl"
            style={{ left: hover.x }}
          >
            <span className="font-mono">{formatTime(hover.t)}</span>
            {hoverStep && (
              <>
                {' · '}
                <span style={{ color: hoverStep.color }}>●</span> {hoverStep.name}{' '}
                <span className="text-slate-500">({hoverStep.side})</span>
              </>
            )}
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{formatTime(f * (data?.totalTime ?? 0))}</span>
        ))}
      </div>
    </div>
  )
}
