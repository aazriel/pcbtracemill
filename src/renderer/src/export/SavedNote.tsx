import { CheckCircle2 } from 'lucide-react'
import { useUi } from '@renderer/store/ui'

/** "Saved 3 files to … at 14:32" next to the save buttons, so a save is confirmed where it was made. */
export function SavedNote(): React.JSX.Element | null {
  const last = useUi((s) => s.lastSaved)
  if (!last) return null
  const time = new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <p
      className="flex items-start gap-1 text-[11px] leading-snug text-emerald-300"
      data-testid="saved-note"
      title={last.text}
    >
      <CheckCircle2 className="mt-px size-3.5 shrink-0" />
      <span className="break-all">
        {last.text} <span className="text-emerald-300/60">({time})</span>
      </span>
    </p>
  )
}
