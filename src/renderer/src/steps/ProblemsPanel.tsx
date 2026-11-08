/**
 * Places a step cannot machine as designed (copper features closer than the tool can fit, copper the
 * clearing tool cannot reach), listed over the Manufacture board view. Each can be zoomed to or
 * ignored; isolation steps can also skip every gap smaller than a size the user picks.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Crosshair, EyeOff, RotateCcw, X } from 'lucide-react'
import type { ToolpathProblem } from '@core/model/types'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { ignoreProblem, restoreProblems, setIgnoreGapsBelow, showProblems } from '@renderer/store/controller'
import { Button } from '@renderer/components/ui/button'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'

const fmt = (v: number, d = 2): string => String(Math.round(v * 10 ** d) / 10 ** d)

export function problemLabel(p: ToolpathProblem): string {
  if (p.kind === 'narrow-gap')
    return `gap ${fmt(p.gap ?? 0, 3)} mm${p.needed ? ` (needs ${fmt(p.needed, 3)})` : ''}`
  return `${fmt(p.area ?? 0, 3)} mm² left`
}

export function ProblemsPanel(): React.JSX.Element | null {
  const cam = useUi((s) => s.cam)
  const viewSide = useUi((s) => s.viewSide)
  const stepId = useUi((s) => s.problemStepId)
  const focus = useUi((s) => s.problemFocus)
  const set = useUi((s) => s.set)
  const steps = useProject((s) => s.steps)

  const withProblems = (cam?.toolpaths ?? []).filter(
    (t) => t.problems?.length && steps.find((s) => s.id === t.stepId)?.enabled
  )
  const step = steps.find((s) => s.id === stepId)
  const toolpath = withProblems.find((t) => t.stepId === stepId)
  const problems = toolpath?.problems ?? []
  const ignoredCount = step?.ignoredProblems?.length ?? 0

  const [below, setBelow] = useState('')
  useEffect(() => {
    const v = step?.params.isolation.ignoreGapsBelow ?? 0
    setBelow(v > 0 ? String(v) : '')
  }, [step?.id, step?.params.isolation.ignoreGapsBelow])

  // Collapsed: a small pill when some step on this side has problem places.
  if (!step || (!problems.length && !ignoredCount)) {
    const here = withProblems.filter((t) => t.side === viewSide)
    if (!here.length) return null
    const n = here.reduce((a, t) => a + (t.problems?.length ?? 0), 0)
    return (
      <button
        type="button"
        onClick={() => showProblems(here[0].stepId)}
        className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-950/85 px-3 py-1.5 text-xs font-medium text-amber-100 shadow-lg hover:bg-amber-900/90"
        data-testid="problems-pill"
      >
        <AlertTriangle className="size-3.5 text-amber-400" />
        {n} place{n === 1 ? '' : 's'} the tool cannot reach — show
      </button>
    )
  }

  const isIsolation = step.kind === 'isolate'
  const commitBelow = (): void => {
    const v = Number(below)
    setIgnoreGapsBelow(step.id, below.trim() === '' || !Number.isFinite(v) ? 0 : v)
  }

  return (
    <div
      className="absolute bottom-3 right-3 z-10 flex max-h-[min(60vh,460px)] w-[330px] flex-col rounded-xl border border-amber-500/40 bg-slate-900 shadow-2xl"
      data-testid="problems-panel"
    >
      <header className="flex items-start gap-2 border-b border-slate-800 px-3 py-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-slate-100">{step.name}</div>
          <div className="text-[11px] text-slate-400">
            {problems.length
              ? isIsolation
                ? `${problems.length} place${problems.length === 1 ? '' : 's'} where copper is closer than the tool can fit. They are left unisolated.`
                : `${problems.length} area${problems.length === 1 ? '' : 's'} the tool cannot reach. They stay uncleared.`
              : 'No places left to report.'}
          </div>
        </div>
        <button
          type="button"
          className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          onClick={() => set({ problemStepId: null, problemFocus: null })}
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </header>

      <ol className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {problems.map((p, i) => (
          <li
            key={p.id}
            className={cn(
              'flex items-center gap-2 rounded-md px-1.5 py-1 text-xs',
              focus === p.id ? 'bg-amber-500/15 ring-1 ring-amber-500/50' : 'hover:bg-slate-800/70'
            )}
            data-testid="problem-row"
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-[10px] font-bold text-rose-200">
              {i + 1}
            </span>
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-slate-200"
              onClick={() => set({ problemFocus: p.id })}
            >
              {problemLabel(p)}
            </button>
            <Tooltip content="Zoom the view to this place">
              <Button
                size="iconSm"
                variant="ghost"
                onClick={() => set({ problemFocus: p.id })}
                aria-label="Zoom to place"
              >
                <Crosshair />
              </Button>
            </Tooltip>
            <Tooltip content="Ignore this place: it stays as it is and is no longer reported">
              <Button
                size="iconSm"
                variant="ghost"
                onClick={() => ignoreProblem(step.id, p.id)}
                aria-label="Ignore place"
                data-testid="problem-ignore"
              >
                <EyeOff />
              </Button>
            </Tooltip>
          </li>
        ))}
      </ol>

      <footer className="flex flex-col gap-2 border-t border-slate-800 px-3 py-2 text-[11px] text-slate-400">
        {isIsolation && (
          <label className="flex items-center gap-1.5">
            <span className="flex-1">Don’t report gaps smaller than</span>
            <input
              type="number"
              min={0}
              step={0.01}
              placeholder="off"
              value={below}
              onChange={(e) => setBelow(e.target.value)}
              onBlur={commitBelow}
              onKeyDown={(e) => e.key === 'Enter' && commitBelow()}
              className="h-7 w-16 rounded border border-slate-700 bg-slate-950 px-1.5 text-right text-xs text-slate-100 outline-none focus:border-sky-500"
              data-testid="problem-ignore-below"
            />
            mm
          </label>
        )}
        <div className="flex items-center gap-2">
          {problems.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                ignoreProblem(
                  step.id,
                  problems.map((p) => p.id)
                )
              }
            >
              <EyeOff /> Ignore all
            </Button>
          )}
          {ignoredCount > 0 && (
            <Button size="sm" variant="ghost" onClick={() => restoreProblems(step.id)}>
              <RotateCcw /> Report {ignoredCount} ignored again
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}
