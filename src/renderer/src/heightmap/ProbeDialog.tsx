import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, ShieldAlert, Save } from 'lucide-react'
import type { ProbeGridConfig } from '@core/model/types'
import { HELP } from '@core/help'
import { defaultProbeGrid, gridStep } from '@core/heightmap'
import { camWorker } from '@workers/index'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { NumberField, Segmented } from '@renderer/components/ui/fields'
import { HelpTip } from '@renderer/components/ui/help'
import { cn, formatDuration } from '@renderer/lib/utils'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { saveOne } from '@renderer/export/exportFiles'
import { boardProbeArea, estimateProbeSeconds, stockProbeArea, useWorkScene } from './geometry'
import { ProbePreview } from './ProbePreview'
import {
  ConnectIllustration,
  ContinuityIllustration,
  RunIllustration,
  SaveLogIllustration,
  ZeroIllustration
} from './ProbeIllustrations'
import { PROBE_CFG_SETTINGS_KEY, useAutoLevel } from './state'
import {
  ProbeAreaFigure,
  ProbeDepthFigure,
  ProbeLiftFigure,
  ProbeSpacingFigure,
  ProbeSpeedFigure
} from './ProbeFigures'

/** Help text with an animated figure below it, shown wide in the (?). */
const fig = (text: React.ReactNode, node: React.ReactNode): { help: React.ReactNode; helpWide: true } => ({
  help: (
    <>
      {text}
      <div className="mt-2">{node}</div>
    </>
  ),
  helpWide: true
})

type Area = { minX: number; minY: number; maxX: number; maxY: number }

const sameArea = (a: Area, b: Area): boolean =>
  Math.abs(a.minX - b.minX) < 0.01 &&
  Math.abs(a.minY - b.minY) < 0.01 &&
  Math.abs(a.maxX - b.maxX) < 0.01 &&
  Math.abs(a.maxY - b.maxY) < 0.01

const RESULT_INFO: Record<string, { title: string; body: string }> = {
  grbl: {
    title: 'GRBL (Candle, UGS, bCNC, CNCjs…)',
    body: 'GRBL prints a line like [PRB:12.000,5.000,-0.120:1] for every touch. After the run, save or copy the whole console log of your sender into a .txt file and import that file.'
  },
  linuxcnc: {
    title: 'LinuxCNC',
    body: 'The program writes every touch point to probe-results.txt in your LinuxCNC configuration folder. Import that file.'
  },
  mach3: {
    title: 'Mach3 / Mach4',
    body: 'The program opens a "digitize" file (M40) and Mach writes X,Y,Z of every touch into it. You need the M40/M41 macros (OpenDigFile / CloseDigFile) – see the comments at the top of the program. Import the file Mach asked you to name.'
  },
  generic: {
    title: 'Other controllers',
    body: 'Collect the X Y Z of each touch from your controller and save them as a text/CSV file with one point per line (x,y,z). Import that file.'
  }
}

function safeName(n: string): string {
  return (
    n
      .trim()
      .replace(/[^a-z0-9_-]+/gi, '_')
      .replace(/^_+|_+$/g, '') || 'board'
  )
}

function IntroStep({
  n,
  title,
  art,
  children
}: {
  n: number
  title: string
  art: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <li className="flex gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-100">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-slate-400">{children}</div>
      </div>
      <div className="shrink-0 rounded-md bg-slate-900 p-1">{art}</div>
    </li>
  )
}

function IntroPage({
  understood,
  setUnderstood
}: {
  understood: boolean
  setUnderstood: (v: boolean) => void
}): React.JSX.Element {
  const machine = useProject((s) => s.machine)
  const dialect = machine?.postProcessor ?? 'generic'
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-100">
        <div className="mb-1 flex items-center gap-2 font-semibold text-amber-300">
          <ShieldAlert className="size-4" /> Before you start – safety
        </div>
        <ul className="list-disc space-y-0.5 pl-5 text-xs leading-relaxed">
          <li>
            The spindle must be <b>OFF</b> the whole time. Probing only touches the copper very gently.
          </li>
          <li>
            Keep a hand near the emergency stop the first time. If the bit pushes into the board, stop at
            once.
          </li>
          <li>
            Test the wiring first (step 2). If the probe never “feels” the copper, the bit will press into the
            board until the maximum depth.
          </li>
          <li>Remove the clip from the bit before you start milling.</li>
          {machine && !machine.supportsProbing && (
            <li className="font-semibold text-rose-300">
              Your machine profile “{machine.name}” says it does not support probing. Check that your
              controller has a probe input before going on.
            </li>
          )}
        </ul>
      </div>
      <p className="text-sm text-slate-300">{HELP['autolevel.probing']?.body} Here is the whole process:</p>
      <ol className="flex flex-col gap-2">
        <IntroStep n={1} title="Connect the probe" art={<ConnectIllustration />}>
          Clip the probe wire onto the bit (the metal shank) and connect the second wire to the copper of the
          board, for example with a crocodile clip on the edge. Both go to the probe input of your controller.
        </IntroStep>
        <IntroStep n={2} title="Test the connection" art={<ContinuityIllustration />}>
          Touch the board clip to the bit by hand: your control software should show the probe as “triggered”
          (a light or status). Let go and it must switch off again.
        </IntroStep>
        <IntroStep n={3} title="Go to point 1 and set zero" art={<ZeroIllustration />}>
          Set X0 Y0 exactly as you will for milling. Move to the first probe point (shown in red on the next
          page), just above the copper, and set Z = 0 on the copper surface. All heights are measured relative
          to this point.
        </IntroStep>
        <IntroStep n={4} title="Run the probe program" art={<RunIllustration />}>
          The machine visits every grid point, lowers the bit slowly until it touches the copper and remembers
          the height. Don’t move X/Y zero afterwards. If you change bits later, set Z zero again at point 1.
        </IntroStep>
        <IntroStep n={5} title="Save the results" art={<SaveLogIllustration />}>
          <span className="mb-1 block">Your controller creates a list of measured points:</span>
          {Object.entries(RESULT_INFO).map(([k, v]) => (
            <span
              key={k}
              className={cn(
                'mb-1 block rounded px-1.5 py-1',
                k === dialect ? 'bg-sky-500/15 text-sky-100 ring-1 ring-sky-500/40' : 'opacity-70'
              )}
            >
              <b>{v.title}</b>
              {k === dialect && ' (your machine)'}: {v.body}
            </span>
          ))}
          Then come back here and use <b>2. Import probe results</b>.
        </IntroStep>
      </ol>
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200">
        <input
          type="checkbox"
          data-testid="probe-understand"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
          className="size-4 accent-sky-500"
        />
        I understand the process and the safety notes.
      </label>
    </div>
  )
}

type GridMode = 'spacing' | 'count'

export function ProbeDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}): React.JSX.Element {
  const machine = useProject((s) => s.machine)
  const material = useProject((s) => s.material)
  const projectName = useProject((s) => s.name)
  const toast = useUi((s) => s.toast)
  const al = useAutoLevel()
  const scene = useWorkScene(al.measuredSide)
  const [page, setPage] = useState<'intro' | 'config'>('intro')
  const [understood, setUnderstood] = useState(false)
  const [mode, setMode] = useState<GridMode>('spacing')
  const [spacing, setSpacing] = useState(10)
  const [cfg, setCfg] = useState<ProbeGridConfig | null>(null)
  const [saving, setSaving] = useState(false)

  // Initialise the grid when the dialog opens (last saved grid, else board area).
  useEffect(() => {
    if (!open) return
    setPage('intro')
    setUnderstood(false)
    if (al.probeCfg) setCfg(al.probeCfg)
    else if (scene) setCfg(defaultProbeGrid(boardProbeArea(scene), 10))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (open && !cfg && scene) setCfg(defaultProbeGrid(boardProbeArea(scene), spacing))
  }, [open, cfg, scene, spacing])

  const withSpacing = (c: ProbeGridConfig, sp: number): ProbeGridConfig => {
    const g = defaultProbeGrid(c, sp)
    return { ...c, countX: g.countX, countY: g.countY }
  }
  const setArea = (a: { minX: number; minY: number; maxX: number; maxY: number }): void => {
    if (!cfg) return
    const next = { ...cfg, ...a }
    setCfg(mode === 'spacing' ? withSpacing(next, spacing) : next)
  }
  const patch = (p: Partial<ProbeGridConfig>): void => setCfg((c) => (c ? { ...c, ...p } : c))

  const stats = useMemo(() => {
    if (!cfg || !machine) return null
    const { dx, dy } = gridStep(cfg)
    return {
      n: cfg.countX * cfg.countY,
      dx,
      dy,
      seconds: estimateProbeSeconds(cfg, machine.maxFeedXY, machine.maxFeedZ)
    }
  }, [cfg, machine])

  const boardArea = scene ? boardProbeArea(scene) : null
  const stockArea = scene ? stockProbeArea(scene) : null
  const areaPreset: 'board' | 'stock' | 'custom' =
    cfg && boardArea && sameArea(cfg, boardArea)
      ? 'board'
      : cfg && stockArea && sameArea(cfg, stockArea)
        ? 'stock'
        : 'custom'
  const areasAlike =
    !!boardArea &&
    !!stockArea &&
    Math.max(
      Math.abs(boardArea.minX - stockArea.minX),
      Math.abs(boardArea.minY - stockArea.minY),
      Math.abs(boardArea.maxX - stockArea.maxX),
      Math.abs(boardArea.maxY - stockArea.maxY)
    ) < 4

  const warnings: string[] = []
  if (cfg && scene) {
    const s = scene.stock
    if (cfg.maxX - cfg.minX <= 0 || cfg.maxY - cfg.minY <= 0) warnings.push('The probe area has no size.')
    if (
      cfg.minX < s.minX - 1e-6 ||
      cfg.minY < s.minY - 1e-6 ||
      cfg.maxX > s.maxX + 1e-6 ||
      cfg.maxY > s.maxY + 1e-6
    )
      warnings.push('Part of the probe area is outside the material – the bit would probe into thin air.')
    if (stats && stats.n > 400)
      warnings.push(`${stats.n} points will take a long time. 10 mm spacing is usually enough.`)
    if (stats && Math.min(stats.dx || Infinity, stats.dy || Infinity) < 3)
      warnings.push('Points closer than 3 mm rarely improve the result.')
    if (cfg.probeFeed > 200)
      warnings.push('Fast probing is less accurate and can bend thin bits; 20–100 mm/min is typical.')
    if (cfg.probeDepth < -5)
      warnings.push('A deep maximum probe depth can break the bit if the wiring fails.')
  }

  const save = async (): Promise<void> => {
    if (!cfg || !machine) return
    setSaving(true)
    try {
      const text = await camWorker().probeProgram(cfg, machine)
      const ext = (machine.fileExtension || 'nc').replace(/^\.+/, '')
      const ok = await saveOne(`${safeName(projectName)}_probe.${ext}`, text)
      if (!ok) return
      al.set({ probeSaved: true, probeCfg: cfg })
      void window.tracemill
        ?.settingsSet(PROBE_CFG_SETTINGS_KEY, { cfg, side: al.measuredSide })
        .catch(() => undefined)
      toast('success', 'Probe program saved. Run it on your machine, then import the results (step 2).')
      onOpenChange(false)
    } catch (e) {
      toast('error', `Could not create the probe program: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const footer =
    page === 'intro' ? (
      <>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button data-testid="probe-next" disabled={!understood} onClick={() => setPage('config')}>
          Next: set up the grid <ArrowRight />
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" className="mr-auto" onClick={() => setPage('intro')}>
          <ArrowLeft /> Back
        </Button>
        {stats && (
          <span className="text-xs text-slate-400">
            <b className="text-slate-200">{stats.n}</b> points · about{' '}
            <b className="text-slate-200">{formatDuration(stats.seconds)}</b> of probing
          </span>
        )}
        <Button data-testid="probe-save" disabled={!cfg || !machine || saving} onClick={() => void save()}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />} Save probe program
        </Button>
      </>
    )

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        page === 'intro'
          ? 'Auto-level · 1. Probe program – how it works'
          : 'Auto-level · 1. Probe program – grid'
      }
      description={
        page === 'intro'
          ? 'Read this once. Probing measures how flat your board really is.'
          : 'Choose where the machine measures. The picture updates as you change the values.'
      }
      className="w-[min(95vw,1040px)]"
      footer={footer}
    >
      <div data-testid="probe-dialog">
        {page === 'intro' ? (
          <IntroPage understood={understood} setUnderstood={setUnderstood} />
        ) : !cfg || !scene || !material ? (
          <div className="p-6 text-sm text-slate-400">Import a board and set up the material first.</div>
        ) : (
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex w-full shrink-0 flex-col gap-3 md:w-[340px]">
              {material.doubleSided && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                    Side facing up while probing
                    <HelpTip title="Side facing up">
                      The height map only fits the side that is facing up while you probe. Probe the top side
                      before milling it; after flipping, probe again for the bottom side.
                    </HelpTip>
                  </div>
                  <Segmented
                    stretch
                    value={al.measuredSide}
                    onChange={(v) => {
                      al.set({ measuredSide: v })
                      setCfg(null)
                    }}
                    options={[
                      { value: 'top', label: 'Top side' },
                      { value: 'bottom', label: 'Bottom side' }
                    ]}
                  />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  Area to measure
                  <HelpTip title="Probe area" wide>
                    The rectangle in which the machine measures heights. It only needs to cover the parts that
                    will be milled: usually the board plus a small margin.
                    <div className="mt-2">
                      <ProbeAreaFigure />
                    </div>
                  </HelpTip>
                </div>
                <Segmented
                  stretch
                  value={areaPreset}
                  onChange={(v) => {
                    if (v === 'board' && boardArea) setArea(boardArea)
                    else if (v === 'stock' && stockArea) setArea(stockArea)
                  }}
                  options={[
                    { value: 'board', label: 'Board + 2 mm' },
                    { value: 'stock', label: 'Whole material' },
                    { value: 'custom', label: 'Custom' }
                  ]}
                />
                {areasAlike && (
                  <p className="text-[11px] leading-snug text-slate-500">
                    Your material is only a little larger than the board, so these two are almost the same.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label="Left edge (X)"
                    unit="mm"
                    value={round(cfg.minX)}
                    onChange={(v) => setArea({ ...cfg, minX: v })}
                    {...fig('Distance from X0 to the left side of the area.', <ProbeAreaFigure />)}
                  />
                  <NumberField
                    label="Right edge (X)"
                    unit="mm"
                    value={round(cfg.maxX)}
                    onChange={(v) => setArea({ ...cfg, maxX: v })}
                    {...fig('Distance from X0 to the right side of the area.', <ProbeAreaFigure />)}
                  />
                  <NumberField
                    label="Front edge (Y)"
                    unit="mm"
                    value={round(cfg.minY)}
                    onChange={(v) => setArea({ ...cfg, minY: v })}
                    {...fig(
                      'Distance from Y0 to the front side of the area (nearest to you).',
                      <ProbeAreaFigure />
                    )}
                  />
                  <NumberField
                    label="Back edge (Y)"
                    unit="mm"
                    value={round(cfg.maxY)}
                    onChange={(v) => setArea({ ...cfg, maxY: v })}
                    {...fig('Distance from Y0 to the back side of the area.', <ProbeAreaFigure />)}
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  {fmt1(cfg.maxX - cfg.minX)} × {fmt1(cfg.maxY - cfg.minY)} mm, measured from X0 Y0 (where you
                  zero the machine for milling).
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                    Grid density
                    <HelpTip title={HELP['autolevel.grid']?.title}>{HELP['autolevel.grid']?.body}</HelpTip>
                  </div>
                  <Segmented
                    size="sm"
                    value={mode}
                    onChange={(m) => {
                      setMode(m)
                      if (m === 'spacing') setCfg(withSpacing(cfg, spacing))
                    }}
                    options={[
                      { value: 'spacing', label: 'By distance' },
                      { value: 'count', label: 'By count' }
                    ]}
                  />
                </div>
                {mode === 'spacing' ? (
                  <NumberField
                    label="Distance between points"
                    unit="mm"
                    min={1}
                    max={100}
                    step={1}
                    value={spacing}
                    description="About 10 mm works well. Smaller = more detail but slower."
                    {...fig(HELP['autolevel.grid']?.body, <ProbeSpacingFigure spacing={spacing} />)}
                    onChange={(v) => {
                      setSpacing(v)
                      setCfg(withSpacing(cfg, v))
                    }}
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      label="Points along X"
                      min={2}
                      max={60}
                      step={1}
                      value={cfg.countX}
                      onChange={(v) => patch({ countX: Math.max(2, Math.round(v)) })}
                      {...fig(HELP['autolevel.grid']?.body, <ProbeSpacingFigure spacing={stats?.dx || 10} />)}
                    />
                    <NumberField
                      label="Points along Y"
                      min={2}
                      max={60}
                      step={1}
                      value={cfg.countY}
                      onChange={(v) => patch({ countY: Math.max(2, Math.round(v)) })}
                      {...fig(HELP['autolevel.grid']?.body, <ProbeSpacingFigure spacing={stats?.dy || 10} />)}
                    />
                  </div>
                )}
                {stats && (
                  <p className="text-[11px] text-slate-500">
                    {cfg.countX} × {cfg.countY} = <b className="text-slate-300">{stats.n} points</b>, one
                    every {stats.dx.toFixed(1)} × {stats.dy.toFixed(1)} mm.
                  </p>
                )}
              </div>
              <NumberField
                label="Probe speed"
                unit="mm/min"
                min={1}
                max={1000}
                step={5}
                value={cfg.probeFeed}
                onChange={(v) => patch({ probeFeed: v })}
                description="How fast the bit goes down looking for the copper. Slow is more accurate."
                {...fig(HELP['autolevel.probeFeed']?.body, <ProbeSpeedFigure feed={cfg.probeFeed} />)}
              />
              <NumberField
                label="Maximum probe depth"
                unit="mm"
                min={0.1}
                max={20}
                step={0.5}
                value={Math.abs(cfg.probeDepth)}
                onChange={(v) => patch({ probeDepth: -Math.abs(v) })}
                description="How far below zero it searches before giving up (an error on most controllers)."
                {...fig(HELP['autolevel.probeDepth']?.body, <ProbeDepthFigure depth={cfg.probeDepth} />)}
              />
              <NumberField
                label="Lift between points"
                unit="mm"
                min={0.5}
                max={30}
                step={0.5}
                value={cfg.clearanceZ}
                onChange={(v) => patch({ clearanceZ: v })}
                description="How high the bit rises while moving to the next point."
                {...fig(HELP['autolevel.clearanceZ']?.body, <ProbeLiftFigure lift={cfg.clearanceZ} />)}
              />
              {warnings.length > 0 && (
                <div className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                  {warnings.map((w) => (
                    <div key={w} className="flex gap-1">
                      <AlertTriangle className="mt-px size-3 shrink-0" /> {w}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
                <ProbePreview scene={scene} cfg={cfg} className="h-[470px] w-full" />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                <Legend color="rgba(217,149,84,0.9)" dashed label="material (stock)" />
                <Legend color="#34d399" label="board outline" />
                <Legend color="#38bdf8" dashed label="probe area" />
                <Legend color="#fb7185" dot label="point 1 – zero Z here" />
                <Legend color="#38bdf8" dot label="order the machine follows" />
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}

const round = (v: number): number => Math.round(v * 100) / 100
const fmt1 = (v: number): string => String(Math.round(v * 10) / 10)

function Legend({
  color,
  label,
  dashed,
  dot
}: {
  color: string
  label: string
  dashed?: boolean
  dot?: boolean
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-1">
      {dot ? (
        <span className="inline-block size-2.5 rounded-full" style={{ background: color }} />
      ) : (
        <span
          className="inline-block w-4 border-t-2"
          style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }}
        />
      )}
      {label}
    </span>
  )
}
