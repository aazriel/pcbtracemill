import * as SwitchPrimitive from '@radix-ui/react-switch'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'
import { HelpTip } from './help'

export interface FieldShellProps {
  label: string
  /** Plain-language explanation shown inline under the field. */
  description?: ReactNode
  /** Longer explanation shown in the (?) tooltip. */
  help?: ReactNode
  error?: string | null
  warning?: string | null
  className?: string
  children: ReactNode
}

export function FieldShell({
  label,
  description,
  help,
  error,
  warning,
  className,
  children
}: FieldShellProps): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
        <span>{label}</span>
        {help && <HelpTip title={label}>{help}</HelpTip>}
      </div>
      {children}
      {description && <p className="text-[11px] leading-snug text-slate-500">{description}</p>}
      {error && <p className="text-[11px] font-medium text-rose-400">✕ {error}</p>}
      {!error && warning && <p className="text-[11px] font-medium text-amber-400">! {warning}</p>}
    </div>
  )
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
  // Local text state lets users type "0." or "-" without being clobbered.
  const [text, setText] = useState(String(value))
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(Number(value.toFixed(6)))))
  }, [value])
  const commit = (t: string): void => {
    const n = Number(t)
    if (t.trim() === '' || !Number.isFinite(n)) {
      setText(String(value))
      return
    }
    let v = n
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    if (v !== n) setText(String(v))
    onChange(v)
  }
  return (
    <FieldShell {...shell}>
      <div className="relative">
        <input
          type="number"
          className={cn(
            inputCls,
            unit && 'pr-12',
            shell.error && 'border-rose-500',
            !shell.error && shell.warning && 'border-amber-500'
          )}
          value={text}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          aria-label={shell.label}
          onChange={(e) => {
            setText(e.target.value)
            const n = Number(e.target.value)
            if (
              e.target.value.trim() !== '' &&
              Number.isFinite(n) &&
              (min === undefined || n >= min) &&
              (max === undefined || n <= max)
            )
              onChange(n)
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
        />
        {unit && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">
            {unit}
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
          {help && <HelpTip title={label}>{help}</HelpTip>}
        </div>
        {description && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{description}</p>}
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
  size = 'default'
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; title?: string }[]
  size?: 'default' | 'sm'
}): React.JSX.Element {
  return (
    <div className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-2.5 font-medium transition-colors',
            size === 'sm' ? 'py-0.5 text-[11px]' : 'py-1 text-xs',
            o.value === value ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-100'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
