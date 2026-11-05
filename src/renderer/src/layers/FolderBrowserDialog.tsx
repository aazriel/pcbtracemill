import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { ArrowUp, ChevronRight, File, FileCheck2, Folder, FolderOpen, HardDrive, Loader2 } from 'lucide-react'
import type { FolderListing, FolderPlace } from '@shared/ipc-types'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

interface FolderPickState {
  request: { extensions: string[]; program: string; resolve: (path: string | null) => void } | null
}

const usePick = create<FolderPickState>()(() => ({ request: null }))

/**
 * Asks the user for a folder with TraceMill's own browser. Unlike the Windows folder picker it
 * also lists the files in each folder (they cannot be chosen), so the user can see the PCB files
 * are there. Resolves to the folder path, or null when cancelled.
 */
export function pickFolder(extensions: string[], program: string): Promise<string | null> {
  return new Promise((resolve) => {
    usePick.getState().request?.resolve(null)
    usePick.setState({ request: { extensions, program, resolve } })
  })
}

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
  const api = window.tracemill

  const go = async (path: string | null): Promise<void> => {
    if (!api) return
    setLoading(true)
    setError(null)
    try {
      setListing(await api.listFolder(path))
    } catch {
      setError('This folder cannot be opened.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!request || !api) return
    void go(null)
    void api.folderPlaces().then(setPlaces)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  if (!request) return null
  const exts = new Set([...request.extensions, 'zip'])
  const finish = (path: string | null): void => {
    request.resolve(path)
    usePick.setState({ request: null })
    setListing(null)
  }
  const matching = listing ? listing.files.filter((f) => exts.has(extOf(f))) : []

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && finish(null)}
      title="Import a folder"
      description={`Open the folder that holds your ${request.program} fabrication files, then press “Import this folder”. Files are shown so you can see what is inside; matching ones are highlighted.`}
      className="w-[min(94vw,880px)]"
      bodyClassName="flex h-[60vh] gap-3 overflow-hidden"
      footer={
        <>
          <span className="mr-auto text-xs text-slate-400" data-testid="folder-browser-count">
            {listing &&
              (matching.length
                ? `${matching.length} matching file${matching.length === 1 ? '' : 's'} in this folder (sub-folders are included too)`
                : 'No matching files directly in this folder (sub-folders are still searched)')}
          </span>
          <Button variant="secondary" onClick={() => finish(null)}>
            Cancel
          </Button>
          <Button
            onClick={() => listing && finish(listing.path)}
            disabled={!listing}
            data-testid="folder-browser-import"
          >
            <FolderOpen /> Import this folder
          </Button>
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
              onClick={() =>
                void go(
                  `${listing.path}${/[\\/]$/.test(listing.path) ? '' : listing.path.includes('\\') ? '\\' : '/'}${f}`
                )
              }
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-slate-200 hover:bg-slate-800"
              title="Open this folder"
            >
              <Folder className="size-4 shrink-0 text-amber-300" />
              <span className="truncate">{f}</span>
            </button>
          ))}
          {listing?.files.map((f) => {
            const match = exts.has(extOf(f))
            return (
              <div
                key={`f:${f}`}
                className={cn(
                  'flex cursor-default select-none items-center gap-2 px-2 py-1 text-sm',
                  match ? 'text-emerald-200' : 'text-slate-500'
                )}
                title={
                  match ? 'Will be imported with this folder' : 'Not a fabrication file; it will be skipped'
                }
                aria-disabled
              >
                {match ? (
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
