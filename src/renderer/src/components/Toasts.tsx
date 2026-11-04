import { X } from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { cn } from '@renderer/lib/utils'

export function Toasts(): React.JSX.Element {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-96 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-xl',
            t.level === 'success' && 'border-emerald-700 bg-emerald-950 text-emerald-100',
            t.level === 'info' && 'border-sky-700 bg-sky-950 text-sky-100',
            t.level === 'warning' && 'border-amber-700 bg-amber-950 text-amber-100',
            t.level === 'error' && 'border-rose-700 bg-rose-950 text-rose-100'
          )}
        >
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="opacity-70 hover:opacity-100"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
