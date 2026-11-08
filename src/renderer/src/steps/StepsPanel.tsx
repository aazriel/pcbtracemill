/**
 * STEPS panel of the Manufacture stage. The job reads top to bottom as an outline:
 *  - one collapsible group per board side (Top side / Bottom side), with a thin "flip" spacer between;
 *  - runs of the same kind of step (e.g. six drill sizes) fold into one row that opens on click;
 *  - every step is a compact two-line row; clicking it selects it and shows its details and actions.
 * Drag rows to reorder; "Recipe" and "Add step" sit below the list.
 */
import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Ban,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  ListX,
  GripVertical,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  Wand2
} from 'lucide-react'
import type { CamStep, StepKind } from '@core/model/types'
import { STEP_KIND_INFO, type StepValidationContext } from '@core/cam'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { applyRecipe, showProblems } from '@renderer/store/controller'
import { PanelSection } from '@renderer/components/ui/section'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { StatusCircle, type StatusLevel } from '@renderer/components/ui/status'
import { HelpTip } from '@renderer/components/ui/help'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { cn, formatDuration, uid } from '@renderer/lib/utils'
import { fmtLength, useUnits } from '@renderer/lib/units'
import { useStepEditor } from './editorStore'
import { IssueList } from './IssueList'
import {
  help,
  layerLabel,
  stepColor,
  stepIcon,
  stepStatus,
  useValidationCtx,
  type StepStatus
} from './stepUtils'

// ───────────────────────────────────────── outline model

interface Row {
  step: CamStep
  index: number
}
interface KindGroup {
  type: 'group'
  key: string
  kind: StepKind
  rows: Row[]
}
type Item = { type: 'step'; row: Row } | KindGroup
interface Phase {
  key: string
  side: 'top' | 'bottom'
  items: Item[]
  rows: Row[]
}

/** Splits the steps into side phases, and folds consecutive steps of the same kind into groups. */
function buildOutline(steps: CamStep[]): Phase[] {
  const phases: Phase[] = []
  steps.forEach((step, index) => {
    let ph = phases[phases.length - 1]
    if (!ph || ph.side !== step.side) {
      ph = { key: `phase-${phases.length}-${step.side}`, side: step.side, items: [], rows: [] }
      phases.push(ph)
    }
    const row = { step, index }
    ph.rows.push(row)
    const last = ph.items[ph.items.length - 1]
    const prevStep = last?.type === 'step' ? last.row.step : last?.type === 'group' ? last.rows[0].step : null
    if (last && prevStep && prevStep.kind === step.kind) {
      if (last.type === 'group') last.rows.push(row)
      else
        ph.items[ph.items.length - 1] = {
          type: 'group',
          key: `group-${last.row.step.id}`,
          kind: step.kind,
          rows: [last.row, row]
        }
    } else ph.items.push({ type: 'step', row })
  })
  return phases
}

const RANK: Record<StatusLevel, number> = { pending: 0, ok: 1, warning: 2, error: 3 }
function worst(levels: StatusLevel[]): StatusLevel {
  return levels.reduce<StatusLevel>((w, l) => (RANK[l] > RANK[w] ? l : w), levels.length ? 'ok' : 'pending')
}

/** Status of every step (live validation + results of the last run). */
function useStatuses(steps: CamStep[], ctx: StepValidationContext | null): Map<string, StepStatus> {
  const cam = useUi((s) => s.cam)
  return useMemo(() => {
    const m = new Map<string, StepStatus>()
    for (const s of steps)
      m.set(
        s.id,
        stepStatus(
          s,
          ctx,
          cam?.validations.find((v) => v.stepId === s.id)
        )
      )
    return m
  }, [steps, ctx, cam])
}

const SIDE_LABEL = { top: 'Top side', bottom: 'Bottom side' }

// ───────────────────────────────────────── panel

export function StepsPanel(): React.JSX.Element {
  const steps = useProject((s) => s.steps)
  const setSteps = useProject((s) => s.setSteps)
  const moveStep = useProject((s) => s.moveStep)
  const upsertStep = useProject((s) => s.upsertStep)
  const material = useProject((s) => s.material)
  const cam = useUi((s) => s.cam)
  const selectedId = useUi((s) => s.selectedStepId)
  const ctx = useValidationCtx()
  const openPicker = useStepEditor((s) => s.openPicker)
  const [confirmRecipe, setConfirmRecipe] = useState(false)
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null)
  /** Open/closed state per phase / group key (groups start closed, phases open). */
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const outline = useMemo(() => buildOutline(steps), [steps])
  const statuses = useStatuses(steps, ctx)
  const levelOf = (s: CamStep): StatusLevel =>
    s.enabled ? (statuses.get(s.id)?.level ?? 'pending') : 'pending'
  const seconds = (rows: Row[]): number =>
    rows.reduce(
      (t, r) =>
        t +
        (r.step.enabled
          ? (cam?.toolpaths.find((p) => p.stepId === r.step.id)?.stats.estimatedSeconds ?? 0)
          : 0),
      0
    )

  const runRecipe = (): void => {
    if (steps.length) setConfirmRecipe(true)
    else void applyRecipe()
  }

  const duplicate = (step: CamStep): void => {
    const i = steps.findIndex((s) => s.id === step.id)
    const copy: CamStep = { ...structuredClone(step), id: uid('S'), name: `${step.name} (copy)` }
    const next = [...steps]
    next.splice(i + 1, 0, copy)
    setSteps(next)
    useUi.getState().set({ selectedStepId: copy.id })
  }

  const onDrop = (target: number): void => {
    if (!drag) return
    const from = steps.findIndex((s) => s.id === drag.id)
    if (from >= 0) {
      const to = target > from ? target - 1 : target
      if (to !== from) moveStep(drag.id, to)
    }
    setDrag(null)
  }

  const [confirmClear, setConfirmClear] = useState(false)
  const setAll = (value: boolean): void => {
    const next: Record<string, boolean> = {}
    for (const ph of outline) {
      next[ph.key] = value || false
      for (const it of ph.items) if (it.type === 'group') next[it.key] = value
    }
    // "Collapse all" keeps the side groups open but folds every run of steps; a second click folds the sides too
    if (!value && Object.entries(open).every(([k, v]) => !k.startsWith('group-') || !v))
      for (const ph of outline) next[ph.key] = false
    else if (!value) for (const ph of outline) next[ph.key] = true
    setOpen(next)
  }
  const removeSteps = (ids: string[]): void => {
    const gone = new Set(ids)
    setSteps(steps.filter((s) => !gone.has(s.id)))
    if (selectedId && gone.has(selectedId)) useUi.getState().set({ selectedStepId: null })
  }

  const isOpen = (key: string, def: boolean): boolean => open[key] ?? def
  const toggle = (key: string, def: boolean): void => setOpen((o) => ({ ...o, [key]: !(o[key] ?? def) }))

  const renderRow = (r: Row, nested: boolean): React.JSX.Element => (
    <div
      key={r.step.id}
      onDragOver={(e) => {
        if (!drag) return
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        const over = e.clientY < rect.top + rect.height / 2 ? r.index : r.index + 1
        if (over !== drag.over) setDrag({ ...drag, over })
      }}
    >
      {drag && drag.over === r.index && <DropLine />}
      <StepRow
        step={r.step}
        index={r.index}
        count={steps.length}
        status={statuses.get(r.step.id)!}
        nested={nested}
        dragging={drag?.id === r.step.id}
        onDragStart={() => setDrag({ id: r.step.id, over: null })}
        onDragEnd={() => setDrag(null)}
        onMove={(to) => moveStep(r.step.id, to)}
        onDuplicate={() => duplicate(r.step)}
      />
      {drag && drag.over === r.index + 1 && r.index === steps.length - 1 && <DropLine />}
    </div>
  )

  return (
    <PanelSection
      title="Steps"
      actions={
        steps.length > 0 && (
          <>
            <HeaderBtn label="Expand all" onClick={() => setAll(true)} testId="steps-expand-all">
              <ChevronsUpDown />
            </HeaderBtn>
            <HeaderBtn
              label="Collapse all (click again to fold the sides too)"
              onClick={() => setAll(false)}
              testId="steps-collapse-all"
            >
              <ChevronsDownUp />
            </HeaderBtn>
            <HeaderBtn
              label="Remove all steps…"
              onClick={() => setConfirmClear(true)}
              testId="steps-remove-all"
              danger
            >
              <ListX />
            </HeaderBtn>
          </>
        )
      }
    >
      {steps.length === 0 && (
        <div className="mb-2 rounded-lg border border-dashed border-slate-700 p-3 text-center text-xs leading-relaxed text-slate-400">
          <Wand2 className="mx-auto mb-1.5 size-6 text-sky-400" />
          The milling operations, run from top to bottom. Click <b className="text-slate-200">Recipe</b> and
          PCB TraceMill plans the job from your layers (recommended), or{' '}
          <b className="text-slate-200">Add step</b> to build it yourself.
        </div>
      )}
      {steps.length > 0 && (
        <div
          className="flex flex-col"
          data-testid="steps-outline"
          onDragOver={(e) => drag && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            onDrop(drag?.over ?? steps.length)
          }}
        >
          {outline.map((ph, pi) => {
            const phOpen = isOpen(ph.key, true)
            const phLevel = worst(ph.rows.map((r) => levelOf(r.step)))
            const t = seconds(ph.rows)
            return (
              <div key={ph.key}>
                {pi > 0 && <FlipSpacer axis={material?.alignment.axis ?? 'x'} toSide={ph.side} />}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(ph.key, true)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(ph.key, true)}
                  className="group/ph mb-1 flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-slate-800/50"
                  data-testid="steps-phase"
                  aria-expanded={phOpen}
                >
                  <ChevronRight
                    className={cn(
                      'size-3.5 shrink-0 text-slate-500 transition-transform',
                      phOpen && 'rotate-90'
                    )}
                  />
                  <span
                    className={cn(
                      'rounded px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide',
                      ph.side === 'top' ? 'bg-sky-500/15 text-sky-300' : 'bg-violet-500/20 text-violet-200'
                    )}
                  >
                    {SIDE_LABEL[ph.side]}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {ph.rows.length} step{ph.rows.length === 1 ? '' : 's'}
                    {t > 0 && ` · ${formatDuration(t)}`}
                  </span>
                  <span className="flex-1" />
                  <RemoveBtn
                    what={`the ${ph.rows.length} ${SIDE_LABEL[ph.side].toLowerCase()} step${ph.rows.length === 1 ? '' : 's'}`}
                    onRemove={() => removeSteps(ph.rows.map((r) => r.step.id))}
                    testId="steps-phase-remove"
                  />
                  <StatusCircle level={phLevel} size={14} />
                </div>
                {phOpen && (
                  <div className="flex flex-col gap-1 pb-1">
                    {ph.items.map((it) => {
                      if (it.type === 'step') return renderRow(it.row, false)
                      const hasSel = it.rows.some((r) => r.step.id === selectedId)
                      const gOpen = isOpen(it.key, hasSel)
                      return (
                        <div key={it.key} className="flex flex-col gap-1">
                          <GroupRow
                            group={it}
                            open={gOpen}
                            level={worst(it.rows.map((r) => levelOf(r.step)))}
                            seconds={seconds(it.rows)}
                            onToggle={() => toggle(it.key, hasSel)}
                            onEnable={(on) => it.rows.forEach((r) => upsertStep({ ...r.step, enabled: on }))}
                            onRemove={() => removeSteps(it.rows.map((r) => r.step.id))}
                          />
                          {gOpen && (
                            <div className="ml-2.5 flex flex-col gap-1 border-l border-slate-700/80 pl-1.5">
                              {it.rows.map((r) => renderRow(r, true))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Tooltip content="Let PCB TraceMill plan the whole job for you: it picks the steps, their order and the tools from your layers.">
          <Button variant="secondary" className="h-9 text-sm" onClick={runRecipe} data-testid="recipe">
            <Wand2 /> Recipe
          </Button>
        </Tooltip>
        <Button className="h-9 text-sm" onClick={openPicker} data-testid="add-step">
          <Plus /> Add step
        </Button>
      </div>
      <Dialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Remove all steps?"
        description={`All ${steps.length} steps are removed. You can bring them back with Undo (Ctrl+Z), or plan the job again with Recipe.`}
        className="w-[min(92vw,460px)]"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Keep them
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmClear(false)
                removeSteps(steps.map((s) => s.id))
              }}
              data-testid="steps-remove-all-confirm"
            >
              <ListX /> Remove all
            </Button>
          </>
        }
      >
        <span />
      </Dialog>
      <Dialog
        open={confirmRecipe}
        onOpenChange={setConfirmRecipe}
        title="Replace your steps with the Recipe?"
        description="The Recipe plans a complete job from your layers. Your current steps will be replaced (you can undo with Ctrl+Z)."
        className="w-[min(92vw,480px)]"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRecipe(false)}>
              Keep my steps
            </Button>
            <Button
              onClick={() => {
                setConfirmRecipe(false)
                void applyRecipe()
              }}
              data-testid="recipe-confirm"
            >
              <Wand2 /> Replace with Recipe
            </Button>
          </>
        }
      >
        <p className="text-xs text-slate-400">
          It adds isolation for each copper side, drilling grouped by drill size, milling for big holes,
          alignment pins for double-sided boards and the cutout at the end.
        </p>
      </Dialog>
    </PanelSection>
  )
}

function DropLine(): React.JSX.Element {
  return <div className="my-0.5 h-0.5 rounded bg-sky-400" />
}

/** Thin divider where the board is turned over; the details are in its (?). */
function FlipSpacer({ axis, toSide }: { axis: 'x' | 'y'; toSide: 'top' | 'bottom' }): React.JSX.Element {
  return (
    <div
      className="my-1.5 flex items-center gap-2 text-[10.5px] font-medium text-violet-300"
      data-testid="flip-marker"
    >
      <span className="h-px flex-1 bg-violet-500/40" />
      <RefreshCcw className="size-3.5" />
      Flip the board · {toSide} side up
      <HelpTip title="Flipping the board">
        Turn the board over around the line through the two pins (
        {axis === 'x' ? 'front edge goes to the back' : 'left edge goes to the right'}), push it back onto the
        alignment pins and re-check Z zero. {help('concept.flip')}
      </HelpTip>
      <span className="h-px flex-1 bg-violet-500/40" />
    </div>
  )
}

/** Folded run of steps of one kind (e.g. "Drill holes · 6 steps · 0.4–1.4 mm"). */
function GroupRow({
  group,
  open,
  level,
  seconds,
  onToggle,
  onEnable,
  onRemove
}: {
  group: KindGroup
  open: boolean
  level: StatusLevel
  seconds: number
  onToggle: () => void
  onEnable: (on: boolean) => void
  onRemove: () => void
}): React.JSX.Element {
  const Icon = stepIcon(group.kind)
  const steps = group.rows.map((r) => r.step)
  const on = steps.filter((s) => s.enabled).length
  const first = group.rows[0].index
  const last = group.rows[group.rows.length - 1].index
  let detail = ''
  if (group.kind === 'drill' || group.kind === 'holeMill') {
    const ps = steps.map((s) => (s.kind === 'drill' ? s.params.drill : s.params.holeMill))
    const r = (v: number): number => Math.round(v * 100) / 100
    const lo = r(Math.min(...ps.map((p) => p.minDiameter)))
    const hi = r(Math.max(...ps.map((p) => Math.min(p.maxDiameter, 50))))
    detail = lo === hi ? `${lo} mm` : `${lo}–${hi} mm`
  }
  return (
    <div
      className={cn(
        'group/g flex cursor-pointer items-center gap-1.5 rounded-lg border bg-slate-900 px-2 py-1.5 transition-colors hover:border-slate-500',
        level === 'error'
          ? 'border-rose-500/60'
          : level === 'warning'
            ? 'border-amber-500/50'
            : 'border-slate-700'
      )}
      onClick={onToggle}
      data-testid="step-group"
      aria-expanded={open}
    >
      <ChevronRight
        className={cn('size-3.5 shrink-0 text-slate-400 transition-transform', open && 'rotate-90')}
      />
      <Tooltip
        content={
          on === steps.length ? 'Untick to skip all of these steps' : 'Tick to include all of these steps'
        }
      >
        <input
          type="checkbox"
          checked={on === steps.length}
          ref={(el) => {
            if (el) el.indeterminate = on > 0 && on < steps.length
          }}
          onChange={(e) => onEnable(e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          className="size-3.5 cursor-pointer accent-sky-500"
          aria-label="Include these steps in the G-code"
        />
      </Tooltip>
      <span className="flex h-5 shrink-0 items-center rounded-full bg-slate-800 px-1.5 text-[10px] font-bold text-slate-300">
        {first + 1}–{last + 1}
      </span>
      <Icon className="size-4 shrink-0" style={{ color: stepColor(first) }} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-xs font-semibold text-slate-100">
          {STEP_KIND_INFO[group.kind].label} · {steps.length} steps
        </div>
        <div className="truncate text-[10.5px] text-slate-500">
          {detail && `${detail} · `}
          {seconds > 0 ? formatDuration(seconds) : `${on} of ${steps.length} included`}
        </div>
      </div>
      <RemoveBtn what={`these ${steps.length} steps`} onRemove={onRemove} testId="step-group-remove" />
      <StatusCircle level={level} size={16} />
    </div>
  )
}

/** One step: a compact two-line row; selected, it shows its details and actions. */
function StepRow({
  step,
  index,
  count,
  status,
  nested,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
  onDuplicate
}: {
  step: CamStep
  index: number
  count: number
  status: StepStatus
  nested: boolean
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (to: number) => void
  onDuplicate: () => void
}): React.JSX.Element {
  const layers = useProject((s) => s.layers)
  const tools = useProject((s) => s.tools)
  const upsertStep = useProject((s) => s.upsertStep)
  const removeStep = useProject((s) => s.removeStep)
  const selected = useUi((s) => s.selectedStepId === step.id)
  const working = useUi((s) => s.generating && s.generatingStepId === step.id)
  const problems = useUi((s) => s.cam?.toolpaths.find((t) => t.stepId === step.id)?.problems?.length ?? 0)
  const openEdit = useStepEditor((s) => s.openEdit)
  const [confirmDel, setConfirmDel] = useState(false)
  const Icon = stepIcon(step.kind)
  const tool = tools.find((t) => t.id === step.toolId)
  const stepLayers = layers.filter((l) => step.layerIds.includes(l.id))
  const needsLayer = STEP_KIND_INFO[step.kind].allowedLayerTypes.length > 0
  const level: StatusLevel = step.enabled ? status.level : 'pending'
  const color = stepColor(index)
  const units = useUnits()
  const skipped = step.skip?.enabled ? step.skip.items.length : 0

  const summary = [
    tool ? `T${tool.number} ${tool.name}` : 'no bit chosen',
    needsLayer
      ? stepLayers.length
        ? stepLayers.map((l) => layerLabel(l.fileName)).join(', ')
        : 'no layer'
      : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      data-testid="step-card"
      data-step-id={step.id}
      data-status={level}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', step.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={() => useUi.getState().set({ selectedStepId: selected ? null : step.id })}
      onDoubleClick={() => openEdit(step)}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-lg border bg-slate-900 transition-colors',
        !step.enabled
          ? 'border-dashed border-slate-700 opacity-55'
          : level === 'error'
            ? 'border-rose-500/70 bg-rose-500/5'
            : level === 'warning'
              ? 'border-amber-500/60 bg-amber-500/5'
              : 'border-slate-700 hover:border-slate-500',
        selected && 'ring-2 ring-sky-500/70',
        working && 'border-sky-500/80 shadow-[0_0_0_1px_rgba(56,189,248,0.35)]',
        dragging && 'opacity-30'
      )}
    >
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: step.enabled ? color : '#475569' }}
      />
      <div className="flex items-center gap-1.5 py-1.5 pl-2 pr-1.5">
        <Tooltip content="Drag to move the step up or down">
          <GripVertical className="size-3.5 shrink-0 cursor-grab text-slate-600 group-hover:text-slate-400" />
        </Tooltip>
        <Tooltip
          content={
            step.enabled
              ? 'Included in the G-code. Untick to keep the step but skip it (no toolpath, no G-code).'
              : 'Skipped: not in the G-code. Tick to include it again.'
          }
        >
          <input
            type="checkbox"
            checked={step.enabled}
            onChange={(e) => upsertStep({ ...step, enabled: e.target.checked })}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="size-3.5 shrink-0 cursor-pointer accent-sky-500"
            aria-label="Include this step in the G-code"
            data-testid="step-toggle"
          />
        </Tooltip>
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-slate-200">
          {index + 1}
        </span>
        <Icon className="size-4 shrink-0" style={{ color: step.enabled ? color : undefined }} />
        <div className="min-w-0 flex-1 leading-tight">
          <div
            className={cn(
              'truncate text-xs font-semibold',
              step.enabled ? 'text-slate-100' : 'text-slate-400 line-through'
            )}
            title={step.name}
          >
            {nested ? step.name.replace(/^(Drill holes|Mill big holes) /, '') : step.name}
          </div>
          <div className="truncate text-[10.5px] text-slate-500" title={summary}>
            {summary}
          </div>
        </div>
        {skipped > 0 && (
          <Tooltip
            content={`You chose to skip ${skipped} part${skipped === 1 ? '' : 's'} of the board in this step.`}
          >
            <span
              className="flex shrink-0 items-center gap-0.5 rounded bg-rose-500/15 px-1 py-px text-[10px] font-semibold text-rose-200"
              data-testid="step-skipped"
            >
              <Ban className="size-3" />
              {skipped}
            </span>
          </Tooltip>
        )}
        {step.enabled && problems > 0 && (
          <Tooltip content="Places this step cannot machine as designed — click to see them on the board">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                showProblems(step.id)
              }}
              className="flex shrink-0 items-center gap-0.5 rounded bg-amber-500/15 px-1 py-px text-[10px] font-semibold text-amber-200 hover:bg-amber-500/30"
              data-testid="step-problems"
            >
              <MapPin className="size-3" />
              {problems}
            </button>
          </Tooltip>
        )}
        <Tooltip content="Edit this step">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              openEdit(step)
            }}
            className="flex size-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Edit"
            data-testid="step-edit"
          >
            <Pencil className="size-3.5" />
          </button>
        </Tooltip>
        <Tooltip
          content={
            !step.enabled ? (
              'Disabled: skipped, no toolpath and no G-code.'
            ) : status.issues.length ? (
              <IssueList issues={status.issues} />
            ) : (
              'Ready: everything is OK for the generator.'
            )
          }
        >
          <span className="flex shrink-0 items-center gap-1" data-testid="step-status">
            {step.enabled && status.errors > 0 && (
              <span className="text-[10px] font-bold text-rose-400">{status.errors}✕</span>
            )}
            {step.enabled && status.warnings > 0 && (
              <span className="text-[10px] font-bold text-amber-400">{status.warnings}!</span>
            )}
            {working ? (
              <span className="flex items-center text-sky-300" data-testid="step-working" title="Working…">
                <Loader2 className="size-4 animate-spin" />
              </span>
            ) : (
              <StatusCircle level={level} size={16} />
            )}
          </span>
        </Tooltip>
      </div>
      {selected && (
        <div onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <div className="mx-2 mb-1.5 flex flex-col gap-1 rounded-md bg-slate-950/50 px-2 py-1.5 text-[10.5px]">
            <InfoRow label="Side">
              <span
                className={cn(
                  'rounded px-1.5 py-px text-[9.5px] font-bold tracking-wide',
                  step.side === 'top' ? 'bg-sky-500/15 text-sky-300' : 'bg-violet-500/20 text-violet-200'
                )}
              >
                {step.side === 'top' ? 'TOP' : 'BOTTOM'} side up
              </span>
              {!step.enabled && <span className="text-slate-400">· not in the G-code</span>}
            </InfoRow>
            {needsLayer && (
              <InfoRow label={stepLayers.length > 1 ? 'Layers' : 'Layer'}>
                {stepLayers.length ? (
                  stepLayers.map((l) => (
                    <span
                      key={l.id}
                      className="flex max-w-full items-center gap-1 rounded border border-slate-700/80 bg-slate-800/60 px-1.5 py-px text-slate-300"
                      title={l.fileName}
                    >
                      <span className="size-2 shrink-0 rounded-sm" style={{ background: l.color }} />
                      <span className="truncate">{layerLabel(l.fileName)}</span>
                      <span className="shrink-0 text-[9px] uppercase text-slate-500">
                        {SIDE_SHORT[l.side]}
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="text-rose-400">no layer chosen</span>
                )}
              </InfoRow>
            )}
            <InfoRow label="Bit">
              {tool ? (
                <span className="flex min-w-0 items-center gap-1 rounded border border-slate-700/80 bg-slate-800/60 px-1.5 py-px text-slate-300">
                  <span className="shrink-0 rounded bg-slate-700 px-1 text-[9px] font-bold text-slate-200">
                    T{tool.number}
                  </span>
                  <span className="truncate">{tool.name}</span>
                  <span className="shrink-0 text-slate-500">
                    Ø {fmtLength(tool.geometry.diameter, units)}
                  </span>
                </span>
              ) : (
                <span className="text-rose-400">no bit chosen</span>
              )}
            </InfoRow>
          </div>
          <div
            className="flex items-center gap-0.5 border-t border-slate-800 bg-slate-950/40 px-1.5"
            data-testid="step-actions"
          >
            <IconBtn label="Move up (runs earlier)" disabled={index === 0} onClick={() => onMove(index - 1)}>
              <ArrowUp />
            </IconBtn>
            <IconBtn
              label="Move down (runs later)"
              disabled={index === count - 1}
              onClick={() => onMove(index + 1)}
            >
              <ArrowDown />
            </IconBtn>
            <span className="flex-1" />
            <ActionBtn label="Duplicate" onClick={onDuplicate} testId="step-duplicate">
              <Copy />
            </ActionBtn>
            {confirmDel ? (
              <Button
                size="sm"
                variant="danger"
                className="h-6 px-2 text-[10.5px]"
                onClick={() => removeStep(step.id)}
                onMouseLeave={() => setConfirmDel(false)}
                data-testid="step-delete-confirm"
              >
                Delete?
              </Button>
            ) : (
              <ActionBtn label="Delete" onClick={() => setConfirmDel(true)} testId="step-delete" danger>
                <Trash2 />
              </ActionBtn>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const SIDE_SHORT: Record<string, string> = {
  top: 'top',
  bottom: 'bottom',
  inner: 'inner',
  all: 'both',
  none: ''
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-1.5">
      <span className="w-9 shrink-0 pt-px text-[10px] text-slate-500">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{children}</div>
    </div>
  )
}

function ActionBtn({
  label,
  onClick,
  testId,
  danger,
  children
}: {
  label: string
  onClick: () => void
  testId?: string
  danger?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'h-6 gap-1 px-1.5 text-[10.5px] text-slate-400 [&_svg]:size-3.5',
        danger ? 'hover:bg-rose-500/20 hover:text-rose-300' : 'hover:text-slate-100'
      )}
    >
      {children}
      {label}
    </Button>
  )
}

function IconBtn({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip content={label}>
      <Button size="iconSm" variant="ghost" aria-label={label} disabled={disabled} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  )
}

/** Small header icon button (Expand / Collapse / Remove all). */
function HeaderBtn({
  label,
  onClick,
  testId,
  danger,
  children
}: {
  label: string
  onClick: () => void
  testId?: string
  danger?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip content={label}>
      <Button
        size="iconSm"
        variant="ghost"
        aria-label={label}
        onClick={onClick}
        data-testid={testId}
        className={danger ? 'hover:bg-rose-500/20 hover:text-rose-300' : undefined}
      >
        {children}
      </Button>
    </Tooltip>
  )
}

/** Trash icon on a group header; the first click asks "Remove?", the second removes (Undo brings it back). */
function RemoveBtn({
  what,
  onRemove,
  testId
}: {
  what: string
  onRemove: () => void
  testId?: string
}): React.JSX.Element {
  const [ask, setAsk] = useState(false)
  if (ask)
    return (
      <Button
        size="sm"
        variant="danger"
        className="h-5 shrink-0 px-1.5 text-[10px]"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        onMouseLeave={() => setAsk(false)}
        data-testid={testId ? `${testId}-confirm` : undefined}
      >
        Remove?
      </Button>
    )
  return (
    <Tooltip content={`Remove ${what} (Ctrl+Z undoes it)`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setAsk(true)
        }}
        className="flex size-5 shrink-0 items-center justify-center rounded text-slate-600 opacity-0 transition-opacity hover:bg-rose-500/20 hover:text-rose-300 focus:opacity-100 group-hover/g:opacity-100 group-hover/ph:opacity-100"
        aria-label={`Remove ${what}`}
        data-testid={testId}
      >
        <Trash2 className="size-3.5" />
      </button>
    </Tooltip>
  )
}
