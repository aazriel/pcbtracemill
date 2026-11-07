import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { FlipOverlay } from '@renderer/sim/FlipOverlay'
import { useShallow } from 'zustand/react/shallow'
import {
  ArrowLeft,
  ArrowRight,
  Crosshair,
  Eye,
  Layers,
  Loader2,
  Pause,
  Play,
  Route,
  RotateCcw,
  SkipForward,
  StepBack,
  StepForward,
  Wand2,
  Zap
} from 'lucide-react'
import type { PolygonSet } from '@core/model/types'
import { chooseResolution } from '@core/sim'
import { workOriginInStock } from '@core/toolpath'
import { lengthValue, useUnits } from '@renderer/lib/units'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { useBoardBBox, useLayersWithParsed } from '@renderer/store/controller'
import { Button } from '@renderer/components/ui/button'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { SimViewport } from '@renderer/sim/SimViewport'
import { Timeline, formatTime } from '@renderer/sim/Timeline'
import { SPEEDS, lineAt, simEngine, toolStateAt, useSim, type SimState } from '@renderer/sim/engine'
import { LazyGcodeViewer } from '@renderer/gcode/LazyGcodeViewer'

/** Max texture edge we rely on (WebGL2 guarantees 2048; every desktop GPU and SwiftShader do 8192). */
const MAX_EDGE = 8192
const MAX_CELLS = 4_000_000

function pickResolution(w: number, h: number): number {
  let res = chooseResolution(w, h, MAX_CELLS)
  while (Math.ceil(w / res) > MAX_EDGE || Math.ceil(h / res) > MAX_EDGE) res += 0.005
  return res
}

export function SimulationStage(): React.JSX.Element {
  const cam = useUi((s) => s.cam)
  const camVersion = useUi((s) => s.camVersion)
  const camStale = useUi((s) => s.camStale)
  const generating = useUi((s) => s.generating)
  const setUi = useUi((s) => s.set)
  const material = useProject((s) => s.material)
  const tools = useProject((s) => s.tools)
  const machine = useProject((s) => s.machine)
  const layers = useLayersWithParsed()
  const bbox = useBoardBBox()
  const status = useSim((s) => s.status)
  const error = useSim((s) => s.error)

  // (Re)load the simulation whenever a new CAM result arrives.
  useEffect(() => {
    const combined = cam?.combined
    if (!combined || !material) return
    const s = useSim.getState()
    if (s.version === camVersion && s.status !== 'error' && s.status !== 'idle') return
    const parts = (side: 'top' | 'bottom'): PolygonSet[] =>
      layers
        .filter((l) => l.type === 'copper' && l.side === side && l.parsed?.geometry.length)
        .map((l) => l.parsed!.geometry)
    let lineCount = 1
    for (let i = 0; i < combined.text.length; i++) if (combined.text.charCodeAt(i) === 10) lineCount++
    const stepNames: Record<string, { name: string; kind: string }> = {}
    for (const tp of cam.toolpaths) stepNames[tp.stepId] = { name: tp.stepName, kind: tp.stepKind }
    void simEngine.load(camVersion, {
      request: {
        gcode: combined.text,
        lineMeta: combined.lineMeta,
        tools,
        toolpaths: cam.toolpaths.map((t) => ({ stepId: t.stepId, side: t.side })),
        material,
        boardBBox: bbox,
        designTopParts: parts('top'),
        designBottomParts: parts('bottom'),
        resolution: pickResolution(material.width, material.height),
        timing: machine
          ? { maxFeedXY: machine.maxFeedXY, maxFeedZ: machine.maxFeedZ, accel: machine.accel }
          : undefined
      },
      lineCount,
      stepNames,
      tools,
      origin: workOriginInStock(material, bbox)
    })
  }, [cam, camVersion, material, tools, layers, bbox, machine])

  // Keyboard shortcuts: Space play/pause, ←/→ previous/next marker, Home restart, End final result.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, .monaco-editor, [role="dialog"]')) return
      if (e.key === ' ') {
        e.preventDefault()
        if (!e.repeat) simEngine.toggle()
      } else if (e.key === 'ArrowRight') simEngine.stepMarker(1)
      else if (e.key === 'ArrowLeft') simEngine.stepMarker(-1)
      else if (e.key === 'Home') simEngine.restart()
      else if (e.key === 'End') simEngine.end()
    }
    // A focused button would also "click" on Space key-up: swallow it so Space only toggles once.
    const onKeyUp = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (e.key === ' ' && !t.closest('input, textarea, select, .monaco-editor, [role="dialog"]'))
        e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      simEngine.pause()
    }
  }, [])

  if (!cam?.combined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <Wand2 className="size-10 text-slate-600" />
        <div className="max-w-md text-sm text-slate-400">
          There is no G-code to simulate yet. Go to <b>Manufacture</b>, set up your milling steps and generate
          the toolpaths — then come back here to watch the machine cut your board.
        </div>
        <Button onClick={() => setUi({ stage: 'manufacture' })} data-testid="back-manufacture">
          <ArrowLeft /> Back to Manufacture
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1">
          <SimViewport />
          <SideBanner />
          <FlipOverlay />
          {status === 'loading' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-950/80 text-sm text-slate-300">
              <Loader2 className="size-7 animate-spin text-sky-400" />
              Preparing the material simulation…
              <span className="text-xs text-slate-500">
                Building the copper-clad board and reading the G-code.
              </span>
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-950/90 p-8 text-center text-sm text-rose-300">
              The simulation could not start.
              <span className="max-w-lg text-xs text-slate-400">{error}</span>
            </div>
          )}
          {(camStale || generating) && status === 'ready' && (
            <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-amber-500/40 bg-amber-950/80 px-3 py-1 text-xs text-amber-200">
              {generating
                ? 'Regenerating G-code…'
                : 'Settings changed — this simulation shows the previous G-code.'}
            </div>
          )}
        </section>
        <SimPanel text={cam.combined.text} />
      </div>
      <div className="shrink-0 border-t border-slate-800 bg-slate-900/60">
        <div className="flex items-start gap-2 pl-3 pt-1.5">
          <Transport />
          <div className="min-w-0 flex-1">
            <Timeline />
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-slate-800 px-3 py-2">
          <Legend />
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => setUi({ stage: 'manufacture' })}>
            <ArrowLeft /> Manufacture
          </Button>
          <Tooltip content="Happy with the result? Save the G-code files for your machine.">
            <Button
              variant="success"
              onClick={() => setUi({ stage: 'export' })}
              data-testid="continue-export"
            >
              Continue to Export <ArrowRight />
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────────────────── small controls

function ToggleButton({
  on,
  onChange,
  icon,
  label,
  help,
  testId
}: {
  on: boolean
  onChange: (v: boolean) => void
  icon: ReactNode
  label: string
  help: ReactNode
  testId?: string
}): React.JSX.Element {
  return (
    <Tooltip content={help} side="left">
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange(!on)}
        data-testid={testId}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors [&_svg]:size-3.5',
          on
            ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
            : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
        )}
      >
        {icon}
        {label}
      </button>
    </Tooltip>
  )
}

function IconBtn({
  help,
  onClick,
  children,
  testId,
  disabled,
  label
}: {
  help: ReactNode
  onClick: () => void
  children: ReactNode
  testId?: string
  disabled?: boolean
  label: string
}): React.JSX.Element {
  return (
    <Tooltip content={help} side="top">
      <Button
        size="icon"
        variant="ghost"
        onClick={onClick}
        data-testid={testId}
        disabled={disabled}
        aria-label={label}
      >
        {children}
      </Button>
    </Tooltip>
  )
}

function TimeReadout(): React.JSX.Element {
  const target = useSim((s) => s.target)
  const total = useSim((s) => s.data?.totalTime ?? 0)
  return (
    <Tooltip content="Simulated machine time / total time of the whole job" side="top">
      <div className="whitespace-nowrap font-mono text-xs tabular-nums text-slate-300" data-testid="sim-time">
        {formatTime(target)} <span className="text-slate-600">/</span> {formatTime(total)}
      </div>
    </Tooltip>
  )
}

// ───────────────────────────────────────── transport (next to the timeline)

function Transport(): React.JSX.Element {
  // Only the fields shown here: it must not re-render on every playback frame.
  const s = useSim(
    useShallow((st) => ({ status: st.status, playing: st.playing, speed: st.speed, busy: st.busy }))
  )
  const ready = s.status === 'ready'
  return (
    <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
      <IconBtn
        help="Restart: go back to the untouched board (Home key)"
        onClick={() => simEngine.restart()}
        testId="sim-restart"
        disabled={!ready}
        label="Restart"
      >
        <RotateCcw />
      </IconBtn>
      <IconBtn
        help="Previous marker: jump back to the start of the step / tool change (← key)"
        onClick={() => simEngine.stepMarker(-1)}
        disabled={!ready}
        label="Previous marker"
        testId="sim-prev"
      >
        <StepBack />
      </IconBtn>
      {s.playing ? (
        <Tooltip content="Pause (Space)" side="top">
          <Button
            size="icon"
            onClick={() => simEngine.pause()}
            data-testid="sim-pause"
            aria-label="Pause"
            className="rounded-full"
          >
            <Pause />
          </Button>
        </Tooltip>
      ) : (
        <Tooltip content="Play: watch the machine run the G-code (Space)" side="top">
          <Button
            size="icon"
            onClick={() => simEngine.play()}
            data-testid="sim-play"
            aria-label="Play"
            disabled={!ready}
            className="rounded-full"
          >
            <Play />
          </Button>
        </Tooltip>
      )}
      <IconBtn
        help="Next marker: jump to the next step / tool change (→ key)"
        onClick={() => simEngine.stepMarker(1)}
        disabled={!ready}
        label="Next marker"
        testId="sim-next"
      >
        <StepForward />
      </IconBtn>
      <IconBtn
        help="Jump to the end and show the final result of the whole job (End key)"
        onClick={() => simEngine.end()}
        testId="sim-end"
        disabled={!ready}
        label="Jump to end"
      >
        <SkipForward />
      </IconBtn>
      <Tooltip
        content="Playback speed. 1× is real machine time; higher values fast-forward (200× runs a 30-minute job in 9 seconds)."
        side="top"
      >
        <select
          value={s.speed}
          onChange={(e) => simEngine.setSpeed(Number(e.target.value))}
          data-testid="sim-speed"
          aria-label="Playback speed"
          className="mx-1 h-8 rounded-md border border-slate-700 bg-slate-950 px-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
        >
          {SPEEDS.map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
      </Tooltip>
      <TimeReadout />
      {s.busy && <Loader2 className="ml-1 size-3.5 animate-spin text-sky-300" aria-label="computing" />}
    </div>
  )
}

// ───────────────────────────────────────── right panel

function PanelSection({
  title,
  children,
  className
}: {
  title: string
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('border-b border-slate-800 px-3 py-2.5', className)}>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</div>
      {children}
    </div>
  )
}

function SimPanel({ text }: { text: string }): React.JSX.Element {
  const s = useSim(
    useShallow((st) => ({
      faces: st.data?.faces,
      side: st.side,
      follow: st.follow,
      showTool: st.showTool,
      showTrail: st.showTrail,
      showDesign: st.showDesign,
      showRapids: st.showRapids
    }))
  )
  const faces = s.faces ?? ['top']
  const set = (patch: Partial<SimState>): void => useSim.getState().set(patch)
  const pickSide = (side: 'top' | 'bottom'): void => set({ side, follow: false })
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-slate-800 bg-[#0b1120]">
      <PanelSection title="Tool position">
        <Position />
      </PanelSection>

      <PanelSection title="View">
        <div className="flex items-center gap-2">
          <div
            className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-0.5"
            role="radiogroup"
          >
            {(['top', 'bottom'] as const).map((side) => {
              const has = faces.includes(side)
              return (
                <Tooltip
                  key={side}
                  side="left"
                  content={
                    has
                      ? `Look at the ${side} face of the board (as it lies on the machine when that side is milled). Turns off “Follow”.`
                      : 'This job only mills the top side.'
                  }
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={s.side === side}
                    disabled={!has}
                    onClick={() => pickSide(side)}
                    data-testid={`sim-side-${side}`}
                    className={cn(
                      'rounded px-3 py-1 text-xs font-medium capitalize transition-colors disabled:opacity-35',
                      s.side === side ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-100'
                    )}
                  >
                    {side}
                  </button>
                </Tooltip>
              )
            })}
          </div>
          <ToggleButton
            on={s.follow}
            onChange={(v) => set({ follow: v })}
            icon={<Crosshair />}
            label="Follow"
            help="Follow the tool: always show the side it is working on, and when zoomed in keep the tool on screen while playing. (The view switches sides by itself whenever the job flips the board.)"
            testId="sim-toggle-follow"
          />
        </div>
      </PanelSection>

      <PanelSection title="Show">
        <div className="grid grid-cols-2 gap-1.5 [&>*]:w-full">
          <ToggleButton
            on={s.showTool}
            onChange={(v) => set({ showTool: v })}
            icon={<Eye />}
            label="Tool"
            help="Show the spinning cutter at its real size and shape."
            testId="sim-toggle-tool"
          />
          <ToggleButton
            on={s.showTrail}
            onChange={(v) => set({ showTrail: v })}
            icon={<Route />}
            label="Trail"
            help="Show the path the tool has followed in the current step (newest part brightest), in the step's colour."
            testId="sim-toggle-trail"
          />
          <ToggleButton
            on={s.showDesign}
            onChange={(v) => set({ showDesign: v })}
            icon={<Layers />}
            label="Design"
            help="Overlay the copper from your PCB design (cyan outline). Every outlined area must stay copper — use it to check that what is milled matches what you designed."
            testId="sim-toggle-design"
          />
          <ToggleButton
            on={s.showRapids}
            onChange={(v) => set({ showRapids: v })}
            icon={<Zap />}
            label="Rapids"
            help="Also draw the fast “rapid” moves the machine makes in the air between cuts (dashed white)."
            testId="sim-toggle-rapids"
          />
        </div>
      </PanelSection>

      <GcodePanel text={text} />
    </aside>
  )
}

function Position(): React.JSX.Element {
  const data = useSim((s) => s.data)
  const time = useSim((s) => s.time)
  const ts = useMemo(() => (data ? toolStateAt(data, time) : null), [data, time])
  const step = data && ts?.stepId ? data.stepById.get(ts.stepId) : undefined
  const tool = data && ts?.toolId ? data.tools.get(ts.toolId) : undefined
  let activity = 'Waiting'
  let activityCls = 'text-slate-400'
  if (data && ts) {
    const cu = data.stock.copperThickness
    const depth = -ts.z
    if (time >= data.totalTime - 1e-6) {
      activity = 'Job finished — this is the final result'
      activityCls = 'text-emerald-300'
    } else if (ts.kind === 'rapid')
      activity =
        ts.vertical === 'up'
          ? 'Lifting the tool out of the board (rapid)'
          : ts.vertical === 'down'
            ? 'Lowering the tool quickly towards the board (rapid)'
            : 'Rapid move in the air (not cutting)'
    else if (depth <= 1e-4)
      activity =
        ts.vertical === 'down'
          ? 'Lowering the tool to the copper (slow feed)'
          : ts.vertical === 'up'
            ? 'Lifting the tool'
            : ts.z > 0.05
              ? 'Moving above the board'
              : 'Touching the copper surface'
    else if (depth <= cu + 1e-4) {
      activity = `${ts.vertical === 'down' ? 'Plunging into' : 'Cutting'} copper · ${depth.toFixed(3)} mm deep`
      activityCls = 'text-orange-300'
    } else if (depth < data.stock.thickness) {
      activity = `${ts.vertical === 'down' ? 'Plunging' : 'Cutting'} through copper into FR4 · ${depth.toFixed(2)} mm deep`
      activityCls = 'text-amber-200'
    } else {
      activity = `${ts.vertical === 'down' ? 'Drilling' : 'Cutting'} through the board · ${depth.toFixed(2)} mm deep`
      activityCls = 'text-rose-300'
    }
  }
  const units = useUnits()
  const axes: { k: string; v: number; cls: string }[] = [
    { k: 'X', v: data && ts ? ts.x - data.origin.x : 0, cls: 'text-rose-300' },
    { k: 'Y', v: data && ts ? ts.y - data.origin.y : 0, cls: 'text-emerald-300' },
    { k: 'Z', v: ts?.z ?? 0, cls: 'text-sky-300' }
  ]
  return (
    <div className="text-xs">
      <Tooltip
        content="Tool tip position in machine work coordinates (the numbers in the G-code). Z 0 is the copper surface; negative Z is inside the board."
        side="left"
      >
        <div
          className="grid grid-cols-3 gap-1.5 rounded-md border border-slate-800 bg-slate-950 p-2 font-mono tabular-nums"
          data-testid="sim-xyz"
        >
          {axes.map((a) => (
            <div key={a.k} className="flex flex-col">
              <span className={cn('text-[10px] font-semibold', a.cls)}>{a.k}</span>
              <span className="text-[15px] leading-5 text-slate-100">{lengthValue(a.v, units)}</span>
            </div>
          ))}
        </div>
      </Tooltip>
      <div className="mt-2 flex items-center gap-2" data-testid="sim-step">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: step?.color ?? '#64748b' }} />
        <span className="truncate font-semibold text-slate-100">
          {step?.name ?? (time > 0 ? 'Machine setup / end' : 'Program start')}
        </span>
        {step && (
          <span className="ml-auto shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
            {step.side}
          </span>
        )}
      </div>
      {tool && (
        <div className="mt-1 flex items-center gap-2 text-slate-300">
          <span className="size-2.5 shrink-0 rotate-45" style={{ background: tool.color }} />
          <span className="truncate">{tool.name}</span>
        </div>
      )}
      <div className={cn('mt-1.5 leading-snug', activityCls)}>{activity}</div>
    </div>
  )
}

/** Floating notice over the viewport when the tool works on the face that is not shown. */
function SideBanner(): React.JSX.Element | null {
  const data = useSim((s) => s.data)
  const time = useSim((s) => s.time)
  const side = useSim((s) => s.side)
  const set = useSim((s) => s.set)
  const ts = useMemo(() => (data ? toolStateAt(data, time) : null), [data, time])
  if (!data || !ts || ts.side === side || time >= data.totalTime - 1e-6) return null
  return (
    <div className="absolute left-3 top-3 z-[5] flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-950/80 px-2.5 py-1.5 text-xs text-amber-100">
      The tool is working on the {ts.side} side.
      <button
        type="button"
        className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 font-medium hover:bg-amber-500/30"
        onClick={() => set({ side: ts.side, follow: true })}
      >
        Show it
      </button>
    </div>
  )
}

// ───────────────────────────────────────── G-code (compact, bottom of the right panel)

function GcodePanel({ text }: { text: string }): React.JSX.Element {
  const data = useSim((s) => s.data)
  const line = useSim((s) => (s.data ? lineAt(s.data, s.time) : -1))
  const onLineClick = useCallback((ln: number) => {
    const d = useSim.getState().data
    if (!d) return
    simEngine.pause()
    simEngine.seek(d.lineStart[Math.min(ln, d.lineStart.length - 1)] ?? 0)
  }, [])
  return (
    <div className="flex min-h-[140px] flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">G-code</span>
        <Tooltip
          content="The program the machine runs, one command per line. The highlighted line is the one being executed. Click any line to jump the simulation there; hover a word for an explanation."
          side="left"
        >
          <span className="cursor-help rounded-full border border-slate-700 px-1.5 text-[10px] text-slate-400">
            ?
          </span>
        </Tooltip>
        <span className="ml-auto font-mono text-[11px] text-slate-500" data-testid="sim-line">
          {data && line >= 0 ? `line ${line + 1}` : ''}
        </span>
      </div>
      <div className="min-h-0 flex-1 border-t border-slate-800">
        <LazyGcodeViewer value={text} activeLine={line} onLineClick={onLineClick} data-testid="sim-gcode" />
      </div>
    </div>
  )
}

// ───────────────────────────────────────── legend

function Legend(): React.JSX.Element {
  const items: { color: string; label: string; help: string; ring?: boolean }[] = [
    { color: '#c4703f', label: 'Copper', help: 'Copper foil still on the board.' },
    {
      color: '#a7b26f',
      label: 'FR4',
      help: 'Fibreglass board material, exposed where the tool cut through the copper (isolation trenches).'
    },
    {
      color: '#2a2f3a',
      label: 'Cut through',
      help: 'Holes, slots and the board outline cut all the way through the board: you see the surface underneath.'
    },
    {
      color: '#38bdf8',
      label: 'Design copper',
      help: 'Cyan outline shown with “Design”: the copper your PCB design needs.',
      ring: true
    }
  ]
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
      {items.map((i) => (
        <Tooltip key={i.label} content={i.help}>
          <span className="flex cursor-help items-center gap-1.5">
            <span
              className="size-3 rounded-sm"
              style={i.ring ? { boxShadow: `inset 0 0 0 2px ${i.color}` } : { background: i.color }}
            />
            {i.label}
          </span>
        </Tooltip>
      ))}
      <span className="hidden text-slate-600 xl:inline">
        Drag to rotate · right-drag to pan · Alt+drag to move the sun · Space to play
      </span>
    </div>
  )
}
