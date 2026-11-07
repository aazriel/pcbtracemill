/** Local UI state for the "Add step" picker and the Step editor dialog. */
import { create } from 'zustand'
import type { CamStep, StepKind } from '@core/model/types'
import { createDraft } from './stepUtils'

interface StepEditorState {
  pickerOpen: boolean
  /** The step being edited (a copy, committed on Save). */
  draft: CamStep | null
  isNew: boolean
  /** Run time of the draft as edited (live preview, s), keyed by the draft's JSON. */
  previewSeconds: { key: string; seconds: number | null } | null
  setPreviewSeconds(p: { key: string; seconds: number | null } | null): void
  openPicker(): void
  closePicker(): void
  openNew(kind: StepKind): void
  openEdit(step: CamStep): void
  update(fn: (d: CamStep) => CamStep): void
  close(): void
}

export const useStepEditor = create<StepEditorState>()((set) => ({
  pickerOpen: false,
  draft: null,
  isNew: false,
  previewSeconds: null,
  setPreviewSeconds: (p) => set({ previewSeconds: p }),
  openPicker: () => set({ pickerOpen: true }),
  closePicker: () => set({ pickerOpen: false }),
  openNew: (kind) => set({ pickerOpen: false, draft: createDraft(kind), isNew: true }),
  openEdit: (step) => set({ draft: structuredClone(step), isNew: false, previewSeconds: null }),
  update: (fn) => set((s) => (s.draft ? { draft: fn(s.draft) } : s)),
  close: () => set({ draft: null })
}))
