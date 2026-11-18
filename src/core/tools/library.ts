/**
 * Tool library files (.tmtools): the user's own tools, to pass to another user or to bring back on
 * a new installation. JSON with a format name and version, like .tmill projects.
 */
import type { Tool } from '../model/types'
import { validateTool } from './index'

export const TOOL_LIBRARY_FORMAT = 'pcb-tracemill-tools'
/** Highest library file version this build reads. */
export const TOOL_LIBRARY_VERSION = 1
export const TOOL_LIBRARY_EXTENSION = 'tmtools'

interface ToolLibraryFile {
  format: typeof TOOL_LIBRARY_FORMAT
  version: number
  /** The app version that wrote it (shown when a newer file cannot be read). */
  app?: string
  tools: Tool[]
}

/** The user's own tools (built-in starter tools are left out: every installation has them). */
export function serializeToolLibrary(tools: Tool[], appVersion?: string): string {
  const file: ToolLibraryFile = {
    format: TOOL_LIBRARY_FORMAT,
    version: TOOL_LIBRARY_VERSION,
    app: appVersion,
    tools: tools.filter((t) => !t.builtIn).map((t) => ({ ...t, builtIn: false }))
  }
  return JSON.stringify(file, null, 2) + '\n'
}

/** Reads a library file; throws with a plain message when it is not one or is from a newer version. */
export function parseToolLibrary(text: string): { tools: Tool[]; skipped: string[] } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This is not a PCB TraceMill tool library file (it is not readable JSON).')
  }
  const f = raw as Partial<ToolLibraryFile>
  // a project file holds tools too: take its own tools
  const fromProject =
    typeof raw === 'object' && raw !== null && Array.isArray((raw as { tools?: unknown }).tools) && !f.format
  if (!fromProject && f.format !== TOOL_LIBRARY_FORMAT)
    throw new Error('This is not a PCB TraceMill tool library file.')
  if (!fromProject && (typeof f.version !== 'number' || f.version > TOOL_LIBRARY_VERSION))
    throw new Error(
      `This tool library was saved by a newer PCB TraceMill${f.app ? ` (${f.app})` : ''}. Install that version or newer to open it.`
    )
  const tools: Tool[] = []
  const skipped: string[] = []
  for (const t of (f.tools ?? []) as Partial<Tool>[]) {
    if (!t || typeof t !== 'object' || t.builtIn) continue
    const tool = { ...t, builtIn: false } as Tool
    const errs =
      typeof tool.id === 'string' && tool.geometry && tool.feeds ? validateTool(tool) : ['incomplete tool']
    if (errs.length) skipped.push(`${typeof t.name === 'string' ? t.name : 'A tool'}: ${errs[0]}`)
    else tools.push(tool)
  }
  return { tools, skipped }
}
