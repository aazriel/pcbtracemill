import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { ArrowUp, ChevronRight, File, FileCheck2, Folder, FolderOpen, HardDrive, Loader2 } from 'lucide-react'
import type { FolderListing, FolderPlace } from '@shared/ipc-types'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

interface FolderPickRequest {
  extensions: string[]
  program: string
  resolve: (path: string | null) => void
  /** Folder shown first (null: the home folder). */
  start?: string | null
  /** Choosing where projects are saved (instead of a folder to import). */
  saveTo?: boolean
  /** Choosing files instead of a folder: one or several of the highlighted files. */
  files?: 'one' | 'many'
  /** Files mode: every file can be chosen, not only the highlighted ones. */
  anyFile?: boolean
  /** Files mode: title of the window. */
  title?: string
  /** Files mode: resolves with the chosen paths. */
  resolveFiles?: (paths: string[] | null) => void
}

interface FolderPickState {
  request: FolderPickRequest | null
}

const usePick = create<FolderPickState>()(() => ({ request: null }))

function cancelOpen(): void {
  const r = usePick.getState().request
  r?.resolve(null)
  r?.resolveFiles?.(null)
}

/**
 * Asks the user for a folder with PCB TraceMill's own browser. Unlike the Windows folder picker it
 * also lists the files in each folder (they cannot be chosen), so the user can see the PCB files
 * are there. Resolves to the folder path, or null when cancelled.
 */
export function pickFolder(
  extensions: string[],
  program: string,
  start?: string | null
): Promise<string | null> {
  return new Promise((resolve) => {
    cancelOpen()
    usePick.setState({ request: { extensions, program, resolve, start } })
  })
}

/** The same browser, for choosing where new projects are saved (shows the .tmill projects inside). */
export function pickSaveFolder(start: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    cancelOpen()
    usePick.setState({ request: { extensions: ['tmill'], program: '', resolve, start, saveTo: true } })
  })
}

/**
 * The same browser for choosing files (PCB TraceMill's own window instead of the Windows file dialog,
 * D-043). Resolves to the chosen paths, or null when cancelled.
 */
export function pickFiles(opts: {
  extensions: string[]
  title: string
  multiple?: boolean
  anyFile?: boolean
  start?: string | null
}): Promise<string[] | null> {
  return new Promise((resolveFiles) => {
    cancelOpen()
    usePick.setState({
      request: {
        extensions: opts.extensions,
        program: '',
        resolve: () => undefined,
        resolveFiles,
        start: opts.start,
        files: opts.multiple ? 'many' : 'one',
        anyFile: opts.anyFile,
        title: opts.title
      }
    })
  })
}

const joinPath = (dir: string, name: string): string =>
  `${dir}${/[\\/]$/.test(dir) ? '' : dir.includes('\\') ? '\\' : '/'}${name}`

const extOf = (name: string): string => /\.([^.]+)$/.exec(name)?.[1].toLowerCase() ?? ''

/** Splits a path into clickable breadcrumb parts. */
function crumbs(path: string): { label: string; path: string }[] {
  const sep = path.includes('\\') ? '\\' : '/'
  const parts = path.split(/[\\/]/).filter(Boolean)
  const out: { label: string; path: string }[] = []
  let acc = path.startsWith('/') ? '/' : ''
  parts.forEach((p, i) => {
    acc = i === 0 ? (acc === '/' ? `/${p}` : `${p}${sep}`) : `${acc}${acc.endsWith(sep) ? '' : sep}${p}`
    out.push({ label: p, path: acc })
  })
  return out
}

export function FolderBrowserDialog(): React.JSX.Element | null {
  const request = usePick((s) => s.request)
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [places, setPlaces] = useState<FolderPlace[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const api = window.tracemill

  const go = async (path: string | null, fallBack = false): Promise<void> => {
    if (!api) return
    setLoading(true)
    setError(null)
    try {
      setListing(await api.listFolder(path))
      setChosen([])
    } catch {
      if (fallBack && path) {
        setLoading(false)
        return go(null)
      }
      setError('This folder cannot be opened.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!request || !api) return
    // a folder that no longer exists falls back to the home folder
    void go(request.start ?? null, true)
    void api.folderPlaces().then(setPlaces)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  if (!request) return null
  const saveTo = !!request.saveTo
  const filesMode = request.files
  const exts = new Set(saveTo || filesMode ? request.extensions : [...request.extensions, 'zip'])
  const close = (): void => {
    usePick.setState({ request: null })
    setListing(null)
    setChosen([])
  }
  const finish = (path: string | null): void => {
    if (filesMode) request.resolveFiles?.(null)
    else request.resolve(path)
    close()
  }
  const finishFiles = (names: string[]): void => {
    if (!listing || !names.length) return
    // the next file window opens in this folder again
    void api?.settingsSet('lastImportFolder', listing.path)
    request.resolveFiles?.(names.map((n) => joinPath(listing.path, n)))
    close()
  }
  const matching = listing ? listing.files.filter((f) => exts.has(extOf(f))) : []
  const choosable = (f: string): boolean => !!filesMode && (!!request.anyFile || exts.has(extOf(f)))
  const toggle = (f: string): void =>
    setChosen((c) => (filesMode === 'one' ? [f] : c.includes(f) ? c.filter((x) => x !== f) : [...c, f]))

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && finish(null)}
      title={
        filesMode
          ? (request.title ?? 'Open files')
          : saveTo
            ? 'Where to save your projects'
            : 'Import a folder'
      }
      description={
        filesMode
          ? filesMode === 'many'
            ? 'Click the files to choose them (the files that fit are highlighted), then press “Open”. A double-click opens one file at once.'
            : 'Click a file, then press “Open” – or double-click it.'
          : saveTo
            ? 'Open the folder new projects should be saved in, then press “Save projects here”. Projects already in a folder are highlighted.'
            : `Open the folder that holds your ${request.program} fabrication files, then press “Import this folder”. Files are shown so you can see what is inside; matching ones are highlighted.`
      }
      className="w-[min(94vw,880px)]"
      bodyClassName="flex h-[60vh] gap-3 overflow-hidden"
      footer={
        <>
          <span className="mr-auto text-xs text-slate-400" data-testid="folder-browser-count">
            {listing &&
              (filesMode
                ? chosen.length
                  ? `${chosen.length} file${chosen.length === 1 ? '' : 's'} chosen`
                  : `${matching.length} file${matching.length === 1 ? '' : 's'} that fit in this folder`
                : saveTo
                  ? `${matching.length} project${matching.length === 1 ? '' : 's'} in this folder`
                  : matching.length
                    ? `${matching.length} matching file${matching.length === 1 ? '' : 's'} in this folder (sub-folders are included too)`
                    : 'No matching files directly in this folder (sub-folders are still searched)')}
          </span>
          <Button variant="secondary" onClick={() => finish(null)}>
            Cancel
          </Button>
          {filesMode ? (
            <Button
              onClick={() => finishFiles(chosen)}
              disabled={!chosen.length}
              data-testid="file-browser-open"
            >
              <FolderOpen /> Open{chosen.length > 1 ? ` ${chosen.length} files` : ''}
            </Button>
          ) : (
            <Button
              onClick={() => listing && finish(listing.path)}
              disabled={!listing}
              data-testid="folder-browser-import"
            >
              <FolderOpen /> {saveTo ? 'Save projects here' : 'Import this folder'}
            </Button>
          )}
        </>
      }
    >
      <nav className="flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-slate-800 pr-2 text-sm">
        {places.map((p) => (
          <button
            key={p.path}
            onClick={() => void go(p.path)}
            className={cn(
              'flex items-center gap-2 rounded px-2 py-1.5 text-left text-slate-300 hover:bg-slate-800',
              listing?.path === p.path && 'bg-slate-800 text-slate-100'
            )}
          >
            {p.kind === 'drive' ? (
              <HardDrive className="size-4 text-slate-400" />
            ) : (
              <Folder className="size-4 text-amber-300" />
            )}
            {p.label}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="icon"
            disabled={!listing?.parent}
            onClick={() => listing?.parent && void go(listing.parent)}
            aria-label="Up one folder"
          >
            <ArrowUp />
          </Button>
          <div
            className="flex min-w-0 flex-1 items-center overflow-x-auto rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-sm"
            data-testid="folder-browser-path"
          >
            {listing &&
              crumbs(listing.path).map((c, i, all) => (
                <span key={c.path} className="flex shrink-0 items-center">
                  <button
                    onClick={() => void go(c.path)}
                    className={cn(
                      'rounded px-1 hover:bg-slate-800',
                      i === all.length - 1 ? 'font-medium text-slate-100' : 'text-slate-400'
                    )}
                  >
                    {c.label}
                  </button>
                  {i < all.length - 1 && <ChevronRight className="size-3.5 text-slate-600" />}
                </span>
              ))}
          </div>
          {loading && <Loader2 className="size-4 animate-spin text-slate-400" />}
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/40 p-1"
          data-testid="folder-browser-list"
        >
          {error && <p className="p-3 text-sm text-rose-300">{error}</p>}
          {listing && !listing.folders.length && !listing.files.length && (
            <p className="p-3 text-sm text-slate-500">This folder is empty.</p>
          )}
          {listing?.folders.map((f) => (
            <button
              key={`d:${f}`}
              onClick={() => void go(joinPath(listing.path, f))}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-slate-200 hover:bg-slate-800"
              title="Open this folder"
            >
              <Folder className="size-4 shrink-0 text-amber-300" />
              <span className="truncate">{f}</span>
            </button>
          ))}
          {listing?.files.map((f) => {
            const match = exts.has(extOf(f))
            if (choosable(f)) {
              const on = chosen.includes(f)
              return (
                <button
                  key={`f:${f}`}
                  type="button"
                  onClick={() => toggle(f)}
                  onDoubleClick={() => finishFiles([f])}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm',
                    on ? 'bg-sky-600/30 text-white ring-1 ring-sky-500/70' : 'hover:bg-slate-800',
                    !on && (match ? 'text-emerald-200' : 'text-slate-300')
                  )}
                  data-testid="file-browser-file"
                  aria-pressed={on}
                >
                  {match ? (
                    <FileCheck2 className="size-4 shrink-0 text-emerald-400" />
                  ) : (
                    <File className="size-4 shrink-0 text-slate-500" />
                  )}
                  <span className="truncate">{f}</span>
                </button>
              )
            }
            return (
              <div
                key={`f:${f}`}
                className={cn(
                  'flex cursor-default select-none items-center gap-2 px-2 py-1 text-sm',
                  match && !filesMode ? 'text-emerald-200' : 'text-slate-500'
                )}
                title={
                  filesMode
                    ? 'This kind of file can’t be opened here'
                    : saveTo
                      ? match
                        ? 'A PCB TraceMill project'
                        : undefined
                      : match
                        ? 'Will be imported with this folder'
                        : 'Not a fabrication file; it will be skipped'
                }
                aria-disabled
              >
                {match && !filesMode ? (
                  <FileCheck2 className="size-4 shrink-0 text-emerald-400" />
                ) : (
                  <File className="size-4 shrink-0 text-slate-600" />
                )}
                <span className="truncate">{f}</span>
              </div>
            )
          })}
        </div>
      </div>
    </Dialog>
  )
}
