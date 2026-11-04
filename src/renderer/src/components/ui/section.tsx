import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

export function PanelSection({
  title,
  actions,
  children,
  className,
  collapsible = false,
  defaultOpen = true,
  status
}: {
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  collapsible?: boolean
  defaultOpen?: boolean
  status?: ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={cn('border-b border-slate-800', className)}>
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400"
          onClick={() => collapsible && setOpen(!open)}
        >
          {collapsible && (
            <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
          )}
          {status}
          {title}
        </button>
        <div className="flex items-center gap-1">{actions}</div>
      </header>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  )
}
