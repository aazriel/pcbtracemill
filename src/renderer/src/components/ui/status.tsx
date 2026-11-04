import { Check, X, AlertTriangle } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export type StatusLevel = 'ok' | 'warning' | 'error' | 'pending'

/** Circled status badge: ✓ ready, ! warning, ✕ error, or a hollow circle when not started. */
export function StatusCircle({
  level,
  size = 18,
  title
}: {
  level: StatusLevel
  size?: number
  title?: string
}): React.JSX.Element {
  const cls = {
    ok: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/60',
    warning: 'bg-amber-500/15 text-amber-400 ring-amber-500/60',
    error: 'bg-rose-500/15 text-rose-400 ring-rose-500/60',
    pending: 'bg-transparent text-slate-500 ring-slate-600'
  }[level]
  const icon = {
    ok: <Check strokeWidth={3} />,
    warning: <AlertTriangle strokeWidth={2.5} />,
    error: <X strokeWidth={3} />,
    pending: null
  }[level]
  return (
    <span
      title={title}
      aria-label={title ?? level}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full ring-1.5 ring-2', cls)}
      style={{ width: size, height: size }}
    >
      <span
        style={{ width: size * 0.62, height: size * 0.62 }}
        className="flex [&_svg]:h-full [&_svg]:w-full"
      >
        {icon}
      </span>
    </span>
  )
}
