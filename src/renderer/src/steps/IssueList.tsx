import { AlertTriangle, XCircle } from 'lucide-react'
import type { ValidationIssue } from '@core/model/types'
import { cn } from '@renderer/lib/utils'

/** Errors first, then warnings; each in its own colour with a plain-language message. */
export function IssueList({
  issues,
  className
}: {
  issues: ValidationIssue[]
  className?: string
}): React.JSX.Element | null {
  const list = issues
    .filter((i) => i.level !== 'ok')
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
  if (!list.length) return null
  return (
    <ul className={cn('flex flex-col gap-1', className)} data-testid="issue-list">
      {list.map((i, k) => (
        <li
          key={k}
          className={cn(
            'flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11.5px] leading-snug',
            i.level === 'error'
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
          )}
        >
          {i.level === 'error' ? (
            <XCircle className="mt-px size-3.5 shrink-0 text-rose-400" />
          ) : (
            <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-400" />
          )}
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  )
}
