/** Typed IPC contract between main and renderer (exposed via preload as window.tracemill). */
export interface OpenedFile {
  name: string
  /** Text content for text files; base64 for binary (zip). */
  data: string
  encoding: 'utf8' | 'base64'
}

export interface SaveFileRequest {
  defaultName: string
  content: string
  filters: { name: string; extensions: string[] }[]
}

export interface TraceMillApi {
  openFiles(opts: {
    directory?: boolean
    filters?: { name: string; extensions: string[] }[]
    /** Folder import: only read files with these extensions (lower case, no dot). */
    extensions?: string[]
  }): Promise<OpenedFile[]>
  readPaths(paths: string[]): Promise<OpenedFile[]>
  saveFile(req: SaveFileRequest): Promise<string | null>
  /** Save several files into a user-chosen directory. Returns directory or null. */
  saveFilesToDir(files: { name: string; content: string }[]): Promise<string | null>
  openProject(): Promise<{ path: string; content: string } | null>
  settingsGet<T>(key: string, fallback: T): Promise<T>
  settingsSet(key: string, value: unknown): Promise<void>
  onMenu(cb: (command: MenuCommand) => void): () => void
  /** Tells the main process what the menu bar should show (e.g. the current design program). */
  setMenuState(state: MenuState): void
  platform: string
}

export interface MenuState {
  /** Current design program id, or null while none was chosen. */
  eda: string | null
}

export type MenuCommand =
  | `set-eda:${string}`
  | 'help'
  | 'shortcuts'
  | 'about'
  | 'new-project'
  | 'open-project'
  | 'save-project'
  | 'save-project-as'
  | 'import-files'
  | 'import-folder'
  | 'undo'
  | 'redo'
