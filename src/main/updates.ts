/**
 * Is there a newer PCB TraceMill? Asks GitHub for the latest release (D-041). Never throws and
 * never waits long: on a computer without internet the answer is simply "offline".
 */
import { app, ipcMain, net } from 'electron'
import { compareVersions } from '@core/project'
import type { UpdateCheck } from '../shared/ipc-types'

const LATEST = 'https://api.github.com/repos/aazriel/pcbtracemill/releases/latest'
export const RELEASES_PAGE = 'https://github.com/aazriel/pcbtracemill/releases/latest'
const TIMEOUT_MS = 6000

export async function checkForUpdate(): Promise<UpdateCheck> {
  const current = app.getVersion()
  if (!net.isOnline()) return { status: 'offline', current }
  try {
    const res = await net.fetch(LATEST, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PCB-TraceMill-update-check' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) return { status: 'offline', current }
    const body = (await res.json()) as { tag_name?: string; html_url?: string; name?: string }
    const latest = (body.tag_name ?? '').replace(/^v/i, '')
    if (!/^\d+\.\d+/.test(latest)) return { status: 'offline', current }
    const url = body.html_url?.startsWith('https://github.com/') ? body.html_url : RELEASES_PAGE
    return compareVersions(latest, current) > 0
      ? { status: 'new', current, latest, url }
      : { status: 'current', current, latest }
  } catch {
    return { status: 'offline', current }
  }
}

export function registerUpdateIpc(): void {
  ipcMain.handle('updates:check', () => checkForUpdate())
}
