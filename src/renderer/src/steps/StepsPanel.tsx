/**
 * STEPS panel of the Manufacture stage: the ordered job list with status circles, flip markers,
 * drag-and-drop reordering and per-step actions; plus "Add step" and "Recipe".
 */
import { useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  MapPin,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  Wand2
} from 'lucide-react'
import type { CamStep } from '@core/model/types'
import { STEP_KIND_INFO } from '@core/cam'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { applyRecipe, showProblems } from '@renderer/store/controller'
import { PanelSection } from '@renderer/components/ui/section'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { StatusCircle } from '@renderer/components/ui/status'
import { HelpTip } from '@renderer/components/ui/help'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { cn, uid } from '@renderer/lib/utils'
import { fmtLength, useUnits } from '@renderer/lib/units'
import { useStepEditor } from './editorStore'
import { IssueList } from './IssueList'
import { help, layerLabel, stepColor, stepIcon, useStepStatus, useValidationCtx } from './stepUtils'
import type { StepValidationContext } from '@core/cam'

export function StepsPanel(): React.JSX.Element {
  const steps = useProject((s) => s.steps)
  const setSteps = useProject((s) => s.setSteps)
  const moveStep = useProject((s) => s.moveStep)
  const material = useProject((s) => s.material)
  const ctx = useValidationCtx()
  const openPicker = useStepEditor((s) => s.openPicker)
  const [confirmRecipe, setConfirmRecipe] = useState(false)
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null)

  const runRecipe = (): void => {
    if (steps.length) setConfirmRecipe(true)
    else applyRecipe()
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

  // Flip markers: between consecutive ENABLED steps whose side differs.
  let lastSide: 'top' | 'bottom' | null = null
  const flipBefore = new Set<string>()
  for (const s of steps) {
    if (!s.enabled) continue
    if (lastSide && s.side !== lastSide) flipBefore.add(s.id)
    lastSide = s.side
  }

  return (
    <PanelSection title="Steps">
      {steps.length === 0 && (
        <div className="mb-2 rounded-lg border border-dashed border-slate-700 p-3 text-center text-xs leading-relaxed text-slate-400">
          <Wand2 className="mx-auto mb-1.5 size-6 text-sky-400" />
          The milling operations, run from top to bottom. Click <b className="text-slate-200">Recipe</b> and
          TraceMill plans the job from your layers (recommended), or{' '}
          <b className="text-slate-200">Add step</b> to build it yourself.
        </div>
      )}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Tooltip content="Let TraceMill plan the whole job for you: it picks the steps, their order and the tools from your layers.">
          <Button variant="secondary" className="h-10 text-sm" onClick={runRecipe} data-testid="recipe">
            <Wand2 /> Recipe
          </Button>
        </Tooltip>
        <Button className="h-10 text-sm" onClick={openPicker} data-testid="add-step">
          <Plus /> Add step
        </Button>
      </div>
      {steps.length > 0 && (
        <div
          className="flex flex-col"
          onDragOver={(e) => drag && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            onDrop(drag?.over ?? steps.length)
          }}
        >
          {steps.map((step, i) => (
            <div key={step.id}>
              {flipBefore.has(step.id) && (
                <FlipMarker axis={material?.alignment.axis ?? 'x'} toSide={step.side} />
              )}
              <div
                onDragOver={(e) => {
                  if (!drag) return
                  e.preventDefault()
                  const r = e.currentTarget.getBoundingClientRect()
                  const over = e.clientY < r.top + r.height / 2 ? i : i + 1
                  if (over !== drag.over) setDrag({ ...drag, over })
                }}
              >
                {drag && drag.over === i && <DropLine />}
                <StepCard
                  step={step}
                  index={i}
                  count={steps.length}
                  ctx={ctx}
                  dragging={drag?.id === step.id}
                  onDragStart={() => setDrag({ id: step.id, over: null })}
                  onDragEnd={() => setDrag(null)}
                  onMove={(to) => moveStep(step.id, to)}
                  onDuplicate={() => duplicate(step)}
                />
                {drag && drag.over === i + 1 && i === steps.length - 1 && <DropLine />}
              </div>
            </div>
          ))}
        </div>
      )}
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
                applyRecipe()
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

function FlipMarker({ axis, toSide }: { axis: 'x' | 'y'; toSide: 'top' | 'bottom' }): React.JSX.Element {
  return (
    <div
      className="my-1.5 flex items-start gap-2 rounded-lg border border-violet-500/50 bg-violet-500/10 px-2.5 py-2 text-[11px] text-violet-100"
      data-testid="flip-marker"
    >
      <RefreshCcw className="mt-0.5 size-4 shrink-0 text-violet-300" />
      <div className="min-w-0 flex-1 leading-snug">
        <div className="font-semibold text-violet-200">Flip the board here ({toSide} side up)</div>
        Turn the board over around the line through the two pins (
        {axis === 'x' ? 'front edge goes to the back' : 'left edge goes to the right'}), push it back onto the
        alignment pins and re-check Z zero.
      </div>
      <HelpTip title="Flipping the board">{help('concept.flip')}</HelpTip>
    </div>
  )
}

function StepCard({
  step,
  index,
  count,
  ctx,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
  onDuplicate
}: {
  step: CamStep
  index: number
  count: number
  ctx: StepValidationContext | null
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
  const problems = useUi((s) => s.cam?.toolpaths.find((t) => t.stepId === step.id)?.problems?.length ?? 0)
  const openEdit = useStepEditor((s) => s.openEdit)
  const status = useStepStatus(step, ctx)
  const [confirmDel, setConfirmDel] = useState(false)
  const Icon = stepIcon(step.kind)
  const tool = tools.find((t) => t.id === step.toolId)
  const stepLayers = layers.filter((l) => step.layerIds.includes(l.id))
  const needsLayer = STEP_KIND_INFO[step.kind].allowedLayerTypes.length > 0
  const level = step.enabled ? status.level : 'pending'
  const color = stepColor(index)
  const units = useUnits()

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
        'group relative mb-1.5 cursor-pointer rounded-lg border bg-slate-900 p-2 pl-2.5 transition-colors',
        !step.enabled
          ? 'border-dashed border-slate-700 opacity-55'
          : level === 'error'
            ? 'border-rose-500/70 bg-rose-500/5'
            : level === 'warning'
              ? 'border-amber-500/60 bg-amber-500/5'
              : 'border-slate-700 hover:border-slate-500',
        selected && 'ring-2 ring-sky-500/70',
        dragging && 'opacity-30'
      )}
    >
      <span
        className="absolute inset-y-1 left-0 w-1 rounded-r"
        style={{ background: step.enabled ? color : '#475569' }}
      />
      <div className="flex gap-1.5">
        <div className="flex w-4 shrink-0 flex-col items-center gap-1.5 pt-0.5">
          <Tooltip content="Drag to move the step up or down">
            <GripVertical className="size-4 cursor-grab text-slate-500" />
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
              className="size-3.5 cursor-pointer accent-sky-500"
              aria-label="Include this step in the G-code"
              data-testid="step-toggle"
            />
          </Tooltip>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-slate-200">
              {index + 1}
            </span>
            <Icon className="size-4 shrink-0" style={{ color: step.enabled ? color : undefined }} />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-xs font-semibold',
                step.enabled ? 'text-slate-100' : 'text-slate-400 line-through'
              )}
              title={step.name}
            >
              {step.name}
            </span>
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
                <StatusCircle level={level} size={18} />
              </span>
            </Tooltip>
          </div>
          <div className="mt-1.5 flex flex-col gap-1 rounded-md bg-slate-950/50 px-2 py-1.5 text-[10.5px]">
            <InfoRow label="Side">
              <span
                className={cn(
                  'rounded px-1.5 py-px text-[9.5px] font-bold tracking-wide',
                  step.side === 'top' ? 'bg-sky-500/15 text-sky-300' : 'bg-violet-500/20 text-violet-200'
                )}
              >
                {step.side === 'top' ? 'TOP' : 'BOTTOM'} side up
              </span>
              {!step.enabled && (
                <span className="text-[10px] font-semibold text-slate-400">· not in the G-code</span>
              )}
            </InfoRow>
            <InfoRow label={stepLayers.length > 1 ? 'Layers' : 'Layer'}>
              {needsLayer ? (
                stepLayers.length ? (
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
                )
              ) : (
                <span className="text-slate-400">alignment pins of the material</span>
              )}
            </InfoRow>
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
        </div>
      </div>
      <div
        className="-mx-2 -mb-2 mt-2 flex items-center gap-0.5 rounded-b-lg border-t border-slate-800 bg-slate-950/40 px-1.5 py-0.5"
        data-testid="step-actions"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
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
        <ActionBtn label="Edit" onClick={() => openEdit(step)} testId="step-edit">
          <Pencil />
        </ActionBtn>
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
  )
}

const SIDE_SHORT: Record<string, string> = {
  top: 'top',
  bottom: 'bottom',
  inner: 'inner',
  all: 'both sides',
  none: ''
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2">
      <span className="w-10 shrink-0 pt-px text-[10px] text-slate-500">{label}</span>
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
  testId,
  danger,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
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
        disabled={disabled}
        onClick={onClick}
        data-testid={testId}
        className={danger ? 'hover:bg-rose-500/20 hover:text-rose-300' : undefined}
      >
        {children}
      </Button>
    </Tooltip>
  )
}
