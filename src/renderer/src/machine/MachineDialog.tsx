import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import type { MachineProfile } from '@core/model/types'
import { MACHINE_PRESETS, createCustomMachine, validateMachine } from '@core/machines'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { AddMachineCard, MachineCard } from './MachineCard'
import { MachineDetail } from './MachineDetail'
import { useCustomMachines } from './customMachines'

/**
 * Machine chooser: a single list of built-in presets and the user's own machines on the left, the full
 * profile of the selected one on the right. Rendered only while open (so state resets on every open).
 */
export function MachineDialog({
  current,
  onUse,
  onClose
}: {
  current: MachineProfile | null
  onUse: (m: MachineProfile) => void
  onClose: () => void
}): React.JSX.Element {
  const { machines: saved, setMachines } = useCustomMachines()
  const [selectedId, setSelectedId] = useState<string>(current?.id ?? MACHINE_PRESETS[0].id)
  // A custom machine that came with an opened project but is not in this computer's list yet.
  const [projectOnly, setProjectOnly] = useState<MachineProfile | null>(
    current && !current.builtIn ? current : null
  )

  const custom = useMemo(() => {
    const extra = projectOnly && !saved.some((m) => m.id === projectOnly.id) ? [projectOnly] : []
    return [...extra, ...saved]
  }, [saved, projectOnly])

  const all = useMemo(() => [...MACHINE_PRESETS, ...custom], [custom])
  const selected = all.find((m) => m.id === selectedId) ?? all[0]
  const errors = useMemo(() => validateMachine(selected), [selected])

  const upsert = (m: MachineProfile): void => {
    const i = saved.findIndex((x) => x.id === m.id)
    if (projectOnly?.id === m.id) setProjectOnly(m)
    setMachines(i >= 0 ? saved.map((x) => (x.id === m.id ? m : x)) : [m, ...saved])
  }
  const add = (base?: MachineProfile): void => {
    const m = createCustomMachine(base)
    setMachines([...saved, m])
    setSelectedId(m.id)
  }
  const remove = (id: string): void => {
    const m = custom.find((x) => x.id === id)
    if (!m || !confirm(`Delete the machine "${m.name}"? This cannot be undone.`)) return
    setMachines(saved.filter((x) => x.id !== id))
    if (projectOnly?.id === id) setProjectOnly(null)
    setSelectedId(current && current.id !== id ? current.id : MACHINE_PRESETS[0].id)
  }

  const isInUse = (m: MachineProfile): boolean => !!current && current.id === m.id
  const pendingChanges =
    !!current && current.id === selected.id && JSON.stringify(current) !== JSON.stringify(selected)

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Choose your machine"
      description="Pick the CNC machine you will mill on. Its settings decide what kind of G-code file is written and which safety limits are checked."
      className="w-[min(96vw,1060px)]"
      bodyClassName="overflow-hidden"
      footer={
        <>
          <div className="mr-auto text-xs text-slate-400">
            {errors.length ? (
              <span className="text-rose-400">Fix the highlighted settings to use this machine.</span>
            ) : pendingChanges ? (
              <span className="text-amber-300">
                You changed the machine in use — click “Use this machine” to apply.
              </span>
            ) : (
              <>
                Selected: <span className="text-slate-200">{selected.name}</span>
              </>
            )}
          </div>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="success"
            disabled={errors.length > 0}
            data-testid="machine-use"
            onClick={() => {
              onUse(selected)
              onClose()
            }}
          >
            <Check /> Use this machine
          </Button>
        </>
      }
    >
      <div
        data-testid="machine-dialog"
        className="grid h-[min(66vh,700px)] grid-cols-[minmax(0,1fr)_minmax(0,480px)] gap-4"
      >
        <div className="min-h-0 overflow-y-auto pr-1">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Built-in machines
          </h3>
          <div className="flex flex-col gap-2">
            {MACHINE_PRESETS.map((m) => (
              <MachineCard
                key={m.id}
                machine={m}
                selected={m.id === selected.id}
                inUse={isInUse(m)}
                onSelect={() => setSelectedId(m.id)}
              />
            ))}
          </div>
          <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Your machines
          </h3>
          <div className="flex flex-col gap-2">
            {custom.map((m) => (
              <MachineCard
                key={m.id}
                machine={m}
                selected={m.id === selected.id}
                inUse={isInUse(m)}
                tag={
                  projectOnly?.id === m.id && !saved.some((x) => x.id === m.id) ? 'From project' : undefined
                }
                onSelect={() => setSelectedId(m.id)}
              />
            ))}
            <AddMachineCard onClick={() => add()} />
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40">
          <MachineDetail
            key={selected.id}
            machine={selected}
            errors={errors}
            inUse={isInUse(selected)}
            onChange={upsert}
            onDuplicate={() => add(selected)}
            onDelete={() => remove(selected.id)}
          />
        </div>
      </div>
    </Dialog>
  )
}
