/**
 * Project store: the undoable document (layers metadata, machine, material, tools, steps, settings).
 * Heavy parsed geometry lives in `parsedCache` (not undoable, not persisted) keyed by layer id.
 */
import { create, useStore } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { temporal } from 'zundo'
import type {
  CamStep,
  EdaTool,
  HeightMap,
  ImportedLayer,
  LayerSide,
  LayerType,
  MachineProfile,
  Material,
  ParsedLayer,
  Project,
  ProjectSettings,
  Tool
} from '@core/model/types'

export interface ProjectState {
  name: string
  filePath: string | null
  dirty: boolean
  layers: ImportedLayer[]
  machine: MachineProfile | null
  material: Material | null
  tools: Tool[]
  steps: CamStep[]
  heightMap: HeightMap | null
  settings: ProjectSettings
  /** Bumped whenever parsed geometry changes (parsedCache is outside the immer tree). */
  parsedVersion: number
}

export interface ProjectActions {
  setName(name: string): void
  setFilePath(p: string | null): void
  markClean(): void
  addLayers(layers: ImportedLayer[], parsed: Record<string, ParsedLayer>): void
  replaceLayer(id: string, layer: ImportedLayer, parsed: ParsedLayer): void
  removeLayer(id: string): void
  setLayerVisible(id: string, visible: boolean): void
  setAllVisible(visible: boolean): void
  setLayerColor(id: string, color: string): void
  setLayerType(id: string, type: LayerType): void
  setLayerSide(id: string, side: LayerSide): void
  resetLayerDetection(id: string, type: LayerType, side: LayerSide): void
  /** Move layer `id` to draw-order position `toIndex` (0 = bottom). */
  moveLayer(id: string, toIndex: number): void
  setEdaTool(eda: EdaTool): void
  setSettings(patch: Partial<ProjectSettings>): void
  setMachine(m: MachineProfile): void
  setMaterial(m: Material): void
  setTools(t: Tool[]): void
  upsertTool(t: Tool): void
  removeTool(id: string): void
  setSteps(s: CamStep[]): void
  upsertStep(s: CamStep): void
  removeStep(id: string): void
  moveStep(id: string, toIndex: number): void
  setHeightMap(h: HeightMap | null): void
  loadProject(p: Project, parsed: Record<string, ParsedLayer>, filePath: string | null): void
  reset(): void
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  edaTool: null,
  autoRegenerate: true,
  exportGrouping: 'per-step',
  realisticColors: false,
  highlightOnHover: true
}

/** Parsed geometry cache (outside of undo history). */
export const parsedCache = new Map<string, ParsedLayer>()

const initial = (): ProjectState => ({
  name: 'Untitled board',
  filePath: null,
  dirty: false,
  layers: [],
  machine: null,
  material: null,
  tools: [],
  steps: [],
  heightMap: null,
  settings: { ...DEFAULT_SETTINGS },
  parsedVersion: 0
})

function renumber(layers: ImportedLayer[]): void {
  layers.sort((a, b) => a.order - b.order).forEach((l, i) => (l.order = i))
}

/** Older projects have no detected values: while still automatic, the current ones are them. */
function rememberDetection(l: ImportedLayer): void {
  if (l.detectedType === undefined && l.autoDetected) l.detectedType = l.type
  if (l.detectedSide === undefined && l.autoDetected) l.detectedSide = l.side
}

function isDetected(l: ImportedLayer): boolean {
  return l.type === l.detectedType && l.side === l.detectedSide
}

export const useProject = create<ProjectState & ProjectActions>()(
  temporal(
    immer((set) => ({
      ...initial(),
      setName: (name) => set((s) => void ((s.name = name), (s.dirty = true))),
      setFilePath: (p) => set((s) => void (s.filePath = p)),
      markClean: () => set((s) => void (s.dirty = false)),
      addLayers: (layers, parsed) =>
        set((s) => {
          for (const [id, p] of Object.entries(parsed)) parsedCache.set(id, p)
          const base = s.layers.length
          layers.forEach((l, i) =>
            s.layers.push({
              ...l,
              detectedType: l.detectedType ?? l.type,
              detectedSide: l.detectedSide ?? l.side,
              parsed: undefined,
              order: base + i
            })
          )
          renumber(s.layers)
          s.parsedVersion++
          s.dirty = true
        }),
      replaceLayer: (id, layer, parsed) =>
        set((s) => {
          const i = s.layers.findIndex((l) => l.id === id)
          if (i < 0) return
          parsedCache.set(id, parsed)
          s.layers[i] = {
            ...layer,
            detectedType: layer.detectedType ?? layer.type,
            detectedSide: layer.detectedSide ?? layer.side,
            id,
            order: s.layers[i].order,
            color: s.layers[i].color,
            parsed: undefined
          }
          s.parsedVersion++
          s.dirty = true
        }),
      removeLayer: (id) =>
        set((s) => {
          s.layers = s.layers.filter((l) => l.id !== id)
          renumber(s.layers)
          for (const st of s.steps) st.layerIds = st.layerIds.filter((x) => x !== id)
          s.dirty = true
        }),
      setLayerVisible: (id, visible) =>
        set((s) => {
          const l = s.layers.find((x) => x.id === id)
          if (l) l.visible = visible
        }),
      setAllVisible: (visible) => set((s) => void s.layers.forEach((l) => (l.visible = visible))),
      setLayerColor: (id, color) =>
        set((s) => {
          const l = s.layers.find((x) => x.id === id)
          if (l) l.color = color
          s.dirty = true
        }),
      setLayerType: (id, type) =>
        set((s) => {
          const l = s.layers.find((x) => x.id === id)
          if (l) {
            rememberDetection(l)
            l.type = type
            l.autoDetected = isDetected(l)
          }
          s.dirty = true
        }),
      setLayerSide: (id, side) =>
        set((s) => {
          const l = s.layers.find((x) => x.id === id)
          if (l) {
            rememberDetection(l)
            l.side = side
            l.autoDetected = isDetected(l)
          }
          s.dirty = true
        }),
      resetLayerDetection: (id, type, side) =>
        set((s) => {
          const l = s.layers.find((x) => x.id === id)
          if (l) {
            l.type = type
            l.side = side
            l.detectedType = type
            l.detectedSide = side
            l.autoDetected = true
          }
        }),
      moveLayer: (id, toIndex) =>
        set((s) => {
          const sorted = [...s.layers].sort((a, b) => a.order - b.order)
          const from = sorted.findIndex((l) => l.id === id)
          if (from < 0) return
          const [item] = sorted.splice(from, 1)
          sorted.splice(Math.max(0, Math.min(sorted.length, toIndex)), 0, item)
          sorted.forEach((l, i) => {
            const t = s.layers.find((x) => x.id === l.id)!
            t.order = i
          })
          s.dirty = true
        }),
      setEdaTool: (eda) => set((s) => void (s.settings.edaTool = eda)),
      setSettings: (patch) => set((s) => void Object.assign(s.settings, patch)),
      setMachine: (m) => set((s) => void ((s.machine = m), (s.dirty = true))),
      setMaterial: (m) => set((s) => void ((s.material = m), (s.dirty = true))),
      setTools: (t) => set((s) => void ((s.tools = t), (s.dirty = true))),
      upsertTool: (t) =>
        set((s) => {
          const i = s.tools.findIndex((x) => x.id === t.id)
          if (i >= 0) s.tools[i] = t
          else s.tools.push(t)
          s.dirty = true
        }),
      removeTool: (id) =>
        set((s) => {
          s.tools = s.tools.filter((t) => t.id !== id)
          for (const st of s.steps) if (st.toolId === id) st.toolId = null
          s.dirty = true
        }),
      setSteps: (steps) => set((s) => void ((s.steps = steps), (s.dirty = true))),
      upsertStep: (step) =>
        set((s) => {
          const i = s.steps.findIndex((x) => x.id === step.id)
          if (i >= 0) s.steps[i] = step
          else s.steps.push(step)
          s.dirty = true
        }),
      removeStep: (id) => set((s) => void ((s.steps = s.steps.filter((x) => x.id !== id)), (s.dirty = true))),
      moveStep: (id, toIndex) =>
        set((s) => {
          const from = s.steps.findIndex((x) => x.id === id)
          if (from < 0) return
          const [item] = s.steps.splice(from, 1)
          s.steps.splice(Math.max(0, Math.min(s.steps.length, toIndex)), 0, item)
          s.dirty = true
        }),
      setHeightMap: (h) => set((s) => void ((s.heightMap = h), (s.dirty = true))),
      loadProject: (p, parsed, filePath) =>
        set((s) => {
          parsedCache.clear()
          for (const [id, pl] of Object.entries(parsed)) parsedCache.set(id, pl)
          Object.assign(s, {
            ...initial(),
            name: p.name,
            filePath,
            layers: p.layers.map((l) => ({ ...l, parsed: undefined })),
            machine: p.machine,
            material: p.material,
            tools: p.tools,
            steps: p.steps,
            heightMap: p.heightMap,
            settings: { ...DEFAULT_SETTINGS, ...p.settings },
            parsedVersion: s.parsedVersion + 1
          })
        }),
      reset: () =>
        set((s) => {
          parsedCache.clear()
          Object.assign(s, { ...initial(), parsedVersion: s.parsedVersion + 1 })
        })
    })),
    {
      limit: 100,
      // Only the document is undoable; file path / dirty flags / parsed version are not.
      partialize: (s) => ({
        name: s.name,
        layers: s.layers,
        machine: s.machine,
        material: s.material,
        tools: s.tools,
        steps: s.steps,
        heightMap: s.heightMap,
        settings: s.settings
      }),
      // immer gives structural sharing, so a shallow compare of top-level refs is exact and cheap
      equality: (a, b) => (Object.keys(a) as (keyof typeof a)[]).every((k) => a[k] === b[k])
    }
  )
)

/** Layers with their parsed geometry attached (for rendering and CAM). */
export function layersWithParsed(layers: ImportedLayer[]): ImportedLayer[] {
  return layers.map((l) => ({ ...l, parsed: parsedCache.get(l.id) }))
}

export function toProject(s: ProjectState): Project {
  if (!s.machine || !s.material) throw new Error('Project is not complete (machine/material missing)')
  return {
    version: 1,
    name: s.name,
    layers: s.layers,
    machine: s.machine,
    material: s.material,
    tools: s.tools,
    steps: s.steps,
    heightMap: s.heightMap,
    settings: s.settings
  }
}

/** React hook over the undo/redo history store. */
export function useTemporal<T>(selector: (s: ReturnType<typeof useProject.temporal.getState>) => T): T {
  return useStore(useProject.temporal, selector)
}
