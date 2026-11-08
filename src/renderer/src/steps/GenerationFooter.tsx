/** Bottom of the Manufacture panel: auto-regenerate, "Generate G-code", status and job totals. */
import { useMemo } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Cog,
  Loader2,
  Route as RouteIcon,
  TriangleAlert
} from 'lucide-react'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { canEnterStage, regenerate, scheduleRegenerate } from '@renderer/store/controller'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/fields'
import { formatDuration } from '@renderer/lib/utils'
import { stepStatus, useValidationCtx } from './stepUtils'

export function GenerationFooter(): React.JSX.Element {
  const steps = useProject((s) => s.steps)
  const auto = useProject((s) => s.settings.autoRegenerate)
  const setSettings = useProject((s) => s.setSettings)
  const cam = useUi((s) => s.cam)
  const stale = useUi((s) => s.camStale)
  const generating = useUi((s) => s.generating)
  const camError = useUi((s) => s.camError)
  const setUi = useUi((s) => s.set)
  const ctx = useValidationCtx()

  const { errorSteps, warnSteps, enabled } = useMemo(() => {
    const en = steps.filter((s) => s.enabled)
    let e = 0
    let w = 0
    for (const s of en) {
      const st = stepStatus(
        s,
        ctx,
        cam?.validations.find((v) => v.stepId === s.id)
      )
      if (st.level === 'error') e++
      else if (st.level === 'warning') w++
    }
    return { errorSteps: e, warnSteps: w, enabled: en.length }
  }, [steps, ctx, cam])

  const totals = useMemo(() => {
    const ids = new Set(steps.filter((s) => s.enabled).map((s) => s.id))
    const tps = cam?.toolpaths.filter((t) => ids.has(t.stepId)) ?? []
    return {
      seconds: tps.reduce((a, t) => a + t.stats.estimatedSeconds, 0),
      cut: tps.reduce((a, t) => a + t.stats.cutLength, 0),
      count: tps.length
    }
  }, [cam, steps])

  const canGenerate = enabled > 0 && errorSteps === 0 && !generating
  const hasFiles = !!cam?.files.length
  const canContinue = canEnterStage('simulation') && hasFiles

  let statusLine: React.ReactNode
  if (generating)
    statusLine = (
      <span className="flex items-center gap-1.5 text-sky-300">
        <Loader2 className="size-3.5 animate-spin" /> Generating toolpaths and G-code…
      </span>
    )
  else if (camError)
    statusLine = (
      <span className="flex items-center gap-1.5 text-rose-400">
        <TriangleAlert className="size-3.5" /> Generation failed: {camError}
      </span>
    )
  else if (!steps.length)
    statusLine = <span className="text-slate-500">Add steps (or use the Recipe) to begin.</span>
  else if (errorSteps)
    statusLine = (
      <span className="flex items-center gap-1.5 text-rose-400">
        <TriangleAlert className="size-3.5" /> Fix {errorSteps} step{errorSteps > 1 ? 's' : ''} with errors
        (red) first.
      </span>
    )
  else if (stale || !cam)
    statusLine = (
      <span className="flex items-center gap-1.5 text-amber-400">
        <TriangleAlert className="size-3.5" /> Changes not generated yet.
      </span>
    )
  else
    statusLine = (
      <span className="flex items-center gap-1.5 text-emerald-400">
        <CheckCircle2 className="size-3.5" /> Up to date
        {warnSteps ? <span className="text-amber-400">· {warnSteps} with warnings</span> : null}
      </span>
    )

  return (
    <div
      className="flex flex-col gap-2 border-t border-slate-800 bg-slate-900/80 p-3"
      data-testid="generation-footer"
    >
      <div data-testid="auto-regenerate">
        <Switch
          label="Re-generate automatically"
          checked={auto}
          onChange={(v) => {
            setSettings({ autoRegenerate: v })
            if (v && useUi.getState().camStale) scheduleRegenerate()
          }}
          description="Updates the G-code after every change. Turn off while you make many changes, then press Generate."
          help="When on, PCB TraceMill recalculates the toolpaths and G-code a moment after each change you make. When off, nothing is recalculated until you press “Generate G-code”."
        />
      </div>
      <div className="text-[11px]" data-testid="generation-status">
        {statusLine}
      </div>
      {totals.count > 0 && (
        <div
          className="flex items-center gap-3 font-mono text-[11px] text-slate-400"
          data-testid="job-totals"
        >
          <span className="flex items-center gap-1" title="Estimated total machine time">
            <Clock className="size-3" /> {formatDuration(totals.seconds)}
          </span>
          <span className="flex items-center gap-1" title="Total cutting distance">
            <RouteIcon className="size-3" />
            {totals.cut >= 1000 ? `${(totals.cut / 1000).toFixed(2)} m` : `${totals.cut.toFixed(0)} mm`} cut
          </span>
          <span>{totals.count} toolpaths</span>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant={stale && canGenerate ? 'default' : 'secondary'}
          className="flex-1"
          disabled={!canGenerate}
          onClick={() => void regenerate()}
          data-testid="generate"
          title={errorSteps ? 'Fix the steps with errors first' : 'Calculate toolpaths and G-code now'}
        >
          {generating ? <Loader2 className="animate-spin" /> : <Cog />} Generate G-code
        </Button>
        <Button
          variant="success"
          disabled={!canContinue}
          onClick={() => setUi({ stage: 'simulation' })}
          data-testid="continue-simulation"
          title="Watch the job being milled in a 3D simulation"
        >
          Simulation <ArrowRight />
        </Button>
      </div>
    </div>
  )
}
