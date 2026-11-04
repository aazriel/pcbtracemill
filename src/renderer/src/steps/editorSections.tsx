/** Layer, Tool, General and Results sections of the Step editor dialog. */
import { useState } from 'react'
import {
  ArrowLeft,
  Clock,
  Info,
  Library,
  Ruler,
  ArrowDownToLine,
  Route as RouteIcon,
  Wrench
} from 'lucide-react'
import type { CamStep, ImportedLayer, Toolpath, ValidationIssue } from '@core/model/types'
import { STEP_KIND_INFO, defaultCutDepth, isToolAllowed, layersForStep } from '@core/cam'
import { effectiveCutWidth } from '@core/tools'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { useLayersWithParsed } from '@renderer/store/controller'
import { ToolLibraryDialog } from '@renderer/tools/ToolLibraryDialog'
import { ToolPickerDialog } from '@renderer/tools/ToolPickerDialog'
import { ToolCard } from '@renderer/tools/ToolCard'
import { Button } from '@renderer/components/ui/button'
import { NumberField, Segmented, Switch, TextField, FieldShell } from '@renderer/components/ui/fields'
import { HelpTip } from '@renderer/components/ui/help'
import { cn, formatDuration } from '@renderer/lib/utils'
import { DepthCrossSection, Figure, SideIllustration } from './illustrations'
import { help, layerLabel, withSide } from './stepUtils'

export interface SectionProps {
  draft: CamStep
  update: (fn: (d: CamStep) => CamStep) => void
  issues: ValidationIssue[]
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000

function firstIssue(issues: ValidationIssue[], re: RegExp, level: 'error' | 'warning'): string | null {
  return issues.find((i) => i.level === level && re.test(i.message))?.message ?? null
}

// ───────────────────────────────────────── Layer

function layerStats(l: ImportedLayer): string {
  if (l.type === 'drill') {
    const d = l.parsed?.drills
    const holes = d?.holes.length ?? l.stats.pads
    const slots = d?.slots.length ?? 0
    return `${holes} hole${holes === 1 ? '' : 's'}${slots ? ` · ${slots} slot${slots === 1 ? '' : 's'}` : ''}`
  }
  if (l.type === 'outline') return `${l.stats.widthMm.toFixed(1)} × ${l.stats.heightMm.toFixed(1)} mm`
  return `${l.stats.pads} pads · ${l.stats.tracks} tracks`
}

const SIDE_LABEL: Record<string, string> = {
  top: 'top',
  bottom: 'bottom',
  inner: 'inner',
  all: 'both sides',
  none: ''
}

export function LayerSection({ draft, update }: SectionProps): React.JSX.Element {
  const layers = useLayersWithParsed()
  const info = STEP_KIND_INFO[draft.kind]
  if (info.allowedLayerTypes.length === 0) {
    return (
      <p className="flex items-start gap-2 rounded-md bg-slate-800/50 p-2.5 text-xs text-slate-300">
        <Info className="mt-px size-4 shrink-0 text-sky-400" />
        This step does not need a layer: the pin positions are worked out from the material size and the
        alignment settings of the material.
      </p>
    )
  }
  const candidates = layersForStep(draft.kind, layers, draft.side)
  const extra = layers.filter((l) => draft.layerIds.includes(l.id) && !candidates.includes(l))
  const list = [...candidates, ...extra]
  const toggle = (id: string, on: boolean): void =>
    update((d) => ({ ...d, layerIds: on ? [...d.layerIds, id] : d.layerIds.filter((x) => x !== id) }))
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11.5px] text-slate-400">
        {help('step.layers')} Only {info.allowedLayerTypes.join(' / ')} layers
        {info.allowedLayerTypes.includes('copper') ? ` of the ${draft.side} side` : ''} are shown.
      </p>
      {list.length === 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-200">
          <span>
            No {info.allowedLayerTypes.join(' or ')} layer
            {info.allowedLayerTypes.includes('copper') ? ` for the ${draft.side} side` : ''} was imported. Go
            back to the Board stage to import it, or check the layer type there.
          </span>
          <Button size="sm" variant="secondary" onClick={() => useUi.getState().set({ stage: 'board' })}>
            <ArrowLeft /> Board
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-1" data-testid="layer-list">
        {list.map((l) => {
          const on = draft.layerIds.includes(l.id)
          const wrong = extra.includes(l)
          return (
            <label
              key={l.id}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors',
                on
                  ? 'border-sky-600/70 bg-sky-500/10'
                  : 'border-slate-700 bg-slate-950/50 hover:bg-slate-800/50'
              )}
            >
              <input
                type="checkbox"
                className="size-4 accent-sky-500"
                checked={on}
                onChange={(e) => toggle(l.id, e.target.checked)}
                data-testid="layer-checkbox"
              />
              <span
                className="size-3.5 shrink-0 rounded-sm ring-1 ring-black/40"
                style={{ background: l.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-slate-100">
                  {layerLabel(l.fileName)}
                </span>
                <span className="block text-[10.5px] text-slate-500">
                  {l.type} {SIDE_LABEL[l.side] ?? ''} · {layerStats(l)}
                </span>
              </span>
              {wrong && <span className="text-[10px] font-semibold text-amber-400">other side</span>}
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ───────────────────────────────────────── Tool

export function ToolSection({ draft, update }: SectionProps): React.JSX.Element {
  const tools = useProject((s) => s.tools)
  const machine = useProject((s) => s.machine)
  const [libOpen, setLibOpen] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const tool = tools.find((t) => t.id === draft.toolId)
  const select = (id: string): void => {
    const t = tools.find((x) => x.id === id)
    if (!t) return
    const allowed = isToolAllowed(draft.kind, t)
    if (!allowed.ok) {
      useUi.getState().toast('error', allowed.message)
      return
    }
    update((d) => ({ ...d, toolId: id }))
  }
  const fit = tool ? isToolAllowed(draft.kind, tool) : null
  return (
    <div className="flex flex-col gap-3" data-testid="tool-section">
      {tool ? (
        <div className="flex flex-col gap-1.5">
          <ToolCard tool={tool} chosen={fit?.ok} incompatible={fit ? !fit.ok : false} tabIndex={-1} />
          {fit && !fit.ok && <p className="text-[11px] text-rose-300">✕ {fit.message}</p>}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-700 p-3 text-center text-xs text-slate-400">
          No tool chosen yet.
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setPickOpen(true)} data-testid="tool-choose">
          <Wrench /> {tool ? 'Choose another tool…' : 'Choose a tool…'}
        </Button>
        <Button variant="secondary" onClick={() => setLibOpen(true)} data-testid="tool-open-library">
          <Library /> Tool library…
        </Button>
        <HelpTip title="Tool">
          {help('step.tool')} Speeds and feeds belong to the tool; change them in the tool library.
          {machine &&
            !machine.supportsToolChange &&
            ' Your machine pauses so you can change the bit by hand.'}
        </HelpTip>
      </div>
      <ToolPickerDialog
        open={pickOpen}
        onOpenChange={setPickOpen}
        stepKind={draft.kind}
        selectedToolId={draft.toolId}
        onSelect={select}
        onOpenLibrary={() => setLibOpen(true)}
      />
      <ToolLibraryDialog
        open={libOpen}
        onOpenChange={setLibOpen}
        stepKind={draft.kind}
        selectedToolId={draft.toolId}
        onSelect={(id) => {
          select(id)
          setLibOpen(false)
        }}
      />
    </div>
  )
}

// ───────────────────────────────────────── General

export function GeneralSection({ draft, update, issues }: SectionProps): React.JSX.Element {
  const material = useProject((s) => s.material)
  const machine = useProject((s) => s.machine)
  const tools = useProject((s) => s.tools)
  const tool = tools.find((t) => t.id === draft.toolId)
  const recommended = material ? defaultCutDepth(draft.kind, material) : null
  const depthErr = firstIssue(issues, /depth|thickness/i, 'error')
  const depthWarn = firstIssue(issues, /depth|deep|spoilboard/i, 'warning')
  const safeErr = firstIssue(issues, /safe z/i, 'error')
  const sideWarn = firstIssue(issues, /bottom side/i, 'warning')
  const width = tool && draft.cutDepth > 0 ? effectiveCutWidth(tool, draft.cutDepth) : null
  const machineSafe = machine?.safeZ ?? 5
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <TextField
          label="Step name"
          value={draft.name}
          onChange={(v) => update((d) => ({ ...d, name: v }))}
          description="Shown in the step list and written as a comment into the G-code."
          help={help('step.name')}
        />
        <FieldShell
          label="Side facing up"
          description="Bottom-side steps are mirrored automatically so they line up after you flip the board."
          helpWide
          help={
            <>
              {help('step.side')}
              <div className="mt-2">
                <Figure>
                  <SideIllustration side={draft.side} />
                </Figure>
              </div>
            </>
          }
          warning={sideWarn}
        >
          <div data-testid="step-side">
            <Segmented
              value={draft.side}
              onChange={(v) => update((d) => withSide(d, v))}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'bottom', label: 'Bottom (mirrored)' }
              ]}
            />
          </div>
        </FieldShell>
      </div>
      <div className="flex flex-col gap-4">
        <NumberField
          label="Cut depth below Z0"
          unit="mm"
          step={draft.kind === 'isolate' || draft.kind === 'clear' ? 0.01 : 0.1}
          min={0}
          value={draft.cutDepth}
          onChange={(v) => update((d) => ({ ...d, cutDepth: v }))}
          description="How deep the bit goes below the copper surface (Z0)."
          helpWide
          help={
            <>
              {help('step.cutDepth')}
              {material && (
                <div className="mt-2">
                  <Figure caption="Not to scale: the thin copper is drawn much thicker so you can see it.">
                    <DepthCrossSection
                      depth={draft.cutDepth}
                      copper={material.copperThickness}
                      thickness={material.thickness}
                      toolType={tool?.type ?? null}
                      tipAngle={tool?.geometry.tipAngle}
                    />
                  </Figure>
                </div>
              )}
            </>
          }
          error={depthErr}
          warning={depthWarn}
        />
        {(recommended !== null || (width !== null && tool?.type === 'vbit')) && (
          <p className="-mt-3 text-[11px] text-slate-500">
            {recommended !== null && (
              <>
                Suggested <b className="text-slate-300">{r3(recommended)} mm</b>
                {Math.abs(recommended - draft.cutDepth) > 1e-6 && (
                  <button
                    type="button"
                    className="ml-1 text-sky-400 hover:underline"
                    onClick={() => update((d) => ({ ...d, cutDepth: recommended }))}
                  >
                    use it
                  </button>
                )}
              </>
            )}
            {width !== null && tool?.type === 'vbit' && (
              <>
                {recommended !== null && ' · '}cuts a {r3(width)} mm wide groove
              </>
            )}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <Switch
            label={`Use the machine's safe height (${machineSafe} mm)`}
            checked={draft.safeZ === null}
            onChange={(v) => update((d) => ({ ...d, safeZ: v ? null : machineSafe }))}
            description="Safe height is how high the bit lifts above the board to travel between cuts."
            help={`${help('step.safeZ')} ${help('concept.safeZ')}`}
          />
          {draft.safeZ !== null && (
            <NumberField
              label="Safe Z for this step"
              unit="mm"
              min={0}
              step={0.5}
              value={draft.safeZ}
              onChange={(v) => update((d) => ({ ...d, safeZ: v }))}
              description="Height above the copper surface for travel moves. Must clear clamps and screws."
              help={help('concept.safeZ')}
              error={safeErr}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────────────────── Results

export function ResultsSection({
  draft,
  toolpath,
  stale
}: {
  draft: CamStep
  toolpath: Toolpath | undefined
  stale: boolean
}): React.JSX.Element {
  const generating = useUi((s) => s.generating)
  if (!draft.enabled)
    return (
      <p className="text-xs text-slate-400">
        This step is disabled, so no toolpath is calculated and it is left out of the G-code.
      </p>
    )
  if (!toolpath)
    return (
      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Info className="size-4 text-sky-400" />
        {generating
          ? 'Calculating…'
          : 'The estimated time and cut length will be calculated after you save the step (steps with errors get no toolpath).'}
      </p>
    )
  const s = toolpath.stats
  const tiles = [
    {
      icon: Clock,
      label: 'Estimated time',
      value: formatDuration(s.estimatedSeconds),
      hint: 'Machine time for this step, including moves between cuts.'
    },
    {
      icon: RouteIcon,
      label: 'Cut length',
      value: `${s.cutLength / 1000 >= 1 ? (s.cutLength / 1000).toFixed(2) + ' m' : s.cutLength.toFixed(0) + ' mm'}`,
      hint: 'Total distance the bit travels while cutting.'
    },
    {
      icon: Ruler,
      label: 'Travel moves',
      value: `${s.rapidLength.toFixed(0)} mm`,
      hint: 'Distance moved in the air between cuts.'
    },
    {
      icon: ArrowDownToLine,
      label: 'Plunges',
      value: String(s.plungeCount),
      hint: 'How many times the bit goes down into the material (each drilled hole is one).'
    }
  ]
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="step-results">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="flex items-center gap-1 text-[10.5px] uppercase tracking-wide text-slate-500">
              <t.icon className="size-3" /> {t.label}
              <HelpTip title={t.label}>{t.hint}</HelpTip>
            </div>
            <div className="mt-0.5 font-mono text-base text-slate-100">{t.value}</div>
          </div>
        ))}
      </div>
      {stale && (
        <p className="text-[11px] text-slate-500">
          Values are from the last generation; your changes in this dialog are calculated after Save.
        </p>
      )}
    </div>
  )
}
