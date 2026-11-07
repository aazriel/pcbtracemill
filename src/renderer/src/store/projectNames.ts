/**
 * Project names used before (newest last), so a new project can be offered the next free one
 * ("my_pcb" -> "my_pcb 1"). Electron settings, localStorage in the browser.
 */
import { nextProjectName } from '@core/project'

const KEY = 'projectNames'
const LS_KEY = 'tracemill.projectNames'
const MAX = 200

let names: string[] = []
let loaded: Promise<string[]> | null = null

export function loadProjectNames(): Promise<string[]> {
  loaded ??= (async () => {
    let raw: unknown = []
    try {
      if (window.tracemill) raw = await window.tracemill.settingsGet<unknown>(KEY, [])
      else raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')
    } catch {
      raw = []
    }
    names = Array.isArray(raw) ? raw.filter((n): n is string => typeof n === 'string') : []
    return names
  })()
  return loaded
}

/** The names used so far (empty until loaded). */
export function usedProjectNames(): string[] {
  return names
}

/** The name suggested for a new project. */
export function suggestProjectName(wanted?: string): string {
  return nextProjectName(names, wanted)
}

/** A project got this name (named at import, or saved). */
export function rememberProjectName(name: string): void {
  const n = name.trim()
  if (!n) return
  names = [...names.filter((x) => x.toLowerCase() !== n.toLowerCase()), n].slice(-MAX)
  try {
    if (window.tracemill) void window.tracemill.settingsSet(KEY, names)
    else localStorage.setItem(LS_KEY, JSON.stringify(names))
  } catch {
    // storage unavailable
  }
}
