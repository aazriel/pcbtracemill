/** Which file the user points at (its Z0 points light up on the board map) and which bit's point is being moved. */
import { create } from 'zustand'

interface TouchUi {
  /** File name under the mouse (Auto-level step 3 or the files table). */
  hoverFile: string | null
  /** Step whose Z0 point the user is placing (a click on the board map sets it). */
  editStep: string | null
  set: (p: Partial<Omit<TouchUi, 'set'>>) => void
}

export const useTouchUi = create<TouchUi>()((set) => ({
  hoverFile: null,
  editStep: null,
  set: (p) => set(p)
}))

/** Props for a row that lights up its file's points on the board map. */
export function hoverProps(name: string): { onMouseEnter: () => void; onMouseLeave: () => void } {
  return {
    onMouseEnter: () => useTouchUi.getState().set({ hoverFile: name }),
    onMouseLeave: () => {
      if (useTouchUi.getState().hoverFile === name) useTouchUi.getState().set({ hoverFile: null })
    }
  }
}

/** One colour per file, so the points on the map match the file list. */
export const FILE_COLOURS = [
  '#38bdf8',
  '#f472b6',
  '#facc15',
  '#4ade80',
  '#fb923c',
  '#a78bfa',
  '#2dd4bf',
  '#f87171'
]
