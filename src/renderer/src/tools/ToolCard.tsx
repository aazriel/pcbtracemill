import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Check, Lock, Sparkles, Ban } from 'lucide-react'
import type { Tool } from '@core/model/types'
import { cn } from '@renderer/lib/utils'
import { ToolPreview } from './ToolPreview'
import { TOOL_ACCENT, TOOL_NOUN, toolSummary } from './toolMeta'

export interface ToolCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  tool: Tool
  active?: boolean
  /** Currently chosen for the step. */
  chosen?: boolean
  recommended?: boolean
  incompatible?: boolean
  unsaved?: boolean
  /** Small explanatory line under the summary. */
  reason?: string
  size?: 'default' | 'sm'
}

/** Selectable tool card with a mini animated preview. forwardRef so it can be a Tooltip trigger. */
export const ToolCard = forwardRef<HTMLButtonElement, ToolCardProps>(function ToolCard(
  { tool, active, chosen, recommended, incompatible, unsaved, reason, size = 'default', className, ...rest },
  ref
) {
  const sm = size === 'sm'
  return (
    <button
      ref={ref}
      type="button"
      data-testid={`tool-card-${tool.id}`}
      aria-pressed={active}
      aria-disabled={incompatible || undefined}
      className={cn(
        'group relative flex w-full items-stretch gap-2.5 rounded-lg border text-left transition-colors',
        sm ? 'p-1.5 pr-2' : 'p-2 pr-2.5',
        active
          ? 'border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/40'
          : 'border-slate-800 bg-slate-900 hover:border-slate-600 hover:bg-slate-800/70',
        incompatible && 'cursor-not-allowed opacity-45 hover:border-slate-800',
        className
      )}
      {...rest}
    >
      <span className="flex shrink-0 items-center justify-center rounded-md bg-slate-950/80">
        <ToolPreview tool={tool} width={sm ? 30 : 38} height={sm ? 52 : 68} compact spinning={!!active} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate font-medium text-slate-100', sm ? 'text-xs' : 'text-[13px]')}>
            {tool.name || 'Unnamed tool'}
          </span>
          {chosen && <Check className="size-3.5 shrink-0 text-emerald-400" aria-label="In use" />}
        </span>
        <span className="truncate text-[11px] text-slate-400">
          <span className={TOOL_ACCENT[tool.type]}>{TOOL_NOUN[tool.type]}</span> · {toolSummary(tool)}
        </span>
        {!sm && (
          <span className="truncate text-[11px] tabular-nums text-slate-500">
            T{tool.number} · {Math.round(tool.feeds.spindleRpm).toLocaleString('en-US')} RPM ·{' '}
            {tool.feeds.feedXY} mm/min
          </span>
        )}
        {reason && (
          <span
            className={cn(
              'line-clamp-2 text-[11px] leading-snug',
              recommended ? 'text-emerald-300/90' : 'text-slate-500'
            )}
          >
            {reason}
          </span>
        )}
        <span className="mt-0.5 flex flex-wrap gap-1 empty:hidden">
          {tool.builtIn && (
            <span className="inline-flex items-center gap-0.5 rounded bg-slate-800 px-1.5 py-px text-[10px] text-slate-400">
              <Lock className="size-2.5" /> Starter kit
            </span>
          )}
          {!tool.builtIn && !unsaved && (
            <span className="rounded bg-sky-900/50 px-1.5 py-px text-[10px] text-sky-300">My tool</span>
          )}
          {unsaved && (
            <span className="rounded bg-amber-900/50 px-1.5 py-px text-[10px] text-amber-300">
              Not saved yet
            </span>
          )}
          {recommended && (
            <span className="inline-flex items-center gap-0.5 rounded bg-emerald-900/50 px-1.5 py-px text-[10px] text-emerald-300">
              <Sparkles className="size-2.5" /> Recommended
            </span>
          )}
          {incompatible && (
            <span className="inline-flex items-center gap-0.5 rounded bg-rose-900/40 px-1.5 py-px text-[10px] text-rose-300">
              <Ban className="size-2.5" /> Not for this step
            </span>
          )}
        </span>
      </span>
    </button>
  )
})
