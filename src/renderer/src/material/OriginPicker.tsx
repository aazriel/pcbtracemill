import type { OriginCorner } from '@core/model/types'
import { cn } from '@renderer/lib/utils'
import { Segmented } from '@renderer/components/ui/fields'
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
 * Mini diagram of the sheet with the board on it (always shown) and five clickable dots for the work
 * zero (X0 Y0), placed on the corners / centre of the sheet or of the board.
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
          <div className="absolute left-[22%] top-[22%] h-[56%] w-[56%] rounded-[2px] border border-emerald-200/80 bg-[#2f6b3a]/85">
            {on === 'board' && dots}
          </div>
          {on === 'stock' && dots}
        </div>
      </div>
      <div className="min-w-0 text-xs font-medium text-sky-300">{originLabel(value, on)}</div>
    </div>
  )
}

/** Which way the job runs from X0 Y0: the opposite side of the origin corner. */
export function jobDirections(o: OriginCorner): { x: 'right' | 'left' | null; y: 'away' | 'toward' | null } {
  if (o === 'center') return { x: null, y: null }
  return { x: o.endsWith('left') ? 'right' : 'left', y: o.startsWith('bottom') ? 'away' : 'toward' }
}

function cornerFor(x: 'right' | 'left', y: 'away' | 'toward'): OriginCorner {
  return `${y === 'away' ? 'bottom' : 'top'}-${x === 'right' ? 'left' : 'right'}` as OriginCorner
}

/**
 * The same choice as the corner dots, said the other way round: which way the job extends from
 * X0 Y0 along each axis (+X to the right or −X to the left, +Y away from you or −Y toward you).
 */
export function JobDirectionPicker({
  value,
  onChange
}: {
  value: OriginCorner
  onChange: (o: OriginCorner) => void
}): React.JSX.Element {
  const d = jobDirections(value)
  const x = d.x ?? 'right'
  const y = d.y ?? 'away'
  return (
    <div className="flex flex-col gap-2" data-testid="material-directions">
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs text-slate-300">
        <span>Along X the job runs</span>
        <Segmented
          stretch
          value={d.x ?? ''}
          onChange={(v) => onChange(cornerFor(v as 'right' | 'left', y))}
          options={[
            { value: 'right', label: '→ right (+X)' },
            { value: 'left', label: '← left (−X)' }
          ]}
        />
        <span>Along Y the job runs</span>
        <Segmented
          stretch
          value={d.y ?? ''}
          onChange={(v) => onChange(cornerFor(x, v as 'away' | 'toward'))}
          options={[
            { value: 'away', label: '↑ away (+Y)' },
            { value: 'toward', label: '↓ toward you (−Y)' }
          ]}
        />
      </div>
      <p className="text-[11px] leading-snug text-slate-500">
        {value === 'center'
          ? 'With X0 Y0 in the centre the job runs both ways; pick a direction to move the zero to a corner.'
          : `All of the job is at ${x === 'right' ? 'positive' : 'negative'} X and ${y === 'away' ? 'positive' : 'negative'} Y. Your machine’s own axis directions do not change.`}
      </p>
    </div>
  )
}
