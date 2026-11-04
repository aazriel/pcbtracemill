import { Menu, BrowserWindow, app, ipcMain, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand, MenuState } from '../shared/ipc-types'

function send(cmd: MenuCommand): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu', cmd)
}

/** Design programs offered in Settings → Design program (ids match the renderer's EdaTool). */
const EDA_MENU: { id: string; label: string }[] = [
  { id: 'kicad', label: 'KiCad' },
  { id: 'altium', label: 'Altium Designer' },
  { id: 'eagle', label: 'Autodesk Eagle / Fusion Electronics' },
  { id: 'easyeda', label: 'EasyEDA / JLCPCB' },
  { id: 'other', label: 'Other / not sure' }
]

let state: MenuState = { eda: null, units: 'mm' }

export function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const current = EDA_MENU.find((e) => e.id === state.eda)
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => send('new-project') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => send('open-project') },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => send('save-project') },
        { label: 'Save Project As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-project-as') },
        { type: 'separator' },
        { label: 'Import Files…', accelerator: 'CmdOrCtrl+I', click: () => send('import-files') },
        { label: 'Import Folder…', click: () => send('import-folder') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: `Design program: ${current ? current.label : 'not chosen yet'}`,
          enabled: false
        },
        { type: 'separator' },
        ...EDA_MENU.map((e): MenuItemConstructorOptions => ({
          label: e.label,
          type: 'radio',
          checked: e.id === state.eda,
          click: () => send(`set-eda:${e.id}`)
        })),
        { type: 'separator' },
        { label: 'Units', enabled: false },
        {
          label: 'Millimetres (mm)',
          type: 'radio',
          checked: state.units !== 'inch',
          click: () => send('set-units:mm')
        },
        {
          label: 'Inches (in)',
          type: 'radio',
          checked: state.units === 'inch',
          click: () => send('set-units:inch')
        }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'TraceMill Help', accelerator: 'F1', click: () => send('help') },
        { label: 'Keyboard & Mouse Shortcuts', click: () => send('shortcuts') },
        { type: 'separator' },
        { label: `About TraceMill ${app.getVersion()}`, click: () => send('about') }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** The renderer reports what the menu should show; the menu is rebuilt when it changes. */
ipcMain.on('menu:state', (_e, next: MenuState) => {
  if (next?.eda === state.eda && next?.units === state.units) return
  state = { eda: next?.eda ?? null, units: next?.units === 'inch' ? 'inch' : 'mm' }
  buildMenu()
})
