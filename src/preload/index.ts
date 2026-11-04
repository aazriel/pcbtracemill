import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MenuCommand, TraceMillApi } from '../shared/ipc-types'

const api: TraceMillApi & { pathForFile(f: File): string } = {
  openFiles: (opts) => ipcRenderer.invoke('files:open', opts),
  readPaths: (paths) => ipcRenderer.invoke('files:read', paths),
  saveFile: (req) => ipcRenderer.invoke('files:save', req),
  saveFilesToDir: (files) => ipcRenderer.invoke('files:saveToDir', files),
  openProject: () => ipcRenderer.invoke('project:open'),
  settingsGet: (key, fallback) => ipcRenderer.invoke('settings:get', key, fallback),
  settingsSet: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  onMenu: (cb) => {
    const h = (_e: unknown, cmd: MenuCommand): void => cb(cmd)
    ipcRenderer.on('menu', h)
    return () => ipcRenderer.removeListener('menu', h)
  },
  setMenuState: (state) => ipcRenderer.send('menu:state', state),
  pathForFile: (f: File) => webUtils.getPathForFile(f),
  platform: process.platform
}

contextBridge.exposeInMainWorld('tracemill', api)
