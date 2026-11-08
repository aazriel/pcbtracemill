/**
 * Where new projects are saved and which names are free there. A name counts as used only when a
 * project file with it exists in the save folder (naming a project at import does not use it up).
 * The folder is the one chosen last (Electron settings 'projectFolder'), else Documents.
 * In the browser there is no folder: projects download, every name is free.
 */
import { useSyncExternalStore } from 'react'
import { nextProjectName, projectFileBase } from '@core/project'

const KEY = 'projectFolder'

interface FolderState {
  /** The save folder (null in the browser or until loaded). */
  folder: string | null
  /** Project files (names without .tmill) in that folder. */
  files: string[]
}

let state: FolderState = { folder: null, files: [] }
let loaded: Promise<void> | null = null
const listeners = new Set<() => void>()

function setState(next: FolderState): void {
  state = next
  for (const l of listeners) l()
}

async function filesIn(folder: string): Promise<string[]> {
  try {
    return (await window.tracemill?.projectFiles(folder)) ?? []
  } catch {
    return []
  }
}

/** Loads the save folder and its project files once (call refreshProjectFiles for a fresh list). */
export function loadProjectFolder(): Promise<void> {
  loaded ??= (async () => {
    if (!window.tracemill) return
    try {
      const folder = await window.tracemill.projectFolder()
      setState({ folder, files: await filesIn(folder) })
    } catch {
      // no folder: saving asks where
    }
  })()
  return loaded
}

/** Reads the project files of the save folder again (they may have changed outside TraceMill). */
export async function refreshProjectFiles(): Promise<void> {
  await loadProjectFolder()
  if (state.folder) setState({ ...state, files: await filesIn(state.folder) })
}

/** The save folder and its project files, for components. */
export function useProjectFolder(): FolderState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}

export function projectFolder(): string | null {
  return state.folder
}

/** New projects are saved here from now on. */
export async function setProjectFolder(folder: string): Promise<void> {
  if (!folder) return
  setState({ folder, files: await filesIn(folder) })
  try {
    await window.tracemill?.settingsSet(KEY, folder)
  } catch {
    // not remembered: only this session
  }
}

/** Asks for another save folder. True when one was chosen. */
export async function pickProjectFolder(): Promise<boolean> {
  const dir = await window.tracemill?.pickProjectFolder(state.folder ?? undefined)
  if (!dir) return false
  await setProjectFolder(dir)
  return true
}

/** The name suggested for a new project: `wanted` or the next free number in the save folder. */
export function suggestProjectName(wanted?: string): string {
  return nextProjectName(state.files, wanted)
}

/** Is there a project file with this name in the save folder already? */
export function projectNameTaken(name: string): boolean {
  const f = projectFileBase(name).toLowerCase()
  return state.files.some((x) => x.toLowerCase() === f)
}

const sep = (folder: string): string => (folder.includes('\\') ? '\\' : '/')

/** The file a project with this name is saved to in the save folder (null without a folder). */
export function projectPathFor(name: string): string | null {
  const f = state.folder
  if (!f) return null
  return `${f.replace(/[\\/]+$/, '')}${sep(f)}${projectFileBase(name)}.tmill`
}

/** A project was saved to `path`: its folder becomes the save folder and the name is used. */
export function projectSavedAt(path: string): void {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (i <= 0) return
  const folder = path.slice(0, i)
  const file = path.slice(i + 1).replace(/\.tmill$/i, '')
  if (folder !== state.folder) void setProjectFolder(folder)
  else if (!projectNameTaken(file)) setState({ ...state, files: [...state.files, file] })
}
