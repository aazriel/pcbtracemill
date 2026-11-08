/**
 * The user's own tools, kept across sessions (not only in the project they were made in).
 * Electron: window.tracemill.settingsGet/settingsSet('userTools'); browser: localStorage fallback.
 * Every project gets the saved tools it does not have yet (new, opened or restored).
 */
import type { Tool } from '@core/model/types'

const KEY = 'userTools'
const LS_KEY = 'tracemill.userTools'

let library: Tool[] = []
let loaded: Promise<Tool[]> | null = null

function isTool(v: unknown): v is Tool {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Partial<Tool>
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    typeof t.type === 'string' &&
    !!t.geometry &&
    !!t.feeds
  )
}

/** Loads the saved tools once (later calls return the same list). */
export function loadUserTools(): Promise<Tool[]> {
  loaded ??= (async () => {
    let raw: unknown = []
    try {
      if (window.tracemill) raw = await window.tracemill.settingsGet<unknown>(KEY, [])
      else raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')
    } catch {
      raw = []
    }
    library = Array.isArray(raw) ? raw.filter(isTool).map((t) => ({ ...t, builtIn: false })) : []
    return library
  })()
  return loaded
}

/** The saved tools known so far (empty until `loadUserTools` finished). */
export function userTools(): Tool[] {
  return library
}

function save(): void {
  try {
    if (window.tracemill) void window.tracemill.settingsSet(KEY, library)
    else localStorage.setItem(LS_KEY, JSON.stringify(library))
  } catch {
    // storage unavailable: the tool stays in the project
  }
}

/** A tool was saved in the library dialog: keep it for later sessions. */
export function rememberTool(t: Tool): void {
  if (t.builtIn) return
  const i = library.findIndex((x) => x.id === t.id)
  library = i >= 0 ? library.map((x, k) => (k === i ? t : x)) : [...library, t]
  save()
}

/** A tool was deleted in the library dialog. */
export function forgetTool(id: string): void {
  if (!library.some((t) => t.id === id)) return
  library = library.filter((t) => t.id !== id)
  save()
}

/** `tools` plus the saved tools it does not have (same list when nothing is missing). */
export function withUserTools(tools: Tool[]): Tool[] {
  const have = new Set(tools.map((t) => t.id))
  const missing = library.filter((t) => !have.has(t.id))
  return missing.length ? [...tools, ...missing.map((t) => ({ ...t }))] : tools
}

/** Another tool with the same name as `t` (names are unique, ignoring case and outer spaces). */
export function toolNameClash(tools: Tool[], t: Tool): Tool | undefined {
  const n = t.name.trim().toLowerCase()
  if (!n) return undefined
  return tools.find((x) => x.id !== t.id && x.name.trim().toLowerCase() === n)
}

/** `name`, or "name 2", "name 3"… when another tool already has it. */
export function uniqueToolName(tools: Tool[], name: string): string {
  const used = new Set(tools.map((t) => t.name.trim().toLowerCase()))
  if (!used.has(name.trim().toLowerCase())) return name
  let i = 2
  while (used.has(`${name} ${i}`.toLowerCase())) i++
  return `${name} ${i}`
}
