import { AlertTriangle, MapPin, XCircle } from 'lucide-react'
import type { ValidationIssue } from '@core/model/types'
import { cn } from '@renderer/lib/utils'

/** Errors first, then warnings; each in its own colour with a plain-language message. */
export function IssueList({
  issues,
  className,
  onShowOnBoard
}: {
  issues: ValidationIssue[]
  className?: string
  /** Adds a "Show on board" button to issues about places that cannot be machined. */
  onShowOnBoard?: () => void
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
          <span className="min-w-0 flex-1">{i.message}</span>
          {onShowOnBoard && /show on board/i.test(i.message) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onShowOnBoard()
              }}
              className="shrink-0 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/30"
              data-testid="show-on-board"
            >
              <MapPin className="mr-1 inline size-3" />
              Show on board
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
