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

/** One folder as the in-app folder browser shows it. */
export interface FolderListing {
  path: string
  /** Null at the root of a drive. */
  parent: string | null
  folders: string[]
  files: string[]
}

export interface FolderPlace {
  label: string
  path: string
  kind: 'place' | 'drive'
}

export interface TraceMillApi {
  openFiles(opts: {
    directory?: boolean
    filters?: { name: string; extensions: string[] }[]
    /** Folder import: only read files with these extensions (lower case, no dot). */
    extensions?: string[]
  }): Promise<OpenedFile[]>
  readPaths(paths: string[]): Promise<OpenedFile[]>
  /** Lists a folder (null = the last folder imported from, else Documents). */
  listFolder(path: string | null): Promise<FolderListing>
  /** Shortcuts (Desktop, Documents...) and drives for the folder browser. */
  folderPlaces(): Promise<FolderPlace[]>
  /** Reads a folder recursively, only files with these extensions; remembers it for next time. */
  readFolder(path: string, extensions?: string[]): Promise<OpenedFile[]>
  /** Stores the current work for "restore last session" (null clears it). */
  sessionSave(text: string | null): void
  /** The stored last session, or null. */
  sessionLoad(): Promise<string | null>
  /** True when started for automated tests: no restore question, no first-run tour. */
  noStartupPrompts: boolean
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
  /** Display units of the project. */
  units: 'mm' | 'inch'
}

export type MenuCommand =
  | `set-eda:${string}`
  | 'set-units:mm'
  | 'set-units:inch'
  | 'help'
  | 'tour'
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
