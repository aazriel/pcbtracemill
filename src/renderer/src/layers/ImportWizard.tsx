import { Fragment, useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileArchive,
  Files,
  FolderOpen,
  Info,
  CircleAlert,
  CircleCheck,
  CircleDashed
} from 'lucide-react'
import type { EdaTool } from '@core/model/types'
import {
  pickProjectFolder,
  projectNameTaken,
  projectPathFor,
  refreshProjectFiles,
  suggestProjectName,
  useProjectFolder
} from '@renderer/store/projectNames'
import type { BrowseKind } from '@renderer/store/ui'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { EDA_INFO, EXPORT_GUIDES, edaInfo } from './eda'

/**
 * Import in three steps: 1. which design program (with how to export from it and which layers are
 * needed), 2. files, a folder or a ZIP, 3. PCB TraceMill's own file browser. Files that were dropped
 * on the window only need step 1.
 */
export function ImportWizard({
  open,
  startStep,
  kind,
  current,
  droppedCount,
  askName = false,
  onBrowse,
  onImportDropped,
  onClose
}: {
  open: boolean
  startStep: 1 | 2
  /** Import type to highlight in step 2 (e.g. from the Import Folder… menu). */
  kind: BrowseKind | null
  /** The program used last time (selected at the start). */
  current: EdaTool | null
  /** Files dropped on the window, waiting for the program (0 = none). */
  droppedCount: number
  /** A new project: ask for its name too (used in the G-code and the file names). */
  askName?: boolean
  onBrowse: (e: EdaTool, kind: BrowseKind, name?: string) => void
  onImportDropped: (e: EdaTool, name?: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [step, setStep] = useState<1 | 2>(startStep)
  const [eda, setEda] = useState<EdaTool | null>(current)
  const [name, setName] = useState('')
  const { folder } = useProjectFolder()

  useEffect(() => {
    if (!open) return
    setStep(droppedCount ? 1 : startStep)
    setEda(current)
  }, [open, startStep, current, droppedCount])

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
  const projectName = askName && trimmed ? trimmed : undefined
  const info = edaInfo(eda)
  const guide = eda ? EXPORT_GUIDES[eda] : null

  const next = (): void => {
    if (!eda) return
    if (droppedCount) onImportDropped(eda, projectName)
    else setStep(2)
  }

  const footer =
    step === 1 ? (
      <>
        <span className="mr-auto text-[11px] text-slate-500">
          You can change the program later in the <span className="text-slate-300">Settings</span> menu.
        </span>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!eda}
          onClick={next}
          className="bg-green-500 font-bold text-slate-950 hover:bg-green-400"
          data-testid="import-next"
        >
          {droppedCount
            ? `Import ${droppedCount} file${droppedCount === 1 ? '' : 's'}`
            : 'Next: how to import'}{' '}
          <ArrowRight />
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" onClick={() => setStep(1)} className="mr-auto" data-testid="import-back">
          <ArrowLeft /> Back
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </>
    )

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Import your PCB files"
      className="w-[min(94vw,900px)]"
      footer={footer}
    >
      <Steps step={droppedCount ? 1 : step} dropped={droppedCount > 0} />

      {step === 1 && (
        <div data-testid="import-step-1">
          {askName && (
            <ProjectNameField
              name={name}
              setName={setName}
              folder={folder}
              taken={taken}
              path={path}
              trimmed={trimmed}
            />
          )}
          <h3 className="mb-2 text-sm font-semibold text-slate-200">Which design program made your files?</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="eda-options" role="radiogroup">
            {EDA_INFO.map((e) => {
              const sel = e.id === eda
              return (
                <button
                  key={e.id}
                  type="button"
                  role="radio"
                  aria-checked={sel}
                  onClick={() => setEda(e.id)}
                  onDoubleClick={() => {
                    setEda(e.id)
                    if (droppedCount) onImportDropped(e.id, projectName)
                    else setStep(2)
                  }}
                  className={cn(
                    'relative flex min-h-16 flex-col items-start justify-center rounded-lg border-2 px-3 py-2 text-left transition-colors',
                    sel
                      ? 'border-green-500 bg-green-500/10'
                      : 'border-slate-700 bg-slate-950 hover:border-sky-500 hover:bg-slate-800'
                  )}
                  data-testid={`eda-${e.id}`}
                >
                  {sel && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-green-500 p-0.5 text-slate-950">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  )}
                  <span className="pr-4 text-sm font-semibold leading-tight text-slate-100">{e.short}</span>
                  {e.id === current && (
                    <span className="mt-0.5 text-[10px] font-medium text-sky-300">Last used</span>
                  )}
                </button>
              )
            })}
          </div>

          {info && guide ? (
            <div
              className="mt-3 grid gap-4 rounded-lg border border-slate-700 bg-slate-950/70 p-4 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
              data-testid="export-guide"
            >
              <div>
                <h4 className="text-sm font-semibold text-sky-200">How to export from {info.name}</h4>
                <ol className="mt-2 flex flex-col gap-1.5">
                  {guide.steps.map((s, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-snug text-slate-300">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sky-600/30 text-[11px] font-bold text-sky-200">
                        {i + 1}
                      </span>
                      <span>
                        <Rich text={s} />
                      </span>
                    </li>
                  ))}
                </ol>
                {guide.note && (
                  <p className="mt-3 flex gap-1.5 text-[11px] leading-snug text-slate-400">
                    <Info className="mt-px size-3.5 shrink-0 text-sky-400" /> {guide.note}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <h4 className="text-sm font-semibold text-sky-200">What to export</h4>
                <Need
                  level="required"
                  title="Must have"
                  why="Without it there is nothing to mill."
                  items={guide.required}
                />
                <Need
                  level="recommended"
                  title="Strongly recommended"
                  why="Needed to drill the holes and cut the board out."
                  items={guide.recommended}
                />
                <Need
                  level="optional"
                  title="Optional"
                  why="For looks or reference. Not needed for milling."
                  items={guide.optional}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-slate-700 p-4 text-center text-sm text-slate-400">
              Pick your design program to see how to export the files from it, and which ones are needed.
            </p>
          )}
        </div>
      )}

      {step === 2 && info && guide && (
        <div data-testid="import-step-2">
          <h3 className="text-sm font-semibold text-slate-200">How would you like to import them?</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            The file browser then only shows {info.short} fabrication files, so reports and BOMs stay out of
            the way.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <KindCard
              kind="files"
              icon={<Files className="size-8" />}
              title="Files"
              text="Pick the files one by one, or several at once."
              best={guide.best === 'files'}
              marked={kind === 'files'}
              onClick={() => onBrowse(info.id, 'files', projectName)}
            />
            <KindCard
              kind="folder"
              icon={<FolderOpen className="size-8" />}
              title="Folder"
              text="The folder your design program exported to. The right files are picked for you."
              best={guide.best === 'folder'}
              marked={kind === 'folder'}
              onClick={() => onBrowse(info.id, 'folder', projectName)}
            />
            <KindCard
              kind="zip"
              icon={<FileArchive className="size-8" />}
              title="ZIP file"
              text="One archive with everything in it, imported as it is."
              best={guide.best === 'zip'}
              marked={kind === 'zip'}
              onClick={() => onBrowse(info.id, 'zip', projectName)}
            />
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Tip: you can also drag the files, the folder or the ZIP straight onto the main window.
          </p>
        </div>
      )}
    </Dialog>
  )
}

function Steps({ step, dropped }: { step: 1 | 2; dropped: boolean }): React.JSX.Element {
  const labels = dropped ? ['Design program'] : ['Design program', 'Files, folder or ZIP', 'Choose them']
  return (
    <ol className="mb-4 flex items-center gap-2 text-xs" data-testid="import-steps">
      {labels.map((l, i) => {
        const n = i + 1
        const done = n < step
        const now = n === step
        return (
          <Fragment key={l}>
            {i > 0 && <span className="h-px w-6 bg-slate-700 sm:w-10" />}
            <li
              className={cn(
                'flex items-center gap-1.5',
                now ? 'font-semibold text-slate-100' : done ? 'text-green-300' : 'text-slate-500'
              )}
            >
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full text-[11px] font-bold',
                  now
                    ? 'bg-green-500 text-slate-950'
                    : done
                      ? 'bg-green-500/25 text-green-300'
                      : 'bg-slate-800 text-slate-500'
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : n}
              </span>
              {l}
            </li>
          </Fragment>
        )
      })}
    </ol>
  )
}

function Need({
  level,
  title,
  why,
  items
}: {
  level: 'required' | 'recommended' | 'optional'
  title: string
  why: string
  items: string[]
}): React.JSX.Element {
  const Icon = level === 'required' ? CircleAlert : level === 'recommended' ? CircleCheck : CircleDashed
  return (
    <div data-testid={`need-${level}`}>
      <div
        className={cn(
          'flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide',
          level === 'required'
            ? 'text-rose-300'
            : level === 'recommended'
              ? 'text-amber-300'
              : 'text-slate-400'
        )}
      >
        <Icon className="size-3.5" /> {title}
      </div>
      <p className="text-[11px] text-slate-500">{why}</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {items.map((t) => (
          <li key={t} className="text-[12px] leading-snug text-slate-300">
            • <Rich text={t} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function KindCard({
  kind,
  icon,
  title,
  text,
  best,
  marked,
  onClick
}: {
  kind: BrowseKind
  icon: React.ReactNode
  title: string
  text: string
  best: boolean
  marked: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center gap-2 rounded-xl border-2 bg-slate-950 px-4 pb-4 pt-6 text-center transition-colors hover:border-green-500 hover:bg-green-500/10',
        marked || best ? 'border-sky-500/70' : 'border-slate-700'
      )}
      data-testid={`import-${kind}`}
    >
      {best && (
        <span className="absolute right-2 top-2 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200">
          Best for this program
        </span>
      )}
      <span className="text-sky-300">{icon}</span>
      <span className="text-base font-bold text-slate-100">{title}</span>
      <span className="text-xs leading-snug text-slate-400">{text}</span>
    </button>
  )
}

/** Shows `**bold**` parts in bold. */
function Rich({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <b key={i} className="font-semibold text-slate-100">
            {p}
          </b>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        )
      )}
    </>
  )
}

function ProjectNameField({
  name,
  setName,
  folder,
  taken,
  path,
  trimmed
}: {
  name: string
  setName: (n: string) => void
  folder: string | null
  taken: boolean
  path: string | null
  trimmed: string
}): React.JSX.Element {
  return (
    <div
      className="mb-4 flex flex-col gap-1.5 rounded-lg border-2 border-sky-500/60 bg-sky-500/10 p-3"
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
        {window.tracemill && (
          <button
            type="button"
            title={
              folder
                ? `Saved in ${folder}. Click to choose another folder.`
                : 'Choose the folder new projects are saved in.'
            }
            onClick={() => void pickProjectFolder()}
            className="flex max-w-[45%] items-center gap-1.5 rounded-md border border-slate-600 bg-slate-900 px-3 text-sm text-slate-200 hover:border-sky-500 hover:bg-slate-800"
            data-testid="project-folder"
          >
            <FolderOpen className="size-4 shrink-0 text-sky-300" />
            <bdi dir="ltr" className="truncate">
              {folder ? shortFolder(folder) : 'Choose a folder…'}
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
              Use &quot;{suggestProjectName(trimmed)}&quot;
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
  )
}

/** "C:\Users\me\Documents\pcb" -> "…\Documents\pcb" (the full path is in the tooltip). */
function shortFolder(f: string): string {
  const parts = f.split(/[\\/]+/).filter(Boolean)
  const sep = f.includes('\\') ? '\\' : '/'
  return parts.length > 2 ? `…${sep}${parts.slice(-2).join(sep)}` : f
}
