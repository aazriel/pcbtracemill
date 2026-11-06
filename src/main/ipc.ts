import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { promises as fs, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { basename, join, extname, dirname, parse as parsePath } from 'node:path'
import Store from 'electron-store'
import type { FolderListing, FolderPlace, OpenedFile, SaveFileRequest } from '../shared/ipc-types'

let store!: Store
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

/** Lists one folder for the in-app folder browser (files are shown but cannot be chosen). */
async function listFolder(path: string): Promise<FolderListing> {
  const entries = await fs.readdir(path, { withFileTypes: true })
  const folders: string[] = []
  const files: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('$') || e.name.startsWith('~$')) continue
    if (e.isDirectory()) folders.push(e.name)
    else if (e.isFile()) files.push(e.name)
  }
  const cmp = (a: string, b: string): number =>
    a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
  const root = parsePath(path).root
  return {
    path,
    parent: path === root ? null : dirname(path),
    folders: folders.sort(cmp),
    files: files.sort(cmp)
  }
}

async function folderPlaces(): Promise<FolderPlace[]> {
  const out: FolderPlace[] = []
  const names = { desktop: 'Desktop', documents: 'Documents', downloads: 'Downloads', home: 'Home' } as const
  for (const [n, label] of Object.entries(names)) {
    try {
      out.push({ label, path: app.getPath(n as keyof typeof names), kind: 'place' })
    } catch {
      /* not available on this system */
    }
  }
  if (process.platform === 'win32') {
    for (const c of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const p = `${c}:\\`
      try {
        await fs.access(p)
        out.push({ label: `${c}:`, path: p, kind: 'drive' })
      } catch {
        /* no such drive */
      }
    }
  } else out.push({ label: '/', path: '/', kind: 'drive' })
  return out
}

export function registerIpc(): void {
  // created here (not at import) so a test profile set with TRACEMILL_USER_DATA is used
  store = new Store({ name: 'tracemill-settings' })
  ipcMain.handle('folder:list', async (_e, path: string | null) => {
    const start = path || (store.get('lastImportFolder', '') as string) || app.getPath('documents')
    try {
      return await listFolder(start)
    } catch {
      return await listFolder(app.getPath('documents'))
    }
  })
  ipcMain.handle('folder:places', () => folderPlaces())
  // Last session: written (synchronously, so it survives the window closing) on every change
  const sessionFile = (): string => join(app.getPath('userData'), 'last-session.json')
  ipcMain.on('session:save', (_e, text: string | null) => {
    try {
      if (text) writeFileSync(sessionFile(), text, 'utf8')
      else rmSync(sessionFile(), { force: true })
    } catch {
      /* best effort */
    }
  })
  ipcMain.handle('session:load', () => {
    try {
      return readFileSync(sessionFile(), 'utf8')
    } catch {
      return null
    }
  })
  ipcMain.handle('folder:read', async (_e, path: string, extensions?: string[]) => {
    store.set('lastImportFolder', path)
    return readOne(path, extensions?.length ? new Set(extensions) : undefined)
  })
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
    try {
      await fs.writeFile(res.filePath, req.content, 'utf8')
    } catch (err) {
      throw new Error(writeError(basename(res.filePath), err))
    }
    return res.filePath
  })
  ipcMain.handle('files:saveToDir', async (e, files: { name: string; content: string }[]) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    const dir = res.filePaths[0]
    // Write every file that can be written; report the ones Windows refused (e.g. locked by Mach3).
    const failed: string[] = []
    for (const f of files) {
      try {
        await fs.writeFile(join(dir, basename(f.name)), f.content, 'utf8')
      } catch (err) {
        failed.push(writeError(basename(f.name), err))
      }
    }
    if (failed.length)
      throw new Error(
        `${failed.length} of ${files.length} file(s) were NOT saved to ${dir}: ${failed.join(' · ')}`
      )
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

/** A readable reason why a file could not be (over)written. */
function writeError(name: string, err: unknown): string {
  const code = (err as { code?: string })?.code
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')
    return `${name} is in use or read-only – if Mach3 (or an editor) has it loaded, close it there (Mach3: File → Close G-Code) and save again`
  return `${name}: ${err instanceof Error ? err.message : String(err)}`
}
