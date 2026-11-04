/** Local UI state for the "Add step" picker and the Step editor dialog. */
import { create } from 'zustand'
import type { CamStep, StepKind } from '@core/model/types'
import { createDraft } from './stepUtils'

interface StepEditorState {
  pickerOpen: boolean
  /** The step being edited (a copy, committed on Save). */
  draft: CamStep | null
  isNew: boolean
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
  openPicker: () => set({ pickerOpen: true }),
  closePicker: () => set({ pickerOpen: false }),
  openNew: (kind) => set({ pickerOpen: false, draft: createDraft(kind), isNew: true }),
  openEdit: (step) => set({ draft: structuredClone(step), isNew: false }),
  update: (fn) => set((s) => (s.draft ? { draft: fn(s.draft) } : s)),
  close: () => set({ draft: null })
}))
