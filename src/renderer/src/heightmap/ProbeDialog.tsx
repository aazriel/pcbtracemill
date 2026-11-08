import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  Pentagon,
  ShieldAlert,
  Save,
  Square,
  Pin
} from 'lucide-react'
import type { Path, ProbeGridConfig } from '@core/model/types'
import { HELP } from '@core/help'
import { recommendedProbeSpacing } from '@core/cam'
import { useJobClearance } from '@renderer/steps/IsolationAdvice'
import {
  autoProbeLift,
  cellsNearShape,
  defaultProbeGrid,
  gridStep,
  MACH3_PROBE_FILE,
  MACH3_RETOUCH_LIFT,
  MACH3_RETOUCH_FEED,
  MACH3_VAR_MAX_CELLS,
  mach3ProbeMacros,
  probePoints,
  type Mach3Recorder
} from '@core/heightmap'
import { camWorker } from '@workers/index'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { NumberField, Segmented, Switch } from '@renderer/components/ui/fields'
import { HelpTip } from '@renderer/components/ui/help'
import { cn, formatDuration } from '@renderer/lib/utils'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { saveMany, saveOne } from '@renderer/export/exportFiles'
import { originLabel } from '@renderer/material/OriginPicker'
import { boardProbeArea, estimateProbeSeconds, stockProbeArea, useWorkScene } from './geometry'
import { ProbePreview, type DrawTool } from './ProbePreview'
import {
  ConnectIllustration,
  ContinuityIllustration,
  RunIllustration,
  SaveLogIllustration,
  ZeroIllustration
} from './ProbeIllustrations'
import { PROBE_CFG_SETTINGS_KEY, useAutoLevel } from './state'
import {
  AreaChoiceArt,
  DrawAreaHint,
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
    body: 'Plain G-code, nothing to install and no file: every point is touched twice (fast, then slowly) and the height is kept in a Mach3 variable (#500…). The corrected files read those heights, so run them in the same Mach3 session. Other ways (digitize file, PCB TraceMill macros) can be chosen on the next page.'
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

/** "Do not show this again" for the how-it-works page (settings key). */
const SKIP_INTRO_KEY = 'probeIntroSkip'
let skipIntro = false
void window.tracemill
  ?.settingsGet<boolean>(SKIP_INTRO_KEY, false)
  .then((v) => (skipIntro = !!v))
  .catch(() => undefined)
function setSkipIntro(v: boolean): void {
  if (skipIntro === v) return
  skipIntro = v
  void window.tracemill?.settingsSet(SKIP_INTRO_KEY, v)
}

function IntroPage({
  understood,
  setUnderstood,
  dontShow,
  setDontShow
}: {
  understood: boolean
  setUnderstood: (v: boolean) => void
  dontShow: boolean
  setDontShow: (v: boolean) => void
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
          <li>
            You can probe with the <b>milling bit itself</b> (0.1 mm tip) – keep the probe speed slow. Clean
            the copper first: where it doesn’t conduct (oxide, lacquer), the tip is pushed into the board and
            breaks. After a bit change PCB TraceMill finds Z zero again at point 1.
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
      <div
        className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-100"
        data-testid="probe-hold-board"
      >
        <div className="mb-1 flex items-center gap-2 font-semibold text-sky-300">
          <Pin className="size-4" /> For an even cut depth – keep the board still
        </div>
        <ul className="list-disc space-y-0.5 pl-5 text-xs leading-relaxed">
          <li>
            The height map is only right while the board stays exactly as it was probed. Tape slowly lets go
            and a corner can rise 0.5 mm or more in half an hour – then one side is cut too deep and the other
            barely scratched.
          </li>
          <li>
            Put the board in the <b>middle</b> of the sheet, tape it down, wait about <b>30 minutes</b> for
            the tape to settle, then probe – and start milling <b>right after</b> probing.
          </li>
          <li>
            Watch the first points: if the bit doesn’t go down to the copper, the controller missed that
            touch. Stop and run the probe program again.
          </li>
        </ul>
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          data-testid="probe-setup-guide"
          onClick={() => useUi.getState().set({ helpOpen: true, helpTopic: 'setup' })}
        >
          <Pin /> Board setup guide (step by step, with pictures)
        </Button>
      </div>
      <p className="text-sm text-slate-300">{HELP['autolevel.probing']?.body} Here is the whole process:</p>
      <ol className="flex flex-col gap-2">
        <IntroStep n={1} title="Connect the probe" art={<ConnectIllustration />}>
          Put the milling bit in the spindle (or any other bit). Clip the probe wire onto the bit (the metal
          shank) and connect the second wire to the copper of the board, for example with a crocodile clip on
          the edge. Both go to the probe input of your controller.
        </IntroStep>
        <IntroStep n={2} title="Test the connection" art={<ContinuityIllustration />}>
          Touch the board clip to the bit by hand: your control software should show the probe as “triggered”
          (a light or status). Let go and it must switch off again.
        </IntroStep>
        <IntroStep n={3} title="Go to point 1 and set zero" art={<ZeroIllustration />}>
          Set X0 Y0 exactly as you will for milling – the next page shows where X0 Y0 is and which way X+ and
          Y+ point. Move to the first probe point (shown in red, with its distance from X0 Y0), just above the
          copper, and set Z = 0 on the copper surface. All heights are measured relative to this point.
        </IntroStep>
        <IntroStep n={4} title="Run the probe program" art={<RunIllustration />}>
          The machine visits every grid point, lowers the bit slowly until it touches the copper and remembers
          the height. Don’t move X/Y zero afterwards. When you change bits later, the corrected G-code can
          find Z zero at point 1 by itself (you only set it roughly).
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
          {dialect === 'mach3' ? (
            <>
              Then come back here and press <b>Probing done</b> (with the default Mach3 variables).
            </>
          ) : (
            <>
              Then come back here and use <b>Load probe results</b>.
            </>
          )}
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
      <label className="flex cursor-pointer items-center gap-2 px-3 text-xs text-slate-400">
        <input
          type="checkbox"
          data-testid="probe-intro-skip"
          checked={dontShow}
          onChange={(e) => setDontShow(e.target.checked)}
          className="size-3.5 accent-sky-500"
        />
        Do not show this page again (open it with Back on the next page)
      </label>
    </div>
  )
}

type GridMode = 'spacing' | 'count'
type AreaMode = 'board' | 'stock' | 'custom'

const AREA_CHOICES: { value: AreaMode; label: string; text: string }[] = [
  { value: 'board', label: 'Board shape', text: 'Around the board outline + 2 mm' },
  { value: 'stock', label: 'Whole material', text: 'The full sheet, 3 mm in from its edges' },
  { value: 'custom', label: 'Custom', text: 'Drag on the picture or type the edges' }
]

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
  const [dontShow, setDontShow] = useState(false)
  const [mode, setMode] = useState<GridMode>('spacing')
  // the grid spacing follows the narrowest copper gap of the job (D-031)
  const clearance = useJobClearance()
  const recSpacing = recommendedProbeSpacing(clearance?.clearance ?? null)
  const [spacing, setSpacing] = useState(recSpacing)
  const [cfg, setCfg] = useState<ProbeGridConfig | null>(null)
  const [areaMode, setAreaMode] = useState<AreaMode>('board')
  /** The user drew an area on the picture once: the "drag here" hint is no longer needed. */
  const [drewOnce, setDrewOnce] = useState(false)
  const [drawTool, setDrawTool] = useState<DrawTool>('rect')
  /** Custom area drawn as a circle or polygon (null: the plain rectangle of the edges). */
  const [customShape, setCustomShape] = useState<Path | null>(null)
  const [saving, setSaving] = useState(false)
  const [mach3Recorder, setMach3Recorder] = useState<Mach3Recorder>('variables')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  /** Lift between points follows the spacing (5 %) until the user types a value. */
  const [liftAuto, setLiftAuto] = useState(true)

  // Initialise the grid when the dialog opens (last saved grid, else the board shape).
  useEffect(() => {
    if (!open) return
    setPage(skipIntro ? 'config' : 'intro')
    setUnderstood(skipIntro)
    setDontShow(skipIntro)
    const saved = al.probeCfg
    if (saved && scene) {
      setCfg(saved)
      setAreaMode(
        saved.cells?.length || sameArea(saved, boardProbeArea(scene))
          ? 'board'
          : sameArea(saved, stockProbeArea(scene))
            ? 'stock'
            : 'custom'
      )
    } else if (scene) {
      setSpacing(recSpacing)
      setCfg(defaultProbeGrid(boardProbeArea(scene), recSpacing))
      setAreaMode('board')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (open && !cfg && scene) {
      setCfg(defaultProbeGrid(boardProbeArea(scene), spacing))
      setAreaMode('board')
    }
  }, [open, cfg, scene, spacing])

  // The grid that is really probed: on "Board shape" only the points near the board's real outline.
  const live = useMemo<ProbeGridConfig | null>(() => {
    if (!cfg) return null
    const { cells: _old, ...base } = cfg
    if (areaMode === 'custom' && customShape) {
      const cells = cellsNearShape(base, [{ outer: customShape, holes: [] }], 0, false)
      return cells ? { ...base, cells } : base
    }
    if (areaMode !== 'board' || !scene) return base
    const cells = cellsNearShape(base, scene.shape, 2)
    return cells ? { ...base, cells } : base
  }, [cfg, areaMode, scene, customShape])

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

  const first = useMemo(() => (live ? (probePoints(live)[0] ?? null) : null), [live])
  const originText = useMemo(() => {
    if (!material) return undefined
    const on = material.originOn ?? 'stock'
    const t =
      originLabel(material.origin, on) +
      (on === 'stock' && material.origin !== 'center' ? ' of the material' : '')
    return t.charAt(0).toLowerCase() + t.slice(1)
  }, [material])
  const stats = useMemo(() => {
    if (!live || !machine) return null
    const { dx, dy } = gridStep(live)
    return {
      n: probePoints(live).length,
      all: live.countX * live.countY,
      dx,
      dy,
      seconds: estimateProbeSeconds(
        live,
        machine.maxFeedXY,
        machine.maxFeedZ,
        machine.postProcessor === 'mach3' && mach3Recorder === 'variables'
          ? live.retouch
            ? { lift: live.retouchLift ?? MACH3_RETOUCH_LIFT, feed: MACH3_RETOUCH_FEED }
            : undefined
          : undefined
      )
    }
  }, [live, machine, mach3Recorder])

  // Automatic lift between points: 5 % of the grid spacing
  const autoLift = cfg ? autoProbeLift(Math.max(gridStep(cfg).dx, gridStep(cfg).dy)) : null
  useEffect(() => {
    if (liftAuto && cfg && autoLift !== null && Math.abs(cfg.clearanceZ - autoLift) > 1e-9)
      setCfg((c) => (c ? { ...c, clearanceZ: autoLift } : c))
  }, [liftAuto, autoLift, cfg])

  const boardArea = scene ? boardProbeArea(scene) : null
  const stockArea = scene ? stockProbeArea(scene) : null
  const followsShape = !!live?.cells
  const areasAlike =
    areaMode !== 'custom' &&
    !followsShape &&
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
    if (
      machine?.postProcessor === 'mach3' &&
      mach3Recorder === 'variables' &&
      cfg.countX * cfg.countY > MACH3_VAR_MAX_CELLS
    )
      warnings.push(
        `Mach3 can keep at most ${MACH3_VAR_MAX_CELLS} heights in variables – use a wider spacing (now ${cfg.countX} × ${cfg.countY}).`
      )
  }

  const save = async (): Promise<void> => {
    if (!cfg || !machine) return
    setSaving(true)
    try {
      if (!live) return
      const text = await camWorker().probeProgram(live, machine, { mach3Recorder })
      const ext = (machine.fileExtension || 'nc').replace(/^\.+/, '')
      const ok = await saveOne(`${safeName(projectName)}_probe.${ext}`, text)
      if (!ok) return
      const isMach3 = machine.postProcessor === 'mach3'
      al.set({ probeSaved: true, probeCfg: live, probeRecorder: isMach3 ? mach3Recorder : null })
      // A Mach3 variables map belongs to one grid: corrected files made for another grid would read
      // the wrong variables, so a new grid drops it until "Probing done" is pressed again.
      const cur = useProject.getState().heightMap
      const dropped = cur?.mach3Vars !== undefined && JSON.stringify(cur.config) !== JSON.stringify(live)
      if (dropped) {
        useProject.getState().setHeightMap(null)
        al.set({ apply: false, importInfo: null })
      }
      void window.tracemill
        ?.settingsSet(PROBE_CFG_SETTINGS_KEY, { cfg: live, side: al.measuredSide })
        .catch(() => undefined)
      toast(
        'success',
        isMach3 && mach3Recorder === 'macros'
          ? 'Probe program saved. It needs the PCB TraceMill Mach3 macros M401 / M402 – save them with "Mach3 macros…" if you have not yet.'
          : isMach3 && mach3Recorder === 'variables'
            ? `Probe program saved. Run it in Mach3 – the heights stay in Mach3, there is no file to load. Then press “Probing done” (step 2)${dropped ? ' and save the corrected files again: the grid changed, so the old height map was removed' : ''}.`
            : 'Probe program saved. Run it on your machine, then import the results (step 2).'
      )
      if (machine.postProcessor !== 'mach3' || mach3Recorder !== 'macros') onOpenChange(false)
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
        <Button
          data-testid="probe-next"
          disabled={!understood}
          onClick={() => {
            setSkipIntro(dontShow)
            setPage('config')
          }}
        >
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
        {machine?.postProcessor === 'mach3' && mach3Recorder === 'macros' && (
          <Button
            variant="secondary"
            data-testid="probe-save-macros"
            title="M401.m1s and M402.m1s – put them in Mach3/macros/<your profile>/"
            onClick={() =>
              void saveMany(mach3ProbeMacros().map((m) => ({ name: m.name, text: m.text }))).then((r) => {
                if (r !== null)
                  toast(
                    'success',
                    typeof r === 'string'
                      ? `Saved M401.m1s and M402.m1s to ${r}. They must be in Mach3/macros/<your profile>/ – restart Mach3 once.`
                      : 'Downloading M401.m1s and M402.m1s…'
                  )
              })
            }
          >
            <Save /> Mach3 macros…
          </Button>
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
          <IntroPage
            understood={understood}
            setUnderstood={setUnderstood}
            dontShow={dontShow}
            setDontShow={setDontShow}
          />
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
                      setCustomShape(null)
                      if (areaMode !== 'custom') setCfg(null)
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
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Area to measure">
                  {AREA_CHOICES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      role="radio"
                      aria-checked={areaMode === c.value}
                      onClick={() => {
                        setAreaMode(c.value)
                        setCustomShape(null)
                        if (c.value === 'board' && boardArea) setArea(boardArea)
                        else if (c.value === 'stock' && stockArea) setArea(stockArea)
                      }}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-lg border px-1.5 pb-1.5 pt-1 text-center transition-colors',
                        areaMode === c.value
                          ? 'border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/50'
                          : 'border-slate-700 bg-slate-900 hover:border-slate-500'
                      )}
                      data-testid={`probe-area-${c.value}`}
                    >
                      <AreaChoiceArt kind={c.value} />
                      <span
                        className={cn(
                          'text-xs font-semibold',
                          areaMode === c.value ? 'text-sky-200' : 'text-slate-200'
                        )}
                      >
                        {c.label}
                      </span>
                      <span className="text-[10.5px] leading-tight text-slate-400">{c.text}</span>
                    </button>
                  ))}
                </div>
                {areaMode === 'custom' && (
                  <div className="flex items-center gap-1.5" data-testid="probe-draw-tools">
                    <span className="text-[11px] text-slate-400">Draw a</span>
                    <Segmented
                      size="sm"
                      value={drawTool}
                      onChange={(t) => {
                        setDrawTool(t)
                        setDrewOnce(false)
                      }}
                      options={[
                        { value: 'rect', label: <ToolLabel icon={<Square />} text="Rectangle" /> },
                        { value: 'circle', label: <ToolLabel icon={<Circle />} text="Circle" /> },
                        { value: 'polygon', label: <ToolLabel icon={<Pentagon />} text="Polygon" /> }
                      ]}
                    />
                  </div>
                )}
                {areaMode === 'custom' && customShape && stats && (
                  <p className="text-[11px] leading-snug text-slate-400">
                    <b className="text-slate-200">{stats.n}</b> of {stats.all} grid points are inside your
                    shape.
                  </p>
                )}
                {areaMode === 'board' && followsShape && stats && (
                  <p className="text-[11px] leading-snug text-slate-400" data-testid="probe-area-note">
                    <b className="text-slate-200">{stats.n}</b> of {stats.all} grid points are near your
                    board; the others (faint) are skipped and filled in from their neighbours.
                  </p>
                )}
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
                    onChange={(v) => {
                      setAreaMode('custom')
                      setCustomShape(null)
                      setArea({ ...cfg, minX: v })
                    }}
                    {...fig('Distance from X0 to the left side of the area.', <ProbeAreaFigure />)}
                  />
                  <NumberField
                    label="Right edge (X)"
                    unit="mm"
                    value={round(cfg.maxX)}
                    onChange={(v) => {
                      setAreaMode('custom')
                      setCustomShape(null)
                      setArea({ ...cfg, maxX: v })
                    }}
                    {...fig('Distance from X0 to the right side of the area.', <ProbeAreaFigure />)}
                  />
                  <NumberField
                    label="Front edge (Y)"
                    unit="mm"
                    value={round(cfg.minY)}
                    onChange={(v) => {
                      setAreaMode('custom')
                      setCustomShape(null)
                      setArea({ ...cfg, minY: v })
                    }}
                    {...fig(
                      'Distance from Y0 to the front side of the area (nearest to you).',
                      <ProbeAreaFigure />
                    )}
                  />
                  <NumberField
                    label="Back edge (Y)"
                    unit="mm"
                    value={round(cfg.maxY)}
                    onChange={(v) => {
                      setAreaMode('custom')
                      setCustomShape(null)
                      setArea({ ...cfg, maxY: v })
                    }}
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
                    description={
                      clearance?.clearance != null
                        ? `${recSpacing} mm suits this board's ${clearance.clearance} mm copper gaps (10 mm under 0.5 mm gaps, 15 mm under 1.2 mm, 20 mm above). Smaller = more detail but slower.`
                        : `${recSpacing} mm suits wide copper gaps (10 mm under 0.5 mm gaps, 15 mm under 1.2 mm). Smaller = more detail but slower.`
                    }
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
                    {stats.n < stats.all
                      ? `${stats.n} of ${cfg.countX} × ${cfg.countY}`
                      : `${cfg.countX} × ${cfg.countY}`}{' '}
                    = <b className="text-slate-300">{stats.n} points</b>, one every {stats.dx.toFixed(1)} ×{' '}
                    {stats.dy.toFixed(1)} mm.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 rounded-md border border-slate-800 bg-slate-950/40 p-2">
                <button
                  type="button"
                  data-testid="probe-advanced"
                  className="flex items-center gap-1 text-left text-xs font-medium text-slate-300 hover:text-slate-100"
                  onClick={() => setAdvancedOpen((v) => !v)}
                >
                  {advancedOpen ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                  Advanced
                  <span className="ml-1 font-normal text-slate-500">
                    depth {Math.abs(cfg.probeDepth)} mm · speed {cfg.probeFeed} mm/min · lift {cfg.clearanceZ}{' '}
                    mm
                    {machine?.postProcessor === 'mach3' && mach3Recorder === 'variables'
                      ? cfg.retouch
                        ? ` · re-touch ${cfg.retouchLift ?? MACH3_RETOUCH_LIFT} mm`
                        : ' · one touch per point'
                      : ''}
                  </span>
                </button>
                {advancedOpen && (
                  <div className="flex flex-col gap-2" data-testid="probe-advanced-body">
                    <NumberField
                      label="Maximum probe depth"
                      unit="mm"
                      min={0.1}
                      max={20}
                      step={0.5}
                      value={Math.abs(cfg.probeDepth)}
                      onChange={(v) => patch({ probeDepth: -Math.abs(v) })}
                      description="How far below zero it searches before giving up (an error on most controllers)."
                      {...fig(
                        HELP['autolevel.probeDepth']?.body,
                        <ProbeDepthFigure depth={cfg.probeDepth} />
                      )}
                    />
                    {machine?.postProcessor === 'mach3' && (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                          Mach3 records the points with
                          <HelpTip title="How Mach3 records the points">
                            <b>G-code variables</b> (normal): plain G-code, no file and nothing to install.
                            Each point is touched once at the probe speed (a second, slow touch can be
                            switched on under Advanced); the height is read with G92 and kept in Mach3
                            variables #500…. The corrected files read them – so do not close Mach3 between
                            probing and milling. Works also when your motion controller never tells Mach3
                            where the probe tripped.
                            <br />
                            <b>Digitize file</b>: Mach3’s own M40 / M41 write every touch into a file that you
                            load into PCB TraceMill. Only correct if your motion controller reports the probe
                            position.
                            <br />
                            <b>PCB TraceMill macros</b>: two small macro files (M401 / M402) that you copy
                            into Mach3 once; they write the DRO position to a file.
                          </HelpTip>
                        </div>
                        <Segmented
                          stretch
                          value={mach3Recorder}
                          onChange={setMach3Recorder}
                          options={[
                            { value: 'variables', label: 'Variables' },
                            { value: 'digitize', label: 'Digitize file' },
                            { value: 'macros', label: 'Macros' }
                          ]}
                        />
                        {mach3Recorder === 'variables' && (
                          <p className="text-[11px] leading-snug text-slate-400">
                            No file to load: the heights stay in Mach3 until it is closed. Probe, then mill in
                            the same Mach3 session.
                          </p>
                        )}
                        {mach3Recorder === 'macros' && (
                          <p className="text-[11px] leading-snug text-slate-400">
                            Save the macros with <b>Mach3 macros…</b> below, copy them into
                            Mach3/macros/&lt;your profile&gt;/ and restart Mach3 once. Results go to{' '}
                            {MACH3_PROBE_FILE}.
                          </p>
                        )}
                      </div>
                    )}
                    <NumberField
                      label="Probe speed (fast touch)"
                      unit="mm/min"
                      min={1}
                      max={1000}
                      step={5}
                      value={cfg.probeFeed}
                      onChange={(v) => patch({ probeFeed: v })}
                      description="How fast the bit goes down looking for the copper at each point. 20 mm/min does not bend the board; slower is more accurate."
                      {...fig(HELP['autolevel.probeFeed']?.body, <ProbeSpeedFigure feed={cfg.probeFeed} />)}
                    />
                    <Switch
                      label="Automatic lift between points"
                      checked={liftAuto}
                      onChange={(v) => {
                        setLiftAuto(v)
                        if (v && autoLift !== null) patch({ clearanceZ: autoLift })
                      }}
                      description="5 % of the distance between points: 0.5 mm at 10 mm spacing, 1 mm at 20 mm."
                    />
                    <NumberField
                      label="Lift between points"
                      unit="mm"
                      min={0.2}
                      max={30}
                      step={0.05}
                      value={cfg.clearanceZ}
                      onChange={(v) => {
                        setLiftAuto(false)
                        patch({ clearanceZ: v })
                      }}
                      description="How far the bit rises above the copper it just touched before moving to the next point. Longer moves rise proportionally more; the start, the end and the move back to point 1 go to 2 mm."
                      {...fig(HELP['autolevel.clearanceZ']?.body, <ProbeLiftFigure lift={cfg.clearanceZ} />)}
                    />
                    {machine?.postProcessor === 'mach3' && mach3Recorder === 'variables' && (
                      <Switch
                        label="Touch every point twice"
                        checked={!!cfg.retouch}
                        onChange={(v) => patch({ retouch: v })}
                        description={`Off (normal): one touch per point. On: after the touch the bit lifts and touches again slowly at F${MACH3_RETOUCH_FEED}, and the slow touch is recorded - only needed if a fast touch presses your board down.`}
                      />
                    )}
                    {machine?.postProcessor === 'mach3' && mach3Recorder === 'variables' && cfg.retouch && (
                      <NumberField
                        label="Re-touch lift"
                        unit="mm"
                        min={0.05}
                        max={2}
                        step={0.05}
                        value={cfg.retouchLift ?? MACH3_RETOUCH_LIFT}
                        onChange={(v) => patch({ retouchLift: v })}
                        description={`After the first (fast) touch the bit rises this much and touches again slowly at F${MACH3_RETOUCH_FEED}. Only the slow touch is recorded.`}
                      />
                    )}
                  </div>
                )}
              </div>
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
              <div className="relative rounded-lg border border-slate-800 bg-slate-950 p-2">
                {areaMode === 'custom' && !drewOnce && <DrawAreaHint tool={drawTool} />}
                <ProbePreview
                  scene={scene}
                  cfg={live ?? cfg}
                  tool={drawTool}
                  areaShape={areaMode === 'custom' ? customShape : null}
                  onDrawStart={() => setDrewOnce(true)}
                  className="h-[470px] w-full"
                  onDraw={
                    areaMode === 'custom'
                      ? (shape) => {
                          setDrewOnce(true)
                          // keep the drawing on the material
                          const s = scene.stock
                          const inside = shape.map((q) => ({
                            x: Math.min(s.maxX, Math.max(s.minX, q.x)),
                            y: Math.min(s.maxY, Math.max(s.minY, q.y))
                          }))
                          const xs = inside.map((q) => q.x)
                          const ys = inside.map((q) => q.y)
                          setArea({
                            minX: Math.min(...xs),
                            minY: Math.min(...ys),
                            maxX: Math.max(...xs),
                            maxY: Math.max(...ys)
                          })
                          // a rectangle is just the edges; a circle / polygon also limits the points
                          setCustomShape(drawTool === 'rect' ? null : inside)
                        }
                      : undefined
                  }
                />
              </div>
              {first && (
                <div
                  className="flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-500/5 p-2 text-[11px] leading-snug text-slate-300"
                  data-testid="probe-setup-note"
                >
                  <span className="mt-0.5 size-2.5 shrink-0 rounded-full bg-rose-400" />
                  <span>
                    <b className="text-slate-100">Before running:</b> X0 Y0 is the{' '}
                    <b className="text-slate-100">{originText}</b> (white dot). Move to point 1:{' '}
                    <b className="text-rose-200">{dirText(first.x, 'X', 'right', 'left')}</b> and{' '}
                    <b className="text-rose-200">
                      {dirText(first.y, 'Y', 'away from you (back)', 'towards you (front)')}
                    </b>{' '}
                    of X0 Y0 – that is X{fmt1(first.x)} Y{fmt1(first.y)} on your controller – and set Z zero
                    on the copper there.
                  </span>
                </div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                <Legend color="rgba(217,149,84,0.9)" dashed label="material (stock)" />
                <Legend color="#34d399" label="board outline" />
                <Legend color="#38bdf8" dashed label="probe area" />
                <Legend color="#fb7185" dot label="point 1 – zero Z here" />
                <Legend color="#f87171" label="X+ direction" />
                <Legend color="#4ade80" label="Y+ direction" />
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

function ToolLabel({ icon, text }: { icon: React.ReactNode; text: string }): React.JSX.Element {
  return (
    <span className="flex items-center gap-1 [&_svg]:size-3">
      {icon}
      {text}
    </span>
  )
}
const fmt1 = (v: number): string => String(Math.round(v * 10) / 10)

/** "111 mm to the right (X+)" */
function dirText(v: number, axis: string, plus: string, minus: string): string {
  if (Math.abs(v) < 0.05) return `0 mm in ${axis}`
  return `${fmt1(Math.abs(v))} mm ${v > 0 ? plus : minus} (${axis}${v > 0 ? '+' : '−'})`
}

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
