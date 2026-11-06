import { create } from 'zustand'
import type { CamResult } from '@core/pipeline/cam'
import type { ImportedLayer, ParsedLayer } from '@core/model/types'
import type { DroppedFile } from '@renderer/layers/ImportDropZone'

export type Stage = 'board' | 'manufacture' | 'simulation' | 'export'

export type BrowseKind = 'files' | 'folder' | 'zip'
export type BoardSide = 'top' | 'bottom' | 'both'

/** An import that contains files already in the project: waiting for Replace / Keep both / Skip. */
export interface PendingDuplicates {
  layers: ImportedLayer[]
  parsed: Record<string, ParsedLayer>
  skipped: { name: string; reason: string }[]
  /** File names that are already loaded. */
  names: string[]
}

export interface Toast {
  id: number
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
}

export interface UiState {
  stage: Stage
  /** Which board side the Manufacture view shows. */
  viewSide: 'top' | 'bottom'
  /** Which side the Board stage shows (both = everything, seen from the top). */
  boardSide: BoardSide
  /** Latest CAM result (validations, toolpaths, G-code). */
  cam: CamResult | null
  /** Bumped every time `cam` changes. */
  camVersion: number
  generating: boolean
  /** The step whose toolpath is being generated right now (null otherwise). */
  generatingStepId: string | null
  /** Set when inputs changed after the last generation. */
  camStale: boolean
  camError: string | null
  /** Files waiting for the user to pick the EDA tool. */
  pendingImport: DroppedFile[] | null
  /** A file / folder / ZIP picker waiting for the user to pick the EDA tool first. */
  pendingBrowse: BrowseKind | null
  pendingDuplicates: PendingDuplicates | null
  helpOpen: boolean
  helpTopic: string | null
  importing: boolean
  skippedFiles: { name: string; reason: string }[]
  toasts: Toast[]
  /** App preference (Settings -> Advanced): steps can skip parts of the board. */
  advancedSkip: boolean
  /** Step currently highlighted in Manufacture (e.g. to show its toolpath). */
  selectedStepId: string | null
  /** Step whose problem places are listed on the Manufacture board (panel open). */
  problemStepId: string | null
  /** Problem place the Manufacture view is zoomed to. */
  problemFocus: string | null
  /** "New project" asked while there are unsaved changes. */
  confirmNew: boolean
  set(patch: Partial<UiState>): void
  toast(level: Toast['level'], message: string): void
  dismissToast(id: number): void
}

let toastId = 0

export const useUi = create<UiState>()((set) => ({
  stage: 'board',
  viewSide: 'top',
  boardSide: 'top',
  cam: null,
  camVersion: 0,
  generating: false,
  generatingStepId: null,
  advancedSkip: false,
  camStale: true,
  camError: null,
  pendingImport: null,
  pendingBrowse: null,
  pendingDuplicates: null,
  helpOpen: false,
  helpTopic: null,
  importing: false,
  skippedFiles: [],
  toasts: [],
  selectedStepId: null,
  problemStepId: null,
  problemFocus: null,
  confirmNew: false,
  set: (patch) => set(patch),
  toast: (level, message) => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, level, message }] }))
    setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      level === 'error' ? 8000 : 3500
    )
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
