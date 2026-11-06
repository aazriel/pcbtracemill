/**
 * UI state for auto-leveling and export. The height map lives in the project store; `apply` and
 * `measuredSide` are mirrored into ProjectSettings so they are saved with the .tmill project.
 */
import { create } from 'zustand'
import type { ProbeGridConfig } from '@core/model/types'
import type { Mach3Recorder } from '@core/heightmap'
import { useProject } from '@renderer/store/project'

export interface ProbeImportInfo {
  fileName: string
  format: string
  /** Why the results were rejected (no map was built). */
  errors: string[]
  warnings: string[]
  ok: boolean
}

export interface AutoLevelState {
  /** Pass every eligible exported file through the height-map correction. */
  apply: boolean
  /** Corrected files probe Z0 at point 1 before each bit starts (no exact manual zeroing). */
  touchOff: boolean
  /** Files without a height-map correction also find Z0 with the probe before each bit (off by default). */
  probeZero: boolean
  /** Which side of the board was facing up while it was probed. */
  measuredSide: 'top' | 'bottom'
  /** Last probe grid the user saved a program for (used to align the imported results). */
  probeCfg: ProbeGridConfig | null
  /** True once a probe program has been saved in this session. */
  probeSaved: boolean
  /** How the last saved Mach3 probe program records the heights (null: not a Mach3 program). */
  probeRecorder: Mach3Recorder | null
  importInfo: ProbeImportInfo | null
  /** The height-map viewer dialog is open. */
  mapOpen: boolean
  set(patch: Partial<Omit<AutoLevelState, 'set'>>): void
}

export const useAutoLevel = create<AutoLevelState>()((set) => ({
  apply: false,
  touchOff: true,
  probeZero: false,
  measuredSide: 'top',
  probeCfg: null,
  probeSaved: false,
  probeRecorder: null,
  importInfo: null,
  mapOpen: false,
  set: (patch) => {
    set(patch)
    const settings: {
      autoLevelApply?: boolean
      autoLevelSide?: 'top' | 'bottom'
      autoLevelTouchOff?: boolean
      autoLevelProbeZero?: boolean
    } = {}
    if (patch.apply !== undefined) settings.autoLevelApply = patch.apply
    if (patch.touchOff !== undefined) settings.autoLevelTouchOff = patch.touchOff
    if (patch.probeZero !== undefined) settings.autoLevelProbeZero = patch.probeZero
    if (patch.measuredSide !== undefined) settings.autoLevelSide = patch.measuredSide
    const cur = useProject.getState().settings
    if (
      (settings.autoLevelApply !== undefined && settings.autoLevelApply !== cur.autoLevelApply) ||
      (settings.autoLevelSide !== undefined && settings.autoLevelSide !== cur.autoLevelSide) ||
      (settings.autoLevelTouchOff !== undefined && settings.autoLevelTouchOff !== cur.autoLevelTouchOff) ||
      (settings.autoLevelProbeZero !== undefined && settings.autoLevelProbeZero !== cur.autoLevelProbeZero)
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
    const touchOff = s.settings.autoLevelTouchOff ?? al.touchOff
    const probeZero = s.settings.autoLevelProbeZero ?? al.probeZero
    if (
      apply !== al.apply ||
      side !== al.measuredSide ||
      touchOff !== al.touchOff ||
      probeZero !== al.probeZero
    )
      useAutoLevel.setState({ apply, measuredSide: side, touchOff, probeZero })
  }
  if (s.heightMap === prev.heightMap) return
  // A freshly loaded project keeps its saved switch state.
  if (s.settings !== prev.settings && s.settings.autoLevelApply !== undefined) return
  if (s.heightMap && !prev.heightMap) useAutoLevel.getState().set({ apply: true })
  if (!s.heightMap) useAutoLevel.getState().set({ apply: false })
})
