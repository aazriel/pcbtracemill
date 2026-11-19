/**
 * Export / import of the user's tool library (.tmtools), to pass tools to another user or bring
 * them back on a new installation.
 */
import type { Tool } from '@core/model/types'
import { parseToolLibrary, serializeToolLibrary, TOOL_LIBRARY_EXTENSION } from '@core/tools'
import { APP_VERSION } from '@shared/version'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { downloadText, pickTextFile } from '@renderer/store/controller'
import { pickFiles } from '@renderer/layers/FolderBrowserDialog'
import { loadUserTools, rememberTool, uniqueToolName, userTools } from './toolLibrary'
import { nextToolNumber, sameTool } from './toolMeta'

const FILTERS = [
  { name: 'PCB TraceMill tool library', extensions: [TOOL_LIBRARY_EXTENSION, 'json'] },
  { name: 'PCB TraceMill project (its own tools)', extensions: ['tmill'] },
  { name: 'All files', extensions: ['*'] }
]

/** The user's own tools: the saved library plus the project's own tools it does not have. */
async function ownTools(): Promise<Tool[]> {
  await loadUserTools()
  const lib = userTools()
  const ids = new Set(lib.map((t) => t.id))
  return [...lib, ...useProject.getState().tools.filter((t) => !t.builtIn && !ids.has(t.id))]
}

export async function exportToolLibrary(): Promise<void> {
  const ui = useUi.getState()
  const tools = await ownTools()
  if (!tools.length) {
    ui.toast('info', 'You have no tools of your own yet – the starter tools come with every installation.')
    return
  }
  const text = serializeToolLibrary(tools, APP_VERSION)
  const name = `PCB-TraceMill-tools.${TOOL_LIBRARY_EXTENSION}`
  if (window.tracemill) {
    try {
      const path = await window.tracemill.saveFile({ defaultName: name, content: text, filters: FILTERS })
      if (path) ui.saved(`Exported ${tools.length} tool${tools.length === 1 ? '' : 's'} to ${path}`)
    } catch (e) {
      ui.toast('error', `Not saved: ${e instanceof Error ? e.message : String(e)}`)
    }
  } else {
    downloadText(name, text)
    ui.saved(`Downloading ${tools.length} tool(s)…`)
  }
}

/**
 * Adds the tools of a library file to the project and to the saved library. A tool that is already
 * there (same id) is updated; a different tool with a name that is taken gets "name 2".
 */
export function importToolLibraryText(text: string): { added: number; updated: number; skipped: string[] } {
  const { tools, skipped } = parseToolLibrary(text)
  const p = useProject.getState()
  let all = [...p.tools]
  let added = 0
  let updated = 0
  for (const t of tools) {
    const same = all.find((x) => x.id === t.id)
    if (same) {
      if (sameTool(same, t)) continue
      const tool = {
        ...t,
        name: uniqueToolName(
          all.filter((x) => x.id !== t.id),
          t.name
        )
      }
      all = all.map((x) => (x.id === t.id ? tool : x))
      p.upsertTool(tool)
      rememberTool(tool)
      updated++
      continue
    }
    const tool: Tool = {
      ...t,
      name: uniqueToolName(all, t.name),
      number: all.some((x) => x.number === t.number) ? nextToolNumber(all) : t.number
    }
    all = [...all, tool]
    p.upsertTool(tool)
    rememberTool(tool)
    added++
  }
  return { added, updated, skipped }
}

export async function importToolLibrary(): Promise<void> {
  const ui = useUi.getState()
  let text: string | null = null
  if (window.tracemill) {
    const paths = await pickFiles({
      extensions: [TOOL_LIBRARY_EXTENSION, 'json', 'tmill'],
      title: 'Import tools (.tmtools, or a .tmill project)'
    })
    if (!paths?.length) return
    const files = await window.tracemill.readPaths(paths)
    text = files[0]?.encoding === 'utf8' ? files[0].data : null
    if (files[0] && !text) {
      ui.toast('error', 'This is not a PCB TraceMill tool library file.')
      return
    }
  } else text = await pickTextFile(`.${TOOL_LIBRARY_EXTENSION},.json,.tmill`)
  if (!text) return
  try {
    const r = importToolLibraryText(text)
    const parts = [
      r.added && `${r.added} new tool${r.added === 1 ? '' : 's'}`,
      r.updated && `${r.updated} updated`
    ].filter(Boolean)
    ui.toast(
      parts.length ? 'success' : 'info',
      (parts.length ? `Imported ${parts.join(', ')}.` : 'All these tools were already in your library.') +
        (r.skipped.length ? ` Skipped: ${r.skipped.slice(0, 3).join(' · ')}` : ''),
      8000
    )
  } catch (e) {
    ui.toast('error', e instanceof Error ? e.message : String(e), 10000)
  }
}
