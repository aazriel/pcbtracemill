import { useState, type ReactNode } from 'react'
import { FileUp, FolderOpen, Files, FileArchive } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import type { BrowseKind } from '@renderer/store/ui'

export interface DroppedFile {
  name: string
  data: string | Uint8Array
}

/** Reads dropped files (and folders, recursively) in the browser. */
export async function readDataTransfer(dt: DataTransfer): Promise<DroppedFile[]> {
  const out: DroppedFile[] = []
  const entries = Array.from(dt.items)
    .map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => !!e)
  if (entries.length) {
    const walk = async (entry: FileSystemEntry): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
        out.push(await readFile(file))
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        const children = await new Promise<FileSystemEntry[]>((res, rej) => {
          const all: FileSystemEntry[] = []
          const next = (): void =>
            reader.readEntries((batch) => {
              if (!batch.length) res(all)
              else {
                all.push(...batch)
                next()
              }
            }, rej)
          next()
        })
        for (const c of children) await walk(c)
      }
    }
    for (const e of entries) await walk(e)
    return out
  }
  for (const f of Array.from(dt.files)) out.push(await readFile(f))
  return out
}

export async function readFile(f: File): Promise<DroppedFile> {
  if (/\.zip$/i.test(f.name)) return { name: f.name, data: new Uint8Array(await f.arrayBuffer()) }
  return { name: f.name, data: await f.text() }
}

export function ImportDropZone({
  onFiles,
  onBrowse,
  compact,
  children
}: {
  onFiles: (files: DroppedFile[]) => void
  onBrowse: (kind: BrowseKind) => void
  compact?: boolean
  children?: ReactNode
}): React.JSX.Element {
  const [over, setOver] = useState(false)
  return (
    <div
      className={cn('relative h-full w-full', compact ? '' : 'flex items-center justify-center')}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setOver(false)
      }}
      onDrop={async (e) => {
        e.preventDefault()
        setOver(false)
        onFiles(await readDataTransfer(e.dataTransfer))
      }}
      data-testid="drop-zone"
    >
      {children}
      {!compact && (
        <div className="flex max-w-lg flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900/50 px-10 py-12 text-center">
          <FileUp className="size-12 text-sky-400" />
          <div>
            <h2 className="text-xl font-semibold text-slate-100">Import your PCB fabrication files</h2>
            <p className="mt-2 text-sm text-slate-400">
              Choose the Gerber and drill files your PCB design program exported for manufacturing (the
              &ldquo;fab outputs&rdquo; or &ldquo;Gerbers&rdquo;), or the folder that contains them. You can
              also drag & drop them here.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => onBrowse('files')} data-testid="import-files">
              <Files /> Choose files…
            </Button>
            <Button variant="secondary" onClick={() => onBrowse('folder')} data-testid="import-folder">
              <FolderOpen /> Choose a folder…
            </Button>
          </div>
          <div className="flex items-center gap-2 border-t border-slate-800 pt-3 text-xs text-slate-400">
            <FileArchive className="size-3.5 text-slate-500" />
            Got everything in one ZIP archive?
            <button
              type="button"
              onClick={() => onBrowse('zip')}
              className="font-medium text-sky-400 underline-offset-2 hover:underline"
              data-testid="import-zip"
            >
              Import a ZIP…
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Supported: Gerber RS-274X (X1 & X2) and Excellon drill (PTH / NPTH) from KiCad, Altium, Eagle,
            EasyEDA and others.
          </p>
        </div>
      )}
      {over && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-sky-400 bg-sky-500/10">
          <div className="rounded-lg bg-slate-900 px-4 py-2 text-sky-200 shadow-xl">Drop to import</div>
        </div>
      )}
    </div>
  )
}
