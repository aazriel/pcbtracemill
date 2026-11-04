import type { OriginCorner } from '@core/model/types'
import { cn } from '@renderer/lib/utils'
import { ORIGIN_LABEL } from './materialIssues'

const SPOTS: { id: OriginCorner; x: string; y: string }[] = [
  { id: 'top-left', x: '0%', y: '0%' },
  { id: 'top-right', x: '100%', y: '0%' },
  { id: 'center', x: '50%', y: '50%' },
  { id: 'bottom-left', x: '0%', y: '100%' },
  { id: 'bottom-right', x: '100%', y: '100%' }
]

export function originLabel(o: OriginCorner, on: 'stock' | 'board'): string {
  if (o === 'center') return on === 'board' ? 'Centre of the board' : 'Centre of the material'
  return `${ORIGIN_LABEL[o]}${on === 'board' ? ' of the board' : ''}`
}

/**
 * Mini diagram with five clickable dots for the work zero (X0 Y0): on the corners / centre of the
 * copper-clad sheet, or of the board placed on it.
 */
export function OriginPicker({
  value,
  on,
  onChange
}: {
  value: OriginCorner
  on: 'stock' | 'board'
  onChange: (o: OriginCorner) => void
}): React.JSX.Element {
  const dots = SPOTS.map((s) => {
    const active = s.id === value
    return (
      <button
        key={s.id}
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={originLabel(s.id, on)}
        title={originLabel(s.id, on)}
        onClick={() => onChange(s.id)}
        data-testid={`material-origin-${s.id}`}
        style={{ left: s.x, top: s.y }}
        className="absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      >
        {active && <span className="absolute size-6 animate-ping rounded-full bg-sky-400/50" />}
        <span
          className={cn(
            'relative rounded-full border-2 transition-all',
            active
              ? 'size-4 border-slate-950 bg-sky-400'
              : 'size-3 border-slate-900/70 bg-slate-200/70 hover:bg-white'
          )}
        />
      </button>
    )
  })
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0 px-3 py-3">
        <div className="relative h-[84px] w-[132px] rounded-sm border border-[#f5c08a]/70 bg-gradient-to-br from-[#c47f45] via-[#e3a46c] to-[#a8622e] shadow-inner">
          <span className="absolute inset-x-0 -bottom-5 text-center text-[9px] uppercase tracking-wider text-slate-500">
            front (you)
          </span>
          {on === 'board' ? (
            <div className="absolute left-[22%] top-[22%] h-[56%] w-[56%] rounded-[2px] border border-emerald-200/80 bg-[#2f6b3a]/85">
              {dots}
            </div>
          ) : (
            dots
          )}
        </div>
      </div>
      <div className="min-w-0 text-xs font-medium text-sky-300">{originLabel(value, on)}</div>
    </div>
  )
}
