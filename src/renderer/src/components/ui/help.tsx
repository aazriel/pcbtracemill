import { HelpCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tooltip } from './tooltip'

/** Small (?) icon that explains a concept in plain language. Every input in TraceMill has one. */
export function HelpTip({ title, children }: { title?: string; children: ReactNode }): React.JSX.Element {
  return (
    <Tooltip
      content={
        <div>
          {title && <div className="mb-1 font-semibold text-slate-100">{title}</div>}
          <div className="text-slate-300">{children}</div>
        </div>
      }
    >
      <button
        type="button"
        tabIndex={-1}
        className="text-slate-500 hover:text-sky-400"
        aria-label={title ? `Help: ${title}` : 'Help'}
      >
        <HelpCircle className="size-3.5" />
      </button>
    </Tooltip>
  )
}
