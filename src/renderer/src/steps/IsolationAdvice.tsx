/**
 * Isolation settings from the measured copper spacing (D-031): the advice box of the isolation
 * parameters and the helpers that apply the recommended values when a tool is chosen.
 */
import { useEffect, useMemo } from 'react'
import { Clock, Info, Ruler } from 'lucide-react'
import type { CamStep, ClearanceInfo, Material, Tool } from '@core/model/types'
import {
  EXTRA_PASS_NOTICE_S,
  combinedClearance,
  planIsolation,
  roughDuration,
  type IsolationPlan
} from '@core/cam'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { stepClearance } from '@renderer/store/controller'
import { Button } from '@renderer/components/ui/button'
import { useStepEditor } from './editorStore'

/** Measured spacing of these layers: undefined while it is being measured. */
export function useStepClearance(layerIds: string[]): ClearanceInfo | null | undefined {
  const layers = useProject((s) => s.layers)
  const all = useUi((s) => s.clearance)
  const copper = useMemo(
    () => layers.filter((l) => layerIds.includes(l.id) && l.type === 'copper').map((l) => l.id),
    [layers, layerIds]
  )
  useEffect(() => void stepClearance(copper), [copper])
  if (!copper.length) return null
  if (copper.some((id) => !(id in all))) return undefined
  return combinedClearance(copper.map((id) => all[id]))
}

/** The draft with the plan's passes, overlap, extra clearance and depth. */
export function withPlan(draft: CamStep, plan: IsolationPlan): CamStep {
  return {
    ...draft,
    cutDepth: plan.cutDepth,
    params: {
      ...draft.params,
      isolation: {
        ...draft.params.isolation,
        passes: plan.passes,
        overlap: plan.overlap,
        extraClearance: plan.extraClearance,
        smart: plan.smart,
        smartMaxGap: plan.smartMaxGap
      }
    }
  }
}

const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6

/** Does the draft use the plan's values? */
export function followsPlan(draft: CamStep, plan: IsolationPlan): boolean {
  const ip = draft.params.isolation
  return (
    ip.passes === plan.passes &&
    !!ip.smart === plan.smart &&
    same(ip.extraClearance, plan.extraClearance) &&
    same(draft.cutDepth, plan.cutDepth) &&
    (plan.passes === 1 || same(ip.overlap, plan.overlap))
  )
}

/** Applies the recommended isolation values for `tool` and tells the user (tool just chosen). */
export async function applyIsolationPlan(
  draft: CamStep,
  tool: Tool,
  material: Material | null,
  update: (fn: (d: CamStep) => CamStep) => void
): Promise<void> {
  const info = await stepClearance(draft.layerIds)
  const plan = planIsolation(tool, info, material ?? { copperThickness: 0.035 })
  update((d) => (d.toolId === tool.id ? withPlan(d, plan) : d))
  useUi
    .getState()
    .toast('info', `Isolation settings set for this bit. ${plan.notes.join(' ')} You can change them.`)
}

export function IsolationAdvice({
  draft,
  update,
  tool
}: {
  draft: CamStep
  update: (fn: (d: CamStep) => CamStep) => void
  tool: Tool | undefined
}): React.JSX.Element | null {
  const material = useProject((s) => s.material)
  const live = useStepEditor((s) => s.previewSeconds)
  const saved = useProject((s) => s.steps.find((x) => x.id === draft.id))
  const cam = useUi((s) => s.cam)
  const info = useStepClearance(draft.layerIds)
  if (!tool) return null
  if (info === undefined)
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-slate-400" data-testid="isolation-advice">
        <Ruler className="size-3.5 animate-pulse text-sky-400" /> Measuring the gaps between the copper…
      </p>
    )
  // one pass takes: measured from the last generated toolpath of this step when there is one
  const tp = cam?.toolpaths.find((t) => t.stepId === draft.id)
  const tpPasses = saved?.params.isolation.passes ?? 0
  const measuredPass =
    tp && saved && saved.toolId === draft.toolId && tpPasses > 0
      ? tp.stats.estimatedSeconds / tpPasses
      : undefined
  const plan = planIsolation(tool, info, material ?? { copperThickness: 0.035 }, measuredPass)
  const passes = draft.params.isolation.passes
  const extraPasses = Math.max(0, passes - plan.passes)
  // the extra passes cost: the live time of the edited step against the generated one at the
  // recommended passes (outer passes merge in narrow places, so they are shorter than the first)

  const base =
    tp && saved && saved.toolId === draft.toolId && tpPasses === plan.passes
      ? tp.stats.estimatedSeconds
      : null
  const liveSec = live && live.key === JSON.stringify(draft) ? live.seconds : null
  const added =
    extraPasses === 0
      ? 0
      : base !== null && liveSec !== null
        ? Math.max(0, liveSec - base)
        : plan.passSeconds !== null
          ? extraPasses * plan.passSeconds
          : 0
  const follows = followsPlan(draft, plan)
  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/5 p-2 text-[11px] leading-snug text-slate-300"
      data-testid="isolation-advice"
    >
      <div className="flex gap-1.5">
        <Info className="mt-px size-3.5 shrink-0 text-sky-400" />
        <div className="flex flex-col gap-1">
          {info?.clearance == null ? (
            <span>All copper gaps on this layer are 1.5 mm or wider – easy to isolate.</span>
          ) : (
            plan.notes.map((n) => <span key={n}>{n}</span>)
          )}
          {info && info.tiny > 0 && (
            <span className="text-slate-400">
              {info.tiny} place{info.tiny === 1 ? ' is' : 's are'} under 0.1 mm – copper meant to touch (or
              slivers); no bit can cut there.
            </span>
          )}
        </div>
      </div>
      {added >= EXTRA_PASS_NOTICE_S && (
        <div className="flex gap-1.5 text-amber-200" data-testid="isolation-pass-time">
          <Clock className="mt-px size-3.5 shrink-0" />
          <span>
            {extraPasses === 1 ? 'The extra pass adds' : `The ${extraPasses} extra passes add`} about{' '}
            <b>{roughDuration(added)}</b> of machine time.
          </span>
        </div>
      )}
      {!follows && (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          data-testid="isolation-apply-plan"
          onClick={() => update((d) => withPlan(d, plan))}
        >
          Use the recommended settings (smart clearance, {plan.cutDepth} mm deep, {plan.passes} pass
          {plan.passes > 1 ? 'es' : ''} in open areas)
        </Button>
      )}
    </div>
  )
}

/**
 * The narrowest copper gap the job has to isolate: the copper layers of the enabled isolation
 * steps (all copper layers when there is none). undefined while measuring, null = all wide.
 */
export function useJobClearance(): ClearanceInfo | null | undefined {
  const steps = useProject((s) => s.steps)
  const layers = useProject((s) => s.layers)
  const ids = useMemo(() => {
    const iso = steps.filter((s) => s.enabled && s.kind === 'isolate').flatMap((s) => s.layerIds)
    return iso.length ? [...new Set(iso)] : layers.filter((l) => l.type === 'copper').map((l) => l.id)
  }, [steps, layers])
  return useStepClearance(ids)
}
