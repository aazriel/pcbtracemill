import * as SwitchPrimitive from '@radix-ui/react-switch'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'
import { HelpTip } from './help'
import { convertUnit, useUnits } from '@renderer/lib/units'

export interface FieldShellProps {
  label: string
  /** Plain-language explanation (shown in the (?) tooltip, not under the field). */
  description?: ReactNode
  /** Longer explanation, added to the (?) tooltip. */
  help?: ReactNode
  /** The (?) holds an illustration: make the tooltip wider. */
  helpWide?: boolean
  error?: string | null
  warning?: string | null
  className?: string
  /** Hide the label row (the label is still used for accessibility). */
  hideLabel?: boolean
  children: ReactNode
}

export function FieldShell({
  label,
  description,
  help,
  error,
  warning,
  className,
  hideLabel,
  helpWide,
  children
}: FieldShellProps): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {!hideLabel && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
          <span>{label}</span>
          <FieldHelp label={label} description={description} help={help} wide={helpWide} />
        </div>
      )}
      {children}
      {error && <p className="text-[11px] font-medium text-rose-400">✕ {error}</p>}
      {!error && warning && <p className="text-[11px] font-medium text-amber-400">! {warning}</p>}
    </div>
  )
}

/** The (?) of a field: its description and any longer help, in one tooltip. */
export function FieldHelp({
  label,
  description,
  help,
  wide
}: {
  label: string
  description?: ReactNode
  help?: ReactNode
  wide?: boolean
}): React.JSX.Element | null {
  if (!description && !help) return null
  return (
    <HelpTip title={label} wide={wide}>
      {description}
      {description && help && <div className="mt-1.5" />}
      {help}
    </HelpTip>
  )
}

/** Rounds a converted step to a tidy value (0.001, 0.005, 0.01 …). */
function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

const inputCls =
  'h-8 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100 outline-none transition-colors focus:border-sky-500 disabled:opacity-50'

export function NumberField({
  value,
  onChange,
  unit,
  min,
  max,
  step = 0.1,
  disabled,
  ...shell
}: Omit<FieldShellProps, 'children'> & {
  value: number
  onChange: (v: number) => void
  unit?: string
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}): React.JSX.Element {
  // Lengths and feeds follow the project's display units (values are always stored in mm).
  const units = useUnits()
  const conv = convertUnit(unit, units)
  const f = conv.factor
  const shownValue = value * f
  const shownMin = min === undefined ? undefined : min * f
  const shownMax = max === undefined ? undefined : max * f
  const shownStep = f === 1 ? step : niceStep(step * f)
  const fmt = (v: number): string => String(Number(v.toFixed(f === 1 ? 6 : 5)))
  // Local text state lets users type "0." or "-" without being clobbered.
  const [text, setText] = useState(fmt(shownValue))
  useEffect(() => {
    setText((t) => (Math.abs(Number(t) - shownValue) < 1e-9 ? t : fmt(shownValue)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownValue])
  const commit = (t: string): void => {
    const n = Number(t)
    if (t.trim() === '' || !Number.isFinite(n)) {
      setText(fmt(shownValue))
      return
    }
    let v = n
    if (shownMin !== undefined) v = Math.max(shownMin, v)
    if (shownMax !== undefined) v = Math.min(shownMax, v)
    if (v !== n) setText(fmt(v))
    onChange(v / f)
  }
  return (
    <FieldShell {...shell}>
      <div className="relative">
        <input
          type="number"
          className={cn(
            inputCls,
            conv.unit && 'pr-12',
            shell.error && 'border-rose-500',
            !shell.error && shell.warning && 'border-amber-500'
          )}
          value={text}
          step={shownStep}
          min={shownMin}
          max={shownMax}
          disabled={disabled}
          aria-label={shell.label}
          onChange={(e) => {
            setText(e.target.value)
            const n = Number(e.target.value)
            if (
              e.target.value.trim() !== '' &&
              Number.isFinite(n) &&
              (shownMin === undefined || n >= shownMin) &&
              (shownMax === undefined || n <= shownMax)
            )
              onChange(n / f)
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
        />
        {conv.unit && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">
            {conv.unit}
          </span>
        )}
      </div>
    </FieldShell>
  )
}

export function TextField({
  value,
  onChange,
  placeholder,
  multiline,
  ...shell
}: Omit<FieldShellProps, 'children'> & {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  multiline?: boolean
}): React.JSX.Element {
  return (
    <FieldShell {...shell}>
      {multiline ? (
        <textarea
          className={cn(inputCls, 'h-20 py-1.5')}
          value={value}
          placeholder={placeholder}
          aria-label={shell.label}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={inputCls}
          value={value}
          placeholder={placeholder}
          aria-label={shell.label}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  )
}

export function SelectField<T extends string>({
  value,
  onChange,
  options,
  ...shell
}: Omit<FieldShellProps, 'children'> & {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; disabled?: boolean }[]
}): React.JSX.Element {
  return (
    <FieldShell {...shell}>
      <select
        className={inputCls}
        value={value}
        aria-label={shell.label}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  help,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: ReactNode
  help?: ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
          <span>{label}</span>
          <FieldHelp label={label} description={description} help={help} />
        </div>
      </div>
      <SwitchPrimitive.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-slate-700 transition-colors data-[state=checked]:bg-sky-600 disabled:opacity-50"
      >
        <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
      </SwitchPrimitive.Root>
    </div>
  )
}

/** Segmented control (radio buttons styled as a pill group). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'default',
  stretch
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[]
  size?: 'default' | 'sm'
  /** Fill the available width with equally wide options. */
  stretch?: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-md border border-slate-700 bg-slate-950 p-0.5',
        stretch ? 'grid auto-cols-fr grid-flow-col' : 'inline-flex'
      )}
      role="radiogroup"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-2.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            size === 'sm' ? 'py-0.5 text-[11px]' : 'h-[26px] text-xs',
            o.value === value ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-100'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
