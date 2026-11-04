/**
 * UI state for auto-leveling and export. The height map lives in the project store; `apply` and
 * `measuredSide` are mirrored into ProjectSettings so they are saved with the .tmill project.
 */
import { create } from 'zustand'
import type { ProbeGridConfig } from '@core/model/types'
import { useProject } from '@renderer/store/project'

export interface ProbeImportInfo {
  fileName: string
  format: string
  warnings: string[]
  ok: boolean
}

export interface AutoLevelState {
  /** Pass every eligible exported file through the height-map correction. */
  apply: boolean
  /** Which side of the board was facing up while it was probed. */
  measuredSide: 'top' | 'bottom'
  /** Last probe grid the user saved a program for (used to align the imported results). */
  probeCfg: ProbeGridConfig | null
  /** True once a probe program has been saved in this session. */
  probeSaved: boolean
  importInfo: ProbeImportInfo | null
  set(patch: Partial<Omit<AutoLevelState, 'set'>>): void
}

export const useAutoLevel = create<AutoLevelState>()((set) => ({
  apply: false,
  measuredSide: 'top',
  probeCfg: null,
  probeSaved: false,
  importInfo: null,
  set: (patch) => {
    set(patch)
    const settings: { autoLevelApply?: boolean; autoLevelSide?: 'top' | 'bottom' } = {}
    if (patch.apply !== undefined) settings.autoLevelApply = patch.apply
    if (patch.measuredSide !== undefined) settings.autoLevelSide = patch.measuredSide
    const cur = useProject.getState().settings
    if (
      (settings.autoLevelApply !== undefined && settings.autoLevelApply !== cur.autoLevelApply) ||
      (settings.autoLevelSide !== undefined && settings.autoLevelSide !== cur.autoLevelSide)
    )
      useProject.getState().setSettings(settings)
  }
}))

/** Settings key used to remember the last probe grid between sessions (Electron only). */
export const PROBE_CFG_SETTINGS_KEY = 'autolevel.lastProbeConfig'

// A map that appears (import, project load, undo) switches the correction on; removing it switches it off.
useProject.subscribe((s, prev) => {
  // Project loaded / undo: adopt the saved choices.
  if (s.settings !== prev.settings) {
    const al = useAutoLevel.getState()
    const apply = s.settings.autoLevelApply ?? al.apply
    const side = s.settings.autoLevelSide ?? al.measuredSide
    if (apply !== al.apply || side !== al.measuredSide) useAutoLevel.setState({ apply, measuredSide: side })
  }
  if (s.heightMap === prev.heightMap) return
  // A freshly loaded project keeps its saved switch state.
  if (s.settings !== prev.settings && s.settings.autoLevelApply !== undefined) return
  if (s.heightMap && !prev.heightMap) useAutoLevel.getState().set({ apply: true })
  if (!s.heightMap) useAutoLevel.getState().set({ apply: false })
})
