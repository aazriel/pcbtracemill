import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import type { EdaTool } from '@core/model/types'
import { suggestProjectName, usedProjectNames } from '@renderer/store/projectNames'
import { Dialog } from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/utils'
import { EDA_INFO } from './eda'

export function EdaDialog({
  open,
  current,
  beforeBrowse,
  askName = false,
  onPick,
  onClose
}: {
  open: boolean
  /** The program used last time (highlighted). */
  current: EdaTool | null
  /** True when a file / folder picker opens right after the choice. */
  beforeBrowse: boolean
  /** A new project: ask for its name too (used in the G-code and the file names). */
  askName?: boolean
  onPick: (e: EdaTool, name?: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  useEffect(() => {
    if (open && askName) setName(suggestProjectName())
  }, [open, askName])
  const trimmed = name.trim()
  const usedBefore = !!trimmed && usedProjectNames().some((n) => n.toLowerCase() === trimmed.toLowerCase())
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Which design program made your files?"
      description={
        beforeBrowse
          ? 'Every PCB design program names its fabrication files differently. Pick yours and the file picker will only show the files it produces, so reports, BOMs and other files stay out of the way.'
          : 'Every PCB design program names its fabrication files differently. Telling us which one you used lets TraceMill pick the right files and ignore reports, BOMs and other files that are not needed for milling.'
      }
    >
      {askName && (
        <label
          className="mb-5 flex flex-col gap-1.5 rounded-lg border-2 border-sky-500/60 bg-sky-500/10 p-3"
          data-testid="project-name-field"
        >
          <span className="text-base font-bold text-sky-100">Name your project</span>
          <input
            value={name}
            autoFocus
            onFocus={(e) => e.target.select()}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-sky-500/70 bg-slate-950 px-3 py-2 text-lg font-semibold text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/40"
            data-testid="project-name"
            aria-label="Project name"
          />
          <span className="text-xs text-slate-300">
            {usedBefore ? (
              <>
                You used this name before.{' '}
                <button
                  type="button"
                  className="font-semibold text-sky-300 hover:underline"
                  onClick={() => setName(suggestProjectName(trimmed))}
                >
                  Use "{suggestProjectName(trimmed)}"
                </button>
              </>
            ) : (
              'Shown in the G-code and used for the file names. Save with Ctrl+S (Cmd+S on a Mac).'
            )}
          </span>
        </label>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="eda-options">
        {EDA_INFO.map((e) => {
          const last = e.id === current
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onPick(e.id, askName && trimmed ? trimmed : undefined)}
              className={cn(
                'relative rounded-lg border bg-slate-950 p-3 text-left transition-colors hover:border-sky-500 hover:bg-slate-800',
                last ? 'border-sky-600/70' : 'border-slate-700'
              )}
              data-testid={`eda-${e.id}`}
            >
              {last && (
                <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-sky-600/20 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                  <Check className="size-3" /> Last used
                </span>
              )}
              <div className="pr-16 font-semibold text-slate-100">{e.name}</div>
              <div className="mt-1 text-xs text-slate-400">{e.blurb}</div>
              <div className="mt-2 font-mono text-[10px] text-slate-500">{e.files}</div>
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        You can change this later in the <span className="text-slate-300">Settings</span> menu.
      </p>
    </Dialog>
  )
}
