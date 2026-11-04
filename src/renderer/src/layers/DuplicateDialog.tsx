import { FileWarning } from 'lucide-react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import type { PendingDuplicates } from '@renderer/store/ui'

/** Shown when an import contains files that are already loaded as layers. */
export function DuplicateDialog({
  pending,
  onResolve
}: {
  pending: PendingDuplicates | null
  onResolve: (mode: 'replace' | 'keep' | 'skip') => void
}): React.JSX.Element {
  const names = pending?.names ?? []
  const others = (pending?.layers.length ?? 0) - names.length
  return (
    <Dialog
      open={!!pending}
      onOpenChange={(o) => !o && onResolve('skip')}
      title={names.length === 1 ? 'This file is already loaded' : `${names.length} files are already loaded`}
      description="Replace the loaded layers with the new files (for example after you changed your design), or add them again as extra layers."
      footer={
        <>
          <Button variant="ghost" onClick={() => onResolve('skip')} data-testid="dup-skip">
            Skip {names.length === 1 ? 'it' : 'them'}
          </Button>
          <Button variant="secondary" onClick={() => onResolve('keep')} data-testid="dup-keep">
            Keep both
          </Button>
          <Button onClick={() => onResolve('replace')} data-testid="dup-replace">
            Replace
          </Button>
        </>
      }
    >
      <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto" data-testid="dup-list">
        {names.map((n) => (
          <li
            key={n}
            className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
          >
            <FileWarning className="size-3.5 shrink-0 text-amber-400" />
            <span className="truncate font-mono">{n}</span>
          </li>
        ))}
      </ul>
      {others > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          The other {others} new file{others === 1 ? '' : 's'} will be added either way.
        </p>
      )}
    </Dialog>
  )
}
