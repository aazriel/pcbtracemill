import { useMemo, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { validateMachine } from '@core/machines'
import { useProject } from '@renderer/store/project'
import { Button } from '@renderer/components/ui/button'
import { HelpTip } from '@renderer/components/ui/help'
import { PanelSection } from '@renderer/components/ui/section'
import { StatusCircle } from '@renderer/components/ui/status'
import { CapabilityBadge, MachineIcon } from './MachineCard'
import { MachineDialog } from './MachineDialog'
import { CAPABILITIES, outputSummary, workAreaSummary } from './machineMeta'

/** Manufacture-stage panel section: shows the selected machine and opens the machine chooser. */
export function MachineSection(): React.JSX.Element {
  const machine = useProject((s) => s.machine)
  const setMachine = useProject((s) => s.setMachine)
  const [open, setOpen] = useState(false)
  const errors = useMemo(() => (machine ? validateMachine(machine) : []), [machine])
  const level = !machine ? 'pending' : errors.length ? 'error' : 'ok'

  return (
    <PanelSection
      title="Machine"
      status={
        <StatusCircle
          level={level}
          size={14}
          title={!machine ? 'No machine chosen' : errors.length ? errors[0] : 'Machine ready'}
        />
      }
      actions={
        <>
          <HelpTip title="Machine">
            The CNC machine you will mill on. It decides the G-code dialect, file type, speed limits and the
            heights the bit lifts to between cuts.
          </HelpTip>
        </>
      }
    >
      {machine ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-left transition-colors hover:border-slate-600"
          data-testid="machine-summary"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-slate-800 text-sky-300">
              <MachineIcon machine={machine} className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-100" title={machine.name}>
                {machine.name}
              </div>
              <div className="text-[11px] text-slate-400">Output: {outputSummary(machine)}</div>
              <div className="text-[11px] text-slate-500">Work area {workAreaSummary(machine)}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {CAPABILITIES.map((c) => (
              <CapabilityBadge key={c.key} label={c.label} active={!!machine[c.key]} title={c.short} />
            ))}
          </div>
          {errors.length > 0 && <p className="text-[11px] font-medium text-rose-400">✕ {errors[0]}</p>}
        </button>
      ) : (
        <p className="text-xs text-slate-500">
          No machine chosen yet. Click <span className="text-slate-300">Choose machine</span> to pick the CNC
          machine you will mill on.
        </p>
      )}
      <Button
        variant="secondary"
        className="mt-2 h-9 w-full"
        onClick={() => setOpen(true)}
        data-testid="machine-change"
      >
        <ArrowLeftRight /> {machine ? 'Change machine' : 'Choose machine'}
      </Button>
      {open && <MachineDialog current={machine} onUse={setMachine} onClose={() => setOpen(false)} />}
    </PanelSection>
  )
}
