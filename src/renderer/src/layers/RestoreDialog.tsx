import { History } from 'lucide-react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { resolveRestore, useRestore } from '@renderer/store/session'

function ago(d: Date): string {
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  return d.toLocaleString()
}

/** Start-up question: continue the work from last time, or start fresh. */
export function RestoreDialog(): React.JSX.Element | null {
  const offer = useRestore((s) => s.offer)
  if (!offer) return null
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && void resolveRestore(false)}
      title="Pick up where you left off?"
      description="TraceMill keeps your work while you use it. This is what was open when the app was closed."
      className="w-[min(92vw,480px)]"
      footer={
        <>
          <Button variant="ghost" onClick={() => void resolveRestore(false)} data-testid="restore-no">
            Start fresh
          </Button>
          <Button onClick={() => void resolveRestore(true)} data-testid="restore-yes" autoFocus>
            <History /> Restore
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/15">
          <History className="size-6 text-sky-400" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{offer.name}</div>
          <div className="text-xs text-slate-400">
            {offer.layers} layer{offer.layers === 1 ? '' : 's'} · {offer.steps} step
            {offer.steps === 1 ? '' : 's'} · last change {ago(offer.savedAt)}
            {offer.file.dirty && <span className="text-amber-300"> · had unsaved changes</span>}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
