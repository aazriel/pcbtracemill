import { dialog, ipcMain, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join, extname } from 'node:path'
import Store from 'electron-store'
import type { OpenedFile, SaveFileRequest } from '../shared/ipc-types'

const store = new Store({ name: 'tracemill-settings' })
const BINARY_EXT = new Set(['.zip'])
const MAX_FILE_BYTES = 50 * 1024 * 1024

/** Reads a file, or a folder recursively. `only` limits folder contents to these extensions. */
async function readOne(path: string, only?: Set<string>): Promise<OpenedFile[]> {
  const st = await fs.stat(path)
  if (st.isDirectory()) {
    const entries = await fs.readdir(path)
    const nested = await Promise.all(entries.map((e) => readOne(join(path, e), only)))
    return nested.flat()
  }
  if (only && !only.has(extname(path).slice(1).toLowerCase())) return []
  if (st.size > MAX_FILE_BYTES) return []
  const buf = await fs.readFile(path)
  const binary = BINARY_EXT.has(extname(path).toLowerCase())
  return [
    {
      name: basename(path),
      data: binary ? buf.toString('base64') : buf.toString('utf8'),
      encoding: binary ? 'base64' : 'utf8'
    }
  ]
}

export function registerIpc(): void {
  ipcMain.handle(
    'files:open',
    async (
      e,
      opts: {
        directory?: boolean
        filters?: { name: string; extensions: string[] }[]
        extensions?: string[]
      }
    ) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const res = await dialog.showOpenDialog(win!, {
        properties: opts.directory ? ['openDirectory'] : ['openFile', 'multiSelections'],
        filters: opts.directory
          ? []
          : (opts.filters ?? [
              {
                name: 'PCB fabrication files',
                extensions: [
                  'gbr',
                  'ger',
                  'gtl',
                  'gbl',
                  'gko',
                  'gm1',
                  'drl',
                  'xln',
                  'txt',
                  'zip',
                  'gto',
                  'gbo',
                  'gts',
                  'gbs',
                  'cmp',
                  'sol',
                  'nc',
                  'exc',
                  'gtp',
                  'gbp',
                  'gml',
                  'gm',
                  'gbx',
                  'art',
                  'pho',
                  'g1',
                  'g2'
                ]
              },
              { name: 'All files', extensions: ['*'] }
            ])
      })
      if (res.canceled) return []
      const only = opts.directory && opts.extensions?.length ? new Set(opts.extensions) : undefined
      return (await Promise.all(res.filePaths.map((p) => readOne(p, only)))).flat()
    }
  )
  ipcMain.handle('files:read', async (_e, paths: string[]) =>
    (await Promise.all(paths.map((p) => readOne(p)))).flat()
  )
  ipcMain.handle('files:save', async (e, req: SaveFileRequest) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showSaveDialog(win!, { defaultPath: req.defaultName, filters: req.filters })
    if (res.canceled || !res.filePath) return null
    await fs.writeFile(res.filePath, req.content, 'utf8')
    return res.filePath
  })
  ipcMain.handle('files:saveToDir', async (e, files: { name: string; content: string }[]) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    const dir = res.filePaths[0]
    for (const f of files) await fs.writeFile(join(dir, basename(f.name)), f.content, 'utf8')
    return dir
  })
  ipcMain.handle('project:open', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'TraceMill project', extensions: ['tmill'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    return { path: res.filePaths[0], content: await fs.readFile(res.filePaths[0], 'utf8') }
  })
  ipcMain.handle('settings:get', (_e, key: string, fallback: unknown) => store.get(key, fallback))
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    store.set(key, value)
  })
}
