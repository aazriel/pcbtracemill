import { useEffect, useState } from 'react'
import { Check, FolderOpen } from 'lucide-react'
import type { EdaTool } from '@core/model/types'
import {
  pickProjectFolder,
  projectNameTaken,
  projectPathFor,
  refreshProjectFiles,
  suggestProjectName,
  useProjectFolder
} from '@renderer/store/projectNames'
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
  const { folder } = useProjectFolder()
  useEffect(() => {
    if (!open || !askName) return
    let live = true
    setName(suggestProjectName())
    // the files in the folder may have changed since the app started
    void refreshProjectFiles().then(() => live && setName(suggestProjectName()))
    return () => {
      live = false
    }
  }, [open, askName])
  const trimmed = name.trim()
  const taken = !!trimmed && projectNameTaken(trimmed)
  const path = trimmed ? projectPathFor(trimmed) : null
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Which design program made your files?"
      description={
        beforeBrowse
          ? 'Every PCB design program names its fabrication files differently. Pick yours and the file picker will only show the files it produces, so reports, BOMs and other files stay out of the way.'
          : 'Every PCB design program names its fabrication files differently. Telling us which one you used lets PCB TraceMill pick the right files and ignore reports, BOMs and other files that are not needed for milling.'
      }
    >
      {askName && (
        <div
          className="mb-5 flex flex-col gap-1.5 rounded-lg border-2 border-sky-500/60 bg-sky-500/10 p-3"
          data-testid="project-name-field"
        >
          <label htmlFor="project-name" className="text-base font-bold text-sky-100">
            Name your project
          </label>
          <div className="flex items-stretch gap-2">
            <input
              id="project-name"
              value={name}
              autoFocus
              spellCheck={false}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setName(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-sky-500/70 bg-slate-950 px-3 py-2 text-lg font-semibold text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/40"
              data-testid="project-name"
              aria-label="Project name"
            />
            {folder && (
              <button
                type="button"
                title={`Saved in ${folder}. Click to choose another folder.`}
                onClick={() => void pickProjectFolder()}
                className="flex max-w-[45%] items-center gap-1.5 rounded-md border border-slate-600 bg-slate-900 px-3 text-sm text-slate-200 hover:border-sky-500 hover:bg-slate-800"
                data-testid="project-folder"
              >
                <FolderOpen className="size-4 shrink-0 text-sky-300" />
                <bdi dir="ltr" className="truncate">
                  {shortFolder(folder)}
                </bdi>
              </button>
            )}
          </div>
          <span className="text-xs text-slate-300">
            {taken ? (
              <>
                <span className="text-amber-300">A project with this name is already in this folder.</span>{' '}
                <button
                  type="button"
                  className="font-semibold text-sky-300 hover:underline"
                  onClick={() => setName(suggestProjectName(trimmed))}
                >
                  Use "{suggestProjectName(trimmed)}"
                </button>
              </>
            ) : path ? (
              <>
                Ctrl+S (Cmd+S on a Mac) saves it as{' '}
                <bdi dir="ltr" className="font-mono text-slate-200">
                  {path}
                </bdi>
              </>
            ) : (
              'Shown in the G-code and used for the file names. Save with Ctrl+S (Cmd+S on a Mac).'
            )}
          </span>
        </div>
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

/** "C:\Users\me\Documents\pcb" -> "…\Documents\pcb" (the full path is in the tooltip). */
function shortFolder(f: string): string {
  const parts = f.split(/[\\/]+/).filter(Boolean)
  const sep = f.includes('\\') ? '\\' : '/'
  return parts.length > 2 ? `…${sep}${parts.slice(-2).join(sep)}` : f
}
