import { ChevronRight, CircuitBoard, Factory, PlayCircle, Download } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { StatusCircle, type StatusLevel } from '@renderer/components/ui/status'
import type { Stage } from '@renderer/store/ui'

export const STAGES: { id: Stage; label: string; hint: string; icon: typeof CircuitBoard }[] = [
  {
    id: 'board',
    label: 'Board',
    hint: 'Import your Gerber & drill files and check the layers',
    icon: CircuitBoard
  },
  {
    id: 'manufacture',
    label: 'Manufacture',
    hint: 'Pick the machine, the material and the milling steps',
    icon: Factory
  },
  {
    id: 'simulation',
    label: 'Simulation',
    hint: 'Watch a realistic preview of the milling before you cut',
    icon: PlayCircle
  },
  {
    id: 'export',
    label: 'Export',
    hint: 'Save G-code files and optionally auto-level the board',
    icon: Download
  }
]

export function Stepper({
  stage,
  status,
  onSelect,
  canEnter,
  hints
}: {
  stage: Stage
  status: Record<Stage, StatusLevel>
  /** Plain-language explanation of a stage's status (shown on hover). */
  hints?: Partial<Record<Stage, string>>
  onSelect: (s: Stage) => void
  canEnter: (s: Stage) => boolean
}): React.JSX.Element {
  return (
    <nav className="flex items-center gap-1" aria-label="Process steps">
      {STAGES.map((s, i) => {
        const active = s.id === stage
        const enabled = canEnter(s.id)
        const Icon = s.icon
        return (
          <div key={s.id} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-4 text-slate-600" />}
            <button
              type="button"
              disabled={!enabled}
              title={s.hint}
              data-testid={`stage-${s.id}`}
              onClick={() => onSelect(s.id)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                active
                  ? 'bg-sky-600/20 text-sky-200 ring-1 ring-sky-500/50'
                  : 'text-slate-300 hover:bg-slate-800'
              )}
            >
              <span className="flex size-5 items-center justify-center rounded-full bg-slate-800 text-[11px] text-slate-400">
                {i + 1}
              </span>
              <Icon className="size-4" />
              {s.label}
              <StatusCircle
                level={status[s.id]}
                size={16}
                title={hints?.[s.id] ? `${s.label}: ${hints[s.id]}` : `${s.label}: ${status[s.id]}`}
              />
            </button>
          </div>
        )
      })}
    </nav>
  )
}
