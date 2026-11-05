import { CircuitBoard, Cpu, Plus, Settings2, Terminal, Wrench } from 'lucide-react'
import type { MachineProfile } from '@core/model/types'
import { cn } from '@renderer/lib/utils'
import { outputSummary, workAreaSummary } from './machineMeta'

export function MachineIcon({
  machine,
  className
}: {
  machine: MachineProfile
  className?: string
}): React.JSX.Element {
  const Icon = !machine.builtIn
    ? Wrench
    : ({ mach3: Cpu, grbl: CircuitBoard, linuxcnc: Terminal, generic: Settings2 }[machine.postProcessor] ??
      Settings2)
  return <Icon className={className} />
}

/** A selectable machine card (it IS a button). */
export function MachineCard({
  machine,
  selected,
  inUse,
  tag,
  onSelect
}: {
  machine: MachineProfile
  selected: boolean
  inUse: boolean
  tag?: string
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`machine-card-${machine.id}`}
      className={cn(
        'group flex w-full flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-all',
        selected
          ? 'border-sky-500 bg-sky-500/10 shadow-[0_0_0_1px_rgba(14,165,233,0.5)]'
          : 'border-slate-800 bg-slate-950/40 hover:border-slate-600 hover:bg-slate-800/40'
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-md',
            selected ? 'bg-sky-600/30 text-sky-300' : 'bg-slate-800 text-slate-300 group-hover:text-slate-100'
          )}
        >
          <MachineIcon machine={machine} className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-slate-100">{machine.name || 'Unnamed'}</span>
            {inUse && (
              <span className="shrink-0 rounded bg-emerald-600/20 px-1.5 text-[10px] font-semibold text-emerald-300">
                In use
              </span>
            )}
            {tag && (
              <span className="shrink-0 rounded bg-slate-700/60 px-1.5 text-[10px] text-slate-300">
                {tag}
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-400">
            {outputSummary(machine)} · {workAreaSummary(machine)}
          </div>
        </div>
      </div>
      {machine.description && (
        <p className="line-clamp-2 text-[11px] leading-snug text-slate-500">{machine.description}</p>
      )}
    </button>
  )
}

export function AddMachineCard({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="machine-add"
      className="flex min-h-[112px] w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-700 p-3 text-center text-slate-400 transition-colors hover:border-sky-500 hover:bg-sky-500/5 hover:text-sky-300"
    >
      <Plus className="size-6" />
      <span className="text-sm font-medium">Add a new machine</span>
      <span className="text-[11px] text-slate-500">
        Starts from safe generic settings you can adjust to your machine.
      </span>
    </button>
  )
}
