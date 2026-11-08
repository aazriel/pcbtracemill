import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  Eye,
  Loader2,
  Mountain,
  Save,
  Trash2,
  Upload,
  XCircle
} from 'lucide-react'
import { HELP } from '@core/help'
import { mach3VariablesHeightMap, PROBE_FAILURE_TIPS } from '@core/heightmap'
import { PanelSection } from '@renderer/components/ui/section'
import { Button } from '@renderer/components/ui/button'
import { Segmented, Switch } from '@renderer/components/ui/fields'
import { HelpTip } from '@renderer/components/ui/help'
import { StatusCircle } from '@renderer/components/ui/status'
import { cn } from '@renderer/lib/utils'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { saveMany, type ExportFile } from '@renderer/export/exportFiles'
import { WarpIllustration } from './ProbeIllustrations'
import { TouchOffFigure } from './ProbeFigures'
import { FORMAT_LABELS, importProbeResults } from './importProbe'
import { mapRange, um } from './geometry'
import { useAutoLevel } from './state'

function Step({
  n,
  title,
  done,
  failed,
  disabled,
  children
}: {
  n: number
  title: string
  done: boolean
  failed?: boolean
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-2.5',
        failed ? 'border-rose-500/50 bg-rose-500/5' : 'border-slate-800 bg-slate-900/60',
        disabled && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
            done
              ? 'bg-emerald-500 text-slate-950'
              : failed
                ? 'bg-rose-500 text-white'
                : 'bg-slate-700 text-slate-200'
          )}
        >
          {done ? '✓' : failed ? '!' : n}
        </span>
        <span className="flex-1 text-sm font-medium text-slate-100">{title}</span>
      </div>
      <div className="flex flex-col gap-2 pl-7">{children}</div>
    </li>
  )
}

export function AutoLevelSection({
  files,
  levelling,
  onGenerate,
  title = 'Auto-level (optional)',
  wide = false,
  children
}: {
  files: ExportFile[]
  levelling: boolean
  onGenerate: () => void
  title?: string
  /** In the main area: the three steps side by side. */
  wide?: boolean
  /** Shown above the steps (e.g. the "probe first" advice). */
  children?: React.ReactNode
}): React.JSX.Element {
  const map = useProject((s) => s.heightMap)
  const machine = useProject((s) => s.machine)
  const setHeightMap = useProject((s) => s.setHeightMap)
  const material = useProject((s) => s.material)
  const toast = useUi((s) => s.toast)
  const al = useAutoLevel()
  const [saving, setSaving] = useState(false)
  const r = useMemo(() => (map ? mapRange(map) : null), [map])
  const step1 = al.probeSaved || !!map
  const info = al.importInfo
  const failed = !!info && !info.ok
  const corrected = files.filter((f) => f.levelled)
  const skipped = files.filter((f) => f.levelSkip)
  const on = al.apply && !!map
  // Mach3 G-code-only probing: the heights stay in Mach3, there is nothing to load
  const varsMode = machine?.postProcessor === 'mach3' && al.probeRecorder === 'variables' && !!al.probeCfg
  const isVarsMap = map?.mach3Vars !== undefined

  const saveCorrected = async (): Promise<void> => {
    setSaving(true)
    try {
      const list = corrected.length ? corrected : files
      const res = await saveMany(list.map((f) => ({ name: f.file.name, text: f.text })))
      if (res === null) return
      toast(
        'success',
        typeof res === 'string'
          ? `Saved ${list.length} corrected file(s) to ${res}`
          : `Downloading ${list.length} file(s)…`
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <PanelSection
      title={title}
      className={wide ? 'rounded-xl border border-slate-800 bg-slate-900/40' : undefined}
      status={
        <StatusCircle
          level={map ? 'ok' : failed ? 'error' : 'pending'}
          size={14}
          title={map ? 'Height map loaded' : failed ? 'Probe results rejected' : 'Not used'}
        />
      }
      actions={<HelpTip title={HELP['autolevel.what']?.title}>{HELP['autolevel.what']?.body}</HelpTip>}
    >
      <div className="flex flex-col gap-3" data-testid="autolevel">
        {children}
        <div className={cn('flex gap-3', wide ? 'items-center' : 'flex-col')}>
          <p className={cn('leading-snug text-slate-400', wide ? 'flex-1 text-xs' : 'text-[11px]')}>
            Copper is only 0.035 mm thick and no board is perfectly flat. Measure the real surface once, and
            TraceMill bends the G-code to follow it. Do this <b>before</b> saving the G-code files below.
          </p>
          <div className={cn('rounded-md bg-slate-950/70 p-1.5', wide && 'w-72 shrink-0')}>
            <WarpIllustration />
          </div>
        </div>

        {material?.doubleSided && (
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-xs text-slate-300">
              Probed with side up
              <HelpTip title="Which side is probed?">
                A height map only fits the side that is facing up while probing. TraceMill adjusts only the
                files for that side. To level the other side, flip the board and probe again.
              </HelpTip>
            </span>
            <Segmented
              size="sm"
              value={al.measuredSide}
              onChange={(v) => al.set({ measuredSide: v })}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'bottom', label: 'Bottom' }
              ]}
            />
          </div>
        )}

        <ol className={wide ? 'grid items-start gap-2 lg:grid-cols-3' : 'flex flex-col gap-2'}>
          <Step n={1} title="Make the probe program" done={step1}>
            <p className="text-[11px] text-slate-500">
              The machine touches the board at many points and writes down each height.
            </p>
            <Button size="sm" variant="secondary" data-testid="probe-generate" onClick={onGenerate}>
              <Crosshair /> {al.probeSaved ? 'Make another probe program…' : 'Make probe program…'}
            </Button>
            <p className="flex gap-1 text-[11px] leading-snug text-sky-300/90">
              <AlertTriangle className="mt-px size-3 shrink-0" />
              <span>
                Probe with a <b>sturdy bit</b> – a 1–3 mm flat end mill or a smooth steel pin – not the V-bit.
                If the copper doesn’t conduct somewhere, a thin tip is pushed into the board and breaks.
              </span>
            </p>
          </Step>

          <Step
            n={2}
            title={varsMode || isVarsMap ? 'Run it in Mach3' : 'Run it, then load the results'}
            done={!!map}
            failed={failed && !map}
            disabled={!al.probeSaved && !map}
          >
            {!al.probeSaved && !map ? (
              <p className="text-[11px] text-slate-500" data-testid="probe-run-wait">
                Make the probe program first (step 1). Then this step shows what to do with it.
              </p>
            ) : varsMode && !isVarsMap ? (
              <>
                <p className="text-[11px] text-slate-500">
                  Mach3 keeps every height in its variables – there is no file to load. When the probe program
                  has finished, press:
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="probe-vars-done"
                  onClick={() => al.probeCfg && setHeightMap(mach3VariablesHeightMap(al.probeCfg))}
                >
                  <CheckCircle2 /> Probing done
                </Button>
              </>
            ) : (
              !isVarsMap && (
                <>
                  <p className="text-[11px] text-slate-500">
                    Load the file your controller wrote while probing (.txt, .csv, .log…).
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    data-testid="probe-import"
                    onClick={() => void importProbeResults()}
                  >
                    <Upload /> {map || failed ? 'Load other results…' : 'Load probe results…'}
                  </Button>
                </>
              )
            )}
            {isVarsMap && map && (
              <div
                className="flex flex-col gap-1 rounded-md border border-emerald-600/40 bg-emerald-500/10 p-2 text-[11px] text-emerald-100"
                data-testid="probe-vars-info"
              >
                <div className="flex items-center gap-1 font-semibold text-emerald-200">
                  <CheckCircle2 className="size-3.5 shrink-0" />
                  {map.config.countX} × {map.config.countY} heights kept in Mach3 (
                  {map.source.replace(/^Mach3 variables /, '')})
                </div>
                <span className="leading-snug text-emerald-100/80">
                  The corrected files read them. Mill in the same Mach3 session – if Mach3 was closed, run the
                  probe program again first.
                </span>
              </div>
            )}
            {failed && info && (
              <div
                className="flex flex-col gap-1.5 rounded-md border border-rose-500/50 bg-rose-500/10 p-2 text-[11px] text-rose-100"
                data-testid="probe-import-error"
              >
                <div className="flex items-center gap-1 text-xs font-semibold text-rose-200">
                  <XCircle className="size-3.5 shrink-0" /> {info.fileName} can’t be used
                </div>
                {info.errors.map((e) => (
                  <p key={e} className="leading-snug">
                    {e}
                  </p>
                ))}
                <div className="mt-0.5 font-semibold text-rose-200">What to check, then probe again:</div>
                <ul className="flex list-disc flex-col gap-0.5 pl-4 text-rose-100/90">
                  {PROBE_FAILURE_TIPS.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            {map && r && !isVarsMap && (
              <div className="flex flex-col gap-1.5 rounded-md border border-emerald-600/40 bg-emerald-500/10 p-2 text-[11px] text-emerald-100">
                <div className="flex items-center gap-1 font-semibold text-emerald-200">
                  <CheckCircle2 className="size-3.5 shrink-0" />
                  {map.config.countX} × {map.config.countY} grid · surface varies {um(r.range)}
                </div>
                <span className="truncate text-emerald-100/70" title={map.source}>
                  from {map.source}
                  {info?.ok ? ` · ${FORMAT_LABELS[info.format] ?? info.format}` : ''}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="self-start"
                  data-testid="heightmap-view"
                  onClick={() => al.set({ mapOpen: true })}
                >
                  <Eye /> View height map
                </Button>
              </div>
            )}
            {info && info.warnings.length > 0 && (
              <div className="flex flex-col gap-0.5 text-[11px]">
                {info.warnings.slice(0, 4).map((w, i) => (
                  <span key={i} className="flex gap-1 text-amber-300/90">
                    <AlertTriangle className="mt-px size-3 shrink-0" /> {w}
                  </span>
                ))}
                {info.warnings.length > 4 && (
                  <span className="text-slate-500">…and {info.warnings.length - 4} more notes</span>
                )}
              </div>
            )}
          </Step>

          <Step n={3} title="Save the corrected G-code" done={false} disabled={!map}>
            <div data-testid="apply-heightmap" className="flex flex-col gap-2">
              <Switch
                label="Correct the G-code with the height map"
                checked={on}
                disabled={!map}
                onChange={(v) => al.set({ apply: v })}
                help="Every saved file is rewritten so its Z follows the height map: long moves are split into 1 mm pieces and each piece gets the measured height added. The original design is not changed."
              />
              <Switch
                label="Find Z zero at point 1 for each bit"
                checked={on && al.touchOff}
                disabled={!on}
                onChange={(v) => al.set({ touchOff: v })}
                helpWide
                help={
                  <>
                    Zeroing a V-bit exactly on 0.035 mm copper by hand is very hard. With this on, each
                    corrected file stops before every bit: you set Z zero <b>roughly</b> (a sheet of paper is
                    enough) and clip the probe to the bit. The program then touches the copper at point 1 very
                    slowly (F2, so a 0.1 mm V-bit tip survives) at the same point as the height map and sets
                    the exact Z0 there. Then it stops so you can remove the clip before the spindle starts.
                    <div className="mt-2">
                      <TouchOffFigure />
                    </div>
                  </>
                }
              />
              {on && al.touchOff && (
                <p className="text-[11px] leading-snug text-slate-400">
                  Before each bit: set Z roughly (paper), clip the probe on, press Start – the program finds
                  the copper itself, then asks you to remove the clip.
                </p>
              )}
            </div>
            {on && (
              <div className="flex flex-col gap-0.5 text-[11px]">
                <span className="flex items-center gap-1 text-emerald-300">
                  <Mountain className="size-3" />
                  {levelling
                    ? 'Correcting files…'
                    : `${corrected.length} of ${files.length} file${files.length === 1 ? '' : 's'} corrected`}
                </span>
                {skipped.map((f) => (
                  <span key={f.file.name} className="truncate text-amber-300/90" title={f.levelSkip ?? ''}>
                    not corrected: {f.file.name} – {f.levelSkip}
                  </span>
                ))}
              </div>
            )}
            <Button
              variant="success"
              data-testid="autolevel-save"
              disabled={!on || levelling || saving || !corrected.length}
              onClick={() => void saveCorrected()}
            >
              {levelling || saving ? <Loader2 className="animate-spin" /> : <Save />}
              Save {corrected.length || ''} corrected G-code file{corrected.length === 1 ? '' : 's'}
            </Button>
          </Step>
        </ol>

        {map && (
          <Button
            size="sm"
            variant="ghost"
            className="self-start text-rose-300 hover:text-rose-200"
            onClick={() => {
              setHeightMap(null)
              al.set({ apply: false, importInfo: null, mapOpen: false })
            }}
          >
            <Trash2 /> Remove height map
          </Button>
        )}
      </div>
    </PanelSection>
  )
}
