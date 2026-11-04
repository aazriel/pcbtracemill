import { useMemo, type ReactNode } from 'react'
import {
  ArrowUpDown,
  Check,
  Copy,
  Fan,
  FileCode,
  Lock,
  Maximize2,
  Settings2,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import type { MachineProfile } from '@core/model/types'
import { MACHINE_FIELD_HELP } from '@core/machines'
import { Button } from '@renderer/components/ui/button'
import { NumberField, SelectField, Switch, TextField } from '@renderer/components/ui/fields'
import { HelpTip } from '@renderer/components/ui/help'
import { StatusCircle } from '@renderer/components/ui/status'
import { cn } from '@renderer/lib/utils'
import { HeightsIllustration } from './HeightsIllustration'
import { machineFigure } from './machineFigures'
import { MachineIcon } from './MachineCard'
import { POST_OPTIONS, errorsByField, type MachineFieldKey } from './machineMeta'

type KeysOfType<V> = {
  [K in keyof MachineProfile]: MachineProfile[K] extends V ? K : never
}[keyof MachineProfile]
type NumKey = KeysOfType<number>
type BoolKey = KeysOfType<boolean>
type TextKey = 'name' | 'description' | 'fileExtension' | 'customHeader' | 'customFooter'
type SelectKey = 'postProcessor' | 'outputUnits' | 'commentStyle' | 'probeCommand'

type Spec =
  | { kind: 'number'; key: NumKey; step?: number; min?: number; max?: number }
  | { kind: 'bool'; key: BoolKey }
  | { kind: 'text'; key: TextKey; multiline?: boolean; placeholder?: string }
  | { kind: 'select'; key: SelectKey; options: { value: string; label: string }[] }
  | { kind: 'workArea' }

interface Group {
  id: string
  title: string
  icon: ReactNode
  intro: string
  specs: Spec[]
}

const GROUPS: Group[] = [
  {
    id: 'general',
    title: 'General & output',
    icon: <FileCode />,
    intro: 'What the machine is called and what kind of G-code file TraceMill writes for it.',
    specs: [
      { kind: 'text', key: 'name' },
      { kind: 'text', key: 'description', multiline: true },
      { kind: 'select', key: 'postProcessor', options: POST_OPTIONS },
      { kind: 'text', key: 'fileExtension', placeholder: 'nc' },
      {
        kind: 'select',
        key: 'outputUnits',
        options: [
          { value: 'mm', label: 'Millimetres (G21)' },
          { value: 'inch', label: 'Inches (G20)' }
        ]
      },
      { kind: 'number', key: 'decimals', step: 1, min: 1, max: 6 },
      { kind: 'bool', key: 'lineNumbers' },
      {
        kind: 'select',
        key: 'commentStyle',
        options: [
          { value: 'parens', label: '(comment in brackets)' },
          { value: 'semicolon', label: '; comment after semicolon' }
        ]
      }
    ]
  },
  {
    id: 'area',
    title: 'Work area & limits',
    icon: <Maximize2 />,
    intro: 'How far and how fast the machine can move. Jobs are checked against these limits.',
    specs: [
      { kind: 'workArea' },
      { kind: 'number', key: 'maxFeedXY', step: 50, min: 0 },
      { kind: 'number', key: 'maxFeedZ', step: 50, min: 0 }
    ]
  },
  {
    id: 'spindle',
    title: 'Spindle',
    icon: <Fan />,
    intro: 'The motor that spins the cutting bit.',
    specs: [
      { kind: 'number', key: 'spindleMin', step: 500, min: 0 },
      { kind: 'number', key: 'spindleMax', step: 500, min: 0 },
      { kind: 'number', key: 'spindleSpinUpSec', step: 0.5, min: 0 },
      { kind: 'bool', key: 'spindleSpeedControl' }
    ]
  },
  {
    id: 'heights',
    title: 'Heights',
    icon: <ArrowUpDown />,
    intro: 'How high the bit lifts above the copper (Z0) when it is not cutting.',
    specs: [
      { kind: 'number', key: 'safeZ', step: 0.5, min: 0 },
      { kind: 'number', key: 'travelZ', step: 0.5, min: 0 },
      { kind: 'number', key: 'toolChangeZ', step: 1, min: 0 }
    ]
  },
  {
    id: 'caps',
    title: 'Capabilities',
    icon: <Sparkles />,
    intro: 'Features your controller understands. When unsure, leave them as the preset sets them.',
    specs: [
      { kind: 'bool', key: 'supportsToolChange' },
      { kind: 'bool', key: 'supportsArcs' },
      { kind: 'bool', key: 'supportsCannedCycles' },
      { kind: 'bool', key: 'supportsProbing' },
      {
        kind: 'select',
        key: 'probeCommand',
        options: [
          { value: 'G38.2', label: 'G38.2 (GRBL, LinuxCNC)' },
          { value: 'G31', label: 'G31 (Mach3)' }
        ]
      }
    ]
  },
  {
    id: 'custom',
    title: 'Custom start / end code',
    icon: <Settings2 />,
    intro: 'Optional extra G-code lines. Leave empty unless you know your machine needs them.',
    specs: [
      { kind: 'text', key: 'customHeader', multiline: true, placeholder: 'e.g. G54' },
      { kind: 'text', key: 'customFooter', multiline: true, placeholder: 'e.g. G28' }
    ]
  }
]

const specKeys = (s: Spec): MachineFieldKey[] => (s.kind === 'workArea' ? ['workArea'] : [s.key])

function readValue(m: MachineProfile, s: Spec): ReactNode {
  const unit = s.kind === 'workArea' ? 'mm' : MACHINE_FIELD_HELP[s.key].unit
  switch (s.kind) {
    case 'workArea':
      return `X ${m.workArea.x} × Y ${m.workArea.y} × Z ${m.workArea.z} mm`
    case 'number':
      return `${m[s.key]}${unit ? ` ${unit}` : ''}`
    case 'bool':
      return m[s.key] ? (
        <span className="inline-flex items-center gap-1 text-emerald-300">
          <Check className="size-3.5" strokeWidth={3} /> Yes
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-slate-500">
          <X className="size-3.5" strokeWidth={3} /> No
        </span>
      )
    case 'select':
      return s.options.find((o) => o.value === m[s.key])?.label ?? String(m[s.key])
    case 'text': {
      const v = m[s.key]
      if (!v) return <span className="text-slate-600">(none)</span>
      if (s.key === 'fileExtension') return `.${v}`
      return s.multiline && s.key !== 'description' ? (
        <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-300">{v}</pre>
      ) : (
        v
      )
    }
  }
}

/** The (?) content of a machine setting: its explanation plus its illustration. */
function fieldHelp(key: MachineFieldKey, m: MachineProfile): { text: string; figure: ReactNode | null } {
  return { text: MACHINE_FIELD_HELP[key].description, figure: machineFigure(key, m) }
}

function ReadRow({ m, spec }: { m: MachineProfile; spec: Spec }): React.JSX.Element {
  const key: MachineFieldKey = spec.kind === 'workArea' ? 'workArea' : spec.key
  const help = MACHINE_FIELD_HELP[key]
  const fh = fieldHelp(key, m)
  return (
    <div className="grid grid-cols-[minmax(0,150px)_1fr] gap-x-3 border-b border-slate-800/60 py-1.5 last:border-0">
      <div className="flex items-start gap-1 text-xs text-slate-400">
        <span>{help.label}</span>
        <HelpTip title={help.label} wide={!!fh.figure}>
          {fh.text}
          {fh.figure && <div className="mt-2">{fh.figure}</div>}
        </HelpTip>
      </div>
      <div className="min-w-0 text-xs text-slate-100">{readValue(m, spec)}</div>
    </div>
  )
}

function EditRow({
  m,
  spec,
  errors,
  onChange
}: {
  m: MachineProfile
  spec: Spec
  errors: Map<MachineFieldKey | null, string[]>
  onChange: (m: MachineProfile) => void
}): React.JSX.Element {
  if (spec.kind === 'workArea') {
    const h = MACHINE_FIELD_HELP.workArea
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
          {h.label}
          <HelpTip title={h.label} wide>
            {h.description}
            <div className="mt-2">{machineFigure('workArea', m)}</div>
          </HelpTip>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <NumberField
              key={axis}
              label={`${axis.toUpperCase()} travel`}
              value={m.workArea[axis]}
              unit="mm"
              min={0}
              step={10}
              error={m.workArea[axis] > 0 ? null : 'Must be greater than 0'}
              onChange={(v) => onChange({ ...m, workArea: { ...m.workArea, [axis]: v } })}
            />
          ))}
        </div>
      </div>
    )
  }
  const h = MACHINE_FIELD_HELP[spec.key]
  const error = errors.get(spec.key)?.join(' ') ?? null
  const figure = machineFigure(spec.key, m)
  const figureProps = figure
    ? {
        help: (
          <>
            {h.description}
            <div className="mt-2">{figure}</div>
          </>
        ),
        helpWide: true
      }
    : {}
  switch (spec.kind) {
    case 'number':
      return (
        <NumberField
          label={h.label}
          {...figureProps}
          description={h.description}
          unit={h.unit}
          value={m[spec.key]}
          step={spec.step}
          min={spec.min}
          max={spec.max}
          error={error}
          onChange={(v) => onChange({ ...m, [spec.key]: v })}
        />
      )
    case 'bool':
      return (
        <Switch
          label={h.label}
          {...figureProps}
          description={h.description}
          checked={m[spec.key]}
          onChange={(v) => onChange({ ...m, [spec.key]: v })}
        />
      )
    case 'select':
      return (
        <SelectField
          label={h.label}
          {...figureProps}
          description={h.description}
          value={m[spec.key]}
          options={spec.options}
          error={error}
          onChange={(v) => onChange({ ...m, [spec.key]: v } as MachineProfile)}
        />
      )
    case 'text':
      return (
        <TextField
          label={h.label}
          {...figureProps}
          description={h.description}
          value={m[spec.key]}
          multiline={spec.multiline}
          placeholder={spec.placeholder}
          error={error}
          onChange={(v) =>
            onChange({ ...m, [spec.key]: spec.key === 'fileExtension' ? v.replace(/^\./, '').trim() : v })
          }
        />
      )
  }
}

/** Full detail pane for one machine: read-only for presets, editable for the user's own machines. */
export function MachineDetail({
  machine,
  errors,
  inUse,
  onChange,
  onDuplicate,
  onDelete
}: {
  machine: MachineProfile
  errors: string[]
  inUse: boolean
  onChange: (m: MachineProfile) => void
  onDuplicate: () => void
  onDelete: () => void
}): React.JSX.Element {
  const editable = !machine.builtIn
  const byField = useMemo(() => errorsByField(errors), [errors])

  return (
    <div className="flex flex-col" data-testid="machine-detail">
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-slate-800 bg-slate-900/95 p-3 backdrop-blur">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-slate-800 text-sky-300">
          <MachineIcon machine={machine} className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-slate-100">
              {machine.name || 'Unnamed machine'}
            </h3>
            {inUse && (
              <span className="rounded bg-emerald-600/20 px-1.5 text-[10px] font-semibold text-emerald-300">
                In use
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
            {editable ? (
              'Your own machine — every value below can be changed.'
            ) : (
              <>
                <Lock className="size-3" /> Built-in preset (read-only). Duplicate it to change values.
              </>
            )}
          </div>
        </div>
        {editable ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            title="Delete this machine"
            data-testid="machine-delete"
          >
            <Trash2 /> Delete
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={onDuplicate} data-testid="machine-duplicate">
            <Copy /> Duplicate & customise
          </Button>
        )}
      </div>

      {errors.length > 0 && (
        <div className="mx-3 mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-300">
          <div className="mb-0.5 font-semibold">
            {errors.length} setting{errors.length > 1 ? 's need' : ' needs'} fixing before this machine can be
            used:
          </div>
          <ul className="list-inside list-disc">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {GROUPS.map((g) => {
        const groupErrors = g.specs.flatMap(specKeys).some((k) => byField.has(k))
        return (
          <section key={g.id} className="border-b border-slate-800/80 px-3 py-3 last:border-0">
            <header className="mb-2 flex items-center gap-2">
              <span className="text-slate-400 [&_svg]:size-4">{g.icon}</span>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">{g.title}</h4>
              <HelpTip title={g.title} wide={g.id === 'heights'}>
                {g.intro}
                {g.id === 'heights' && (
                  <div className="mt-2 overflow-hidden rounded-md border border-slate-800">
                    <HeightsIllustration
                      safeZ={machine.safeZ}
                      travelZ={machine.travelZ}
                      toolChangeZ={machine.toolChangeZ}
                    />
                  </div>
                )}
              </HelpTip>
              <span className="ml-auto">
                <StatusCircle
                  level={groupErrors ? 'error' : 'ok'}
                  size={16}
                  title={groupErrors ? 'Something here needs fixing' : 'Looks good'}
                />
              </span>
            </header>
            <div className={cn(editable ? 'flex flex-col gap-3' : 'flex flex-col')}>
              {g.specs.map((s) =>
                editable ? (
                  <EditRow key={specKeys(s)[0]} m={machine} spec={s} errors={byField} onChange={onChange} />
                ) : (
                  <ReadRow key={specKeys(s)[0]} m={machine} spec={s} />
                )
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
