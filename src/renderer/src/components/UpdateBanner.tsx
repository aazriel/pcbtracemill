/**
 * "A new version is available" (D-041). Checked once a few seconds after the start (quietly
 * skipped without internet) and from Help → Check for Updates.
 */
import { create } from 'zustand'
import { Download, X } from 'lucide-react'
import type { UpdateCheck } from '@shared/ipc-types'
import { Button } from '@renderer/components/ui/button'
import { useUi } from '@renderer/store/ui'

type NewVersion = Extract<UpdateCheck, { status: 'new' }>

const useUpdate = create<{ found: NewVersion | null }>()(() => ({ found: null }))

const SKIP_KEY = 'updates.skipVersion'

/** Asks GitHub for the latest release. `manual`: always say what came out (Help menu). */
export async function checkForUpdates(manual = false): Promise<void> {
  const api = window.tracemill
  if (!api) return
  let r: UpdateCheck
  try {
    r = await api.checkForUpdates()
  } catch {
    r = { status: 'offline', current: '' }
  }
  const ui = useUi.getState()
  if (r.status === 'new') {
    const skipped = manual ? null : await api.settingsGet<string | null>(SKIP_KEY, null).catch(() => null)
    if (skipped !== r.latest) useUpdate.setState({ found: r })
    if (manual) ui.toast('info', `PCB TraceMill ${r.latest} is available (you have ${r.current}).`)
  } else if (manual)
    ui.toast(
      r.status === 'current' ? 'success' : 'warning',
      r.status === 'current'
        ? `You have the latest version (${r.current}).`
        : 'Could not reach GitHub to check for updates – no internet connection? PCB TraceMill works fine without it.',
      r.status === 'current' ? undefined : 8000
    )
}

/** The automatic check at start: a few seconds later so it never slows the start-up down. */
export function scheduleUpdateCheck(): void {
  if (!window.tracemill || window.tracemill.noStartupPrompts) return
  setTimeout(() => void checkForUpdates(false), 5000)
}

export function UpdateBanner(): React.JSX.Element | null {
  const found = useUpdate((s) => s.found)
  if (!found) return null
  const close = (): void => useUpdate.setState({ found: null })
  return (
    <div
      className="flex items-center gap-3 border-b border-emerald-700/60 bg-emerald-950/80 px-4 py-1.5 text-sm text-emerald-100"
      data-testid="update-banner"
      role="status"
    >
      <Download className="size-4 shrink-0 text-emerald-300" />
      <span className="min-w-0 flex-1">
        <b>PCB TraceMill {found.latest}</b> is available – you have {found.current}. Your tools, settings
        and projects are kept when you install it.
      </span>
      <Button size="sm" variant="success" onClick={() => window.open(found.url, '_blank')}>
        Download
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void window.tracemill?.settingsSet(SKIP_KEY, found.latest).catch(() => undefined)
          close()
        }}
      >
        Skip this version
      </Button>
      <button type="button" aria-label="Close" className="opacity-70 hover:opacity-100" onClick={close}>
        <X className="size-4" />
      </button>
    </div>
  )
}
