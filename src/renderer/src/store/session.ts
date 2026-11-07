/**
 * "Restore last session": the current work is stored on every change (debounced, and once more
 * when the window closes). On the next start the user is asked whether to pick up where they left off.
 */
import { create } from 'zustand'
import { serializeProject, UNNAMED_PROJECT } from '@core/project'
import { toProject, useProject } from './project'
import { useUi, type Stage } from './ui'
import { loadProjectText } from './controller'

interface SessionFile {
  savedAt: string
  stage: Stage
  filePath: string | null
  dirty: boolean
  project: string
}

export interface RestoreOffer {
  name: string
  savedAt: Date
  layers: number
  steps: number
  file: SessionFile
}

export const useRestore = create<{ offer: RestoreOffer | null }>()(() => ({ offer: null }))

let started = false
let timer: ReturnType<typeof setTimeout> | null = null

function snapshot(): string | null {
  const s = useProject.getState()
  if (!s.layers.length) return null
  try {
    const file: SessionFile = {
      savedAt: new Date().toISOString(),
      stage: useUi.getState().stage,
      filePath: s.filePath,
      dirty: s.dirty,
      project: serializeProject(toProject(s))
    }
    return JSON.stringify(file)
  } catch {
    return null
  }
}

function saveNow(): void {
  if (timer) clearTimeout(timer)
  timer = null
  window.tracemill?.sessionSave(snapshot())
}

/** Starts storing the session. Only call after the restore question was answered (or not needed). */
function startAutosave(): void {
  if (started || !window.tracemill) return
  started = true
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(saveNow, 1200)
  }
  useProject.subscribe(schedule)
  useUi.subscribe((s, prev) => s.stage !== prev.stage && schedule())
  window.addEventListener('beforeunload', saveNow)
}

/** At start-up: offers the stored session when there is one, otherwise starts the autosave. */
export async function checkLastSession(): Promise<void> {
  const api = window.tracemill
  if (!api || api.noStartupPrompts) return startAutosave()
  const text = await api.sessionLoad()
  if (!text) return startAutosave()
  try {
    const file = JSON.parse(text) as SessionFile
    const p = JSON.parse(file.project) as { name?: string; layers?: unknown[]; steps?: unknown[] }
    if (!p.layers?.length) return startAutosave()
    useRestore.setState({
      offer: {
        name: p.name ?? UNNAMED_PROJECT,
        savedAt: new Date(file.savedAt),
        layers: p.layers.length,
        steps: p.steps?.length ?? 0,
        file
      }
    })
  } catch {
    startAutosave()
  }
}

/** Answer to the restore question. */
export async function resolveRestore(restore: boolean): Promise<void> {
  const offer = useRestore.getState().offer
  useRestore.setState({ offer: null })
  if (restore && offer) {
    try {
      await loadProjectText(offer.file.project, offer.file.filePath)
      // unsaved changes stay marked as unsaved
      if (offer.file.dirty) useProject.setState({ dirty: true })
      else useProject.getState().markClean()
      useProject.temporal.getState().clear()
      // simulation and export need fresh G-code first: come back to Manufacture at most
      useUi.getState().set({ stage: offer.file.stage === 'board' ? 'board' : 'manufacture' })
      useUi.getState().toast('success', `Restored "${offer.name}".`)
    } catch (e) {
      useUi
        .getState()
        .toast('error', `The last session could not be restored: ${e instanceof Error ? e.message : e}`)
    }
  }
  startAutosave()
  if (!restore) saveNow()
}
