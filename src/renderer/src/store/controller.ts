/**
 * Controller: orchestrates the stores and the workers. UI components call these functions
 * instead of talking to workers directly.
 */
import { pickFolder } from '@renderer/layers/FolderBrowserDialog'
import { useMemo } from 'react'
import type {
  BBox,
  CamStep,
  ClearanceInfo,
  EdaTool,
  ImportedLayer,
  Material,
  ParsedLayer,
  Project,
  StepKind,
  StepValidation,
  Toolpath
} from '@core/model/types'
import { computeBoardBBox } from '@core/model/board'
import { DEFAULT_MACHINE_ID, MACHINE_PRESETS, refreshPresetHeights } from '@core/machines'
import { refreshStarterFeeds, STARTER_TOOLS } from '@core/tools'
import { withUserTools } from '@renderer/tools/toolLibrary'
import {
  combinedClearance,
  createStep,
  defaultMaterial,
  planIsolation,
  recipe,
  resetMaterialToDefault,
  validateMaterial,
  type MaterialIssue
} from '@core/cam'
import { summarizeLayerStatus } from '@core/import'
import { serializeProject, deserializeProject, UNNAMED_PROJECT } from '@core/project'
import { rememberProjectName, suggestProjectName } from './projectNames'
import { bboxIsEmpty } from '@core/geometry'
import * as Comlink from 'comlink'
import { analysisWorker, camWorker } from '@workers/index'
import { parsedCache, layersWithParsed, toProject, useProject, type ProjectState } from './project'
import { useUi, type BrowseKind, type Stage } from './ui'
import { EDA_INFO, edaInfo } from '@renderer/layers/eda'
import { uid } from '@renderer/lib/utils'
import type { DroppedFile } from '@renderer/layers/ImportDropZone'
import type { StatusLevel } from '@renderer/components/ui/status'

// ───────────────────────────────────────── derived data hooks

/** Layers with parsed geometry attached; stable until layers or parsed data change. */
export function useLayersWithParsed(): ImportedLayer[] {
  const layers = useProject((s) => s.layers)
  const v = useProject((s) => s.parsedVersion)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => layersWithParsed(layers), [layers, v])
}

export function useBoardBBox(): BBox {
  const layers = useLayersWithParsed()
  return useMemo(() => computeBoardBBox(layers), [layers])
}

export function getBoardBBox(): BBox {
  return computeBoardBBox(layersWithParsed(useProject.getState().layers))
}

export function useLayerStatus(): ReturnType<typeof summarizeLayerStatus> {
  const layers = useLayersWithParsed()
  return useMemo(() => summarizeLayerStatus(layers), [layers])
}

export function useMaterialIssues(): MaterialIssue[] {
  const material = useProject((s) => s.material)
  const bbox = useBoardBBox()
  return useMemo(() => (material ? validateMaterial(material, bbox) : []), [material, bbox])
}

export function useStepValidation(stepId: string): StepValidation | undefined {
  const cam = useUi((s) => s.cam)
  return cam?.validations.find((v) => v.stepId === stepId)
}

/** Status circle shown in the top process bar for each stage. */
export function useStageStatus(): Record<Stage, StatusLevel> {
  const layers = useProject((s) => s.layers)
  const steps = useProject((s) => s.steps)
  const status = useLayerStatus()
  const cam = useUi((s) => s.cam)
  const stale = useUi((s) => s.camStale)
  const matIssues = useMaterialIssues()
  return useMemo(() => {
    const copper = status.find((s) => s.key === 'copper')?.present
    const board: StatusLevel = !layers.length
      ? 'pending'
      : copper
        ? status.some((s) => !s.present && s.requirement === 'recommended')
          ? 'warning'
          : 'ok'
        : 'error'
    let manufacture: StatusLevel = 'pending'
    if (steps.length && cam) {
      const lv = cam.validations.filter((v) => steps.find((s) => s.id === v.stepId)?.enabled)
      manufacture =
        lv.some((v) => v.level === 'error') || matIssues.some((i) => i.level === 'error')
          ? 'error'
          : lv.some((v) => v.level === 'warning')
            ? 'warning'
            : 'ok'
    }
    const hasGcode = !!cam?.files.length && !stale
    return {
      board,
      manufacture,
      simulation: hasGcode ? 'ok' : 'pending',
      export: hasGcode ? 'ok' : 'pending'
    }
  }, [layers.length, steps, status, cam, stale, matIssues])
}

export function canEnterStage(stage: Stage): boolean {
  const p = useProject.getState()
  const ui = useUi.getState()
  const hasCopper = p.layers.some((l) => l.type === 'copper')
  if (stage === 'board') return true
  if (stage === 'manufacture') return hasCopper
  return hasCopper && !!ui.cam?.files.length
}

// ───────────────────────────────────────── project defaults

export function ensureDefaults(): void {
  const p = useProject.getState()
  if (!p.machine) p.setMachine(MACHINE_PRESETS.find((m) => m.id === DEFAULT_MACHINE_ID) ?? MACHINE_PRESETS[0])
  else refreshMachineHeights()
  if (!p.tools.length) p.setTools(STARTER_TOOLS.map((t) => ({ ...t })))
  else refreshToolFeeds()
  addUserTools()
  syncMaterialToBoard()
}

/**
 * The tools the user made in earlier sessions join the project's list. Not an edit of the
 * project: no undo step, no unsaved-changes mark.
 */
export function addUserTools(): void {
  const p = useProject.getState()
  const next = withUserTools(p.tools)
  if (next === p.tools) return
  const t = useProject.temporal.getState()
  t.pause()
  useProject.setState({ tools: next })
  t.resume()
}

/** A built-in machine still on the old 5 mm safe height gets 2 mm (D-030). */
function refreshMachineHeights(): void {
  const p = useProject.getState()
  if (!p.machine) return
  const m = refreshPresetHeights(p.machine)
  if (m === p.machine) return
  p.setMachine(m)
  useUi
    .getState()
    .toast('info', 'Safe height lowered to 2 mm (travel 1 mm): enough above a flat board, and faster.')
}

/** Starter V-bits still on the old, too fast feeds get the current ones (edited tools are kept). */
function refreshToolFeeds(): void {
  const p = useProject.getState()
  const fixed = refreshStarterFeeds(p.tools)
  if (fixed === p.tools) return
  p.setTools(fixed)
  useUi.getState().toast('info', 'Starter V-bit feeds updated: 50 mm/min for 0.1 mm tips (at 12 000 rpm).')
}

/** Keeps the material at "board + margin" while `useDefaults` is on, and creates it when missing. */
export function syncMaterialToBoard(): void {
  const p = useProject.getState()
  const bbox = getBoardBBox()
  if (bboxIsEmpty(bbox)) return
  if (!p.material) p.setMaterial(defaultMaterial(bbox))
  else if (p.material.useDefaults) {
    const next = resetMaterialToDefault(p.material, bbox)
    if (JSON.stringify(next) !== JSON.stringify(p.material)) p.setMaterial(next)
  }
}

export function setMaterial(m: Material): void {
  useProject.getState().setMaterial(m)
}

// ───────────────────────────────────────── import

/** The design program is asked for when it was never chosen, and again whenever no layers are left. */
export function needsEdaChoice(): boolean {
  const p = useProject.getState()
  return !p.settings.edaTool || p.layers.length === 0
}

export async function importDropped(files: DroppedFile[]): Promise<void> {
  if (!files.length) return
  if (needsEdaChoice()) {
    useUi.getState().set({ pendingImport: files })
    return
  }
  await runImport(files, useProject.getState().settings.edaTool!)
}

/**
 * Opens the file / folder / ZIP picker. The design program is asked for first, so the picker only
 * offers that program's fabrication files.
 */
export async function startImport(kind: BrowseKind): Promise<void> {
  if (needsEdaChoice()) {
    useUi.getState().set({ pendingBrowse: kind })
    return
  }
  await browse(kind, useProject.getState().settings.edaTool!)
}

/** Kept for the menu: Import Files… / Import Folder… */
export function browseAndImport(directory = false): Promise<void> {
  return startImport(directory ? 'folder' : 'files')
}

export async function resolveEda(eda: EdaTool, name?: string): Promise<void> {
  const ui = useUi.getState()
  useProject.getState().setEdaTool(eda)
  if (name) {
    useProject.getState().setName(name)
    rememberProjectName(name)
  }
  const files = ui.pendingImport
  const kind = ui.pendingBrowse
  ui.set({ pendingImport: null, pendingBrowse: null })
  if (files) await runImport(files, eda)
  else if (kind) await browse(kind, eda)
}

export function cancelEdaChoice(): void {
  useUi.getState().set({ pendingImport: null, pendingBrowse: null })
}

/** Changes the design program (Settings menu) and re-detects every layer that is still automatic. */
export async function changeEda(eda: EdaTool): Promise<void> {
  const p = useProject.getState()
  if (p.settings.edaTool === eda) return
  p.setEdaTool(eda)
  let n = 0
  for (const l of useProject.getState().layers) {
    if (!l.autoDetected) continue
    const fresh = await camWorker().parseOne(l.fileName, l.rawText, eda, l.id, l.order)
    useProject.getState().resetLayerDetection(l.id, fresh.type, fresh.side)
    n++
  }
  useUi
    .getState()
    .toast(
      'info',
      `Design program: ${edaInfo(eda)?.name ?? eda}.${n ? ` Re-checked ${n} automatically detected layer(s).` : ''}`
    )
}

async function runImport(files: DroppedFile[], eda: EdaTool): Promise<void> {
  const ui = useUi.getState()
  ui.set({ importing: true })
  const myEpoch = epoch
  try {
    const p = useProject.getState()
    const res = await camWorker().importFiles(files, eda, p.layers.length, uid('L'))
    if (myEpoch !== epoch) return // "New project" was chosen meanwhile
    const parsed: Record<string, ParsedLayer> = {}
    for (const l of res.layers) if (l.parsed) parsed[l.id] = l.parsed
    const loaded = new Set(p.layers.map((l) => l.fileName.toLowerCase()))
    const names = res.layers.filter((l) => loaded.has(l.fileName.toLowerCase())).map((l) => l.fileName)
    if (names.length) {
      ui.set({ pendingDuplicates: { layers: res.layers, parsed, skipped: res.skipped, names } })
      return
    }
    applyImport(res.layers, parsed, res.skipped, 0)
  } catch (e) {
    ui.toast('error', `Import failed: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    ui.set({ importing: false })
  }
}

/** Answer to "these files are already loaded": replace them, add them again, or skip them. */
export function resolveDuplicates(mode: 'replace' | 'keep' | 'skip'): void {
  const ui = useUi.getState()
  const d = ui.pendingDuplicates
  if (!d) return
  ui.set({ pendingDuplicates: null })
  const p = useProject.getState()
  const byName = new Map(p.layers.map((l) => [l.fileName.toLowerCase(), l]))
  const fresh: ImportedLayer[] = []
  let replaced = 0
  for (const l of d.layers) {
    const old = byName.get(l.fileName.toLowerCase())
    if (!old || mode === 'keep') fresh.push(l)
    else if (mode === 'replace' && d.parsed[l.id]) {
      useProject.getState().replaceLayer(old.id, { ...l, visible: old.visible }, d.parsed[l.id])
      replaced++
    }
  }
  applyImport(fresh, d.parsed, d.skipped, replaced)
}

function applyImport(
  layers: ImportedLayer[],
  parsedAll: Record<string, ParsedLayer>,
  skipped: { name: string; reason: string }[],
  replaced: number
): void {
  const ui = useUi.getState()
  const parsed: Record<string, ParsedLayer> = {}
  for (const l of layers) if (parsedAll[l.id]) parsed[l.id] = parsedAll[l.id]
  if (layers.length) useProject.getState().addLayers(layers, parsed)
  ui.set({ skippedFiles: skipped })
  ensureDefaults()
  const warn = layers.flatMap((l) =>
    l.parsed?.warnings.length ? [`${l.fileName}: ${l.parsed.warnings.length} warning(s)`] : []
  )
  const parts = [
    layers.length ? `Imported ${layers.length} layer(s)` : '',
    replaced ? `replaced ${replaced}` : '',
    skipped.length ? `ignored ${skipped.length} unrelated file(s)` : ''
  ].filter(Boolean)
  if (parts.length) {
    const msg = parts.join(', ')
    ui.toast('success', msg[0].toUpperCase() + msg.slice(1) + '.')
  } else
    ui.toast('info', 'Nothing new was imported: the files that were already loaded were kept as they are.')
  if (warn.length) ui.toast('warning', warn.slice(0, 3).join(' · '))
  scheduleRegenerate()
}

async function browse(kind: BrowseKind, eda: EdaTool): Promise<void> {
  const info = edaInfo(eda) ?? EDA_INFO[EDA_INFO.length - 1]
  const exts = info.extensions
  const matches = (name: string): boolean => {
    const m = /\.([^.]+)$/.exec(name)
    return !!m && (exts.includes(m[1].toLowerCase()) || m[1].toLowerCase() === 'zip')
  }
  let files: DroppedFile[] = []
  if (window.tracemill && kind === 'folder') {
    // TraceMill's own folder browser: unlike the Windows one it shows the files inside
    const path = await pickFolder(exts, info.short)
    if (!path) return
    const opened = await window.tracemill.readFolder(path, [...exts, 'zip'])
    files = opened.map((f) => ({
      name: f.name,
      data: f.encoding === 'base64' ? Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0)) : f.data
    }))
  } else if (window.tracemill) {
    const opened = await window.tracemill.openFiles({
      directory: kind === 'folder',
      filters:
        kind === 'zip'
          ? [{ name: 'ZIP archive', extensions: ['zip'] }]
          : [
              { name: `${info.short} fabrication files`, extensions: exts },
              { name: 'All files', extensions: ['*'] }
            ],
      // a folder is read recursively: only take the files this design program produces
      extensions: kind === 'folder' ? [...exts, 'zip'] : undefined
    })
    files = opened.map((f) => ({
      name: f.name,
      data: f.encoding === 'base64' ? Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0)) : f.data
    }))
  } else {
    // Browser fallback
    files = await new Promise<DroppedFile[]>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = kind !== 'zip'
      if (kind === 'folder') input.setAttribute('webkitdirectory', '')
      else input.accept = kind === 'zip' ? '.zip' : exts.map((e) => `.${e}`).join(',')
      input.onchange = async () => {
        const out: DroppedFile[] = []
        for (const f of Array.from(input.files ?? [])) {
          if (kind === 'folder' && !matches(f.name)) continue
          out.push(
            /\.zip$/i.test(f.name)
              ? { name: f.name, data: new Uint8Array(await f.arrayBuffer()) }
              : { name: f.name, data: await f.text() }
          )
        }
        resolve(out)
      }
      input.click()
    })
  }
  if (files.length) await runImport(files, eda)
}

/** Removes a layer; when none are left the list of ignored files from the last import goes too. */
export function removeLayer(id: string): void {
  useProject.getState().removeLayer(id)
  if (!useProject.getState().layers.length) useUi.getState().set({ skippedFiles: [] })
}

/** Plain-language explanation of the Board stage status (shown next to its status circle). */
export function useBoardHint(): string {
  const layers = useProject((s) => s.layers)
  const status = useLayerStatus()
  return useMemo(() => {
    if (!layers.length) return 'Import your fabrication files to begin.'
    const has = (k: string): boolean => !!status.find((s) => s.key === k)?.present
    if (!has('copper')) return 'No copper layer: set the Type of your copper file(s) to Copper.'
    const missing: string[] = []
    if (!has('outline')) missing.push('No board outline, so the board cannot be cut out.')
    if (!has('drill')) missing.push('No drill file, so no holes will be drilled.')
    return missing.length ? `${missing.join(' ')} You can still continue.` : 'Board is ready.'
  }, [layers, status])
}

export async function reimportLayer(id: string): Promise<void> {
  const p = useProject.getState()
  const layer = p.layers.find((l) => l.id === id)
  if (!layer) return
  let text = layer.rawText
  if (window.tracemill) {
    const files = await window.tracemill.openFiles({})
    if (!files.length) return
    text = files[0].data
  }
  const fresh = await camWorker().parseOne(layer.fileName, text, p.settings.edaTool, id, layer.order)
  if (fresh.parsed) p.replaceLayer(id, { ...fresh, fileName: layer.fileName }, fresh.parsed)
  scheduleRegenerate()
}

export async function resetLayerToAuto(id: string): Promise<void> {
  const p = useProject.getState()
  const layer = p.layers.find((l) => l.id === id)
  if (!layer) return
  const fresh = await camWorker().parseOne(layer.fileName, layer.rawText, p.settings.edaTool, id, layer.order)
  p.resetLayerDetection(id, fresh.type, fresh.side)
}

// ───────────────────────────────────────── steps

export async function applyRecipe(): Promise<void> {
  const p = useProject.getState()
  if (!p.machine || !p.material) ensureDefaults()
  const s = useProject.getState()
  if (!s.material || !s.machine) return
  const layers = layersWithParsed(s.layers)
  const hasBottom = layers.some((l) => l.type === 'copper' && l.side === 'bottom')
  const hasTop = layers.some((l) => l.type === 'copper' && l.side === 'top')
  let material = s.material
  if (hasBottom && hasTop && !material.doubleSided) {
    // A double-sided design needs flipping and alignment pins; resize the stock so they fit.
    material = resetMaterialToDefault(
      { ...material, doubleSided: true, alignment: { ...material.alignment, enabled: true } },
      computeBoardBBox(layers)
    )
    s.setMaterial(material)
    useUi
      .getState()
      .toast(
        'info',
        'Your design has copper on both sides, so the material was switched to double-sided with alignment pins.'
      )
  }
  // the isolation settings follow the measured copper spacing (D-031): wait for it
  const copper = layers.filter((l) => l.type === 'copper')
  if (copper.some((l) => !(l.id in useUi.getState().clearance)))
    useUi.getState().toast('info', 'Measuring the gaps between the copper to set up the isolation…')
  const clearance: Record<string, ClearanceInfo | null> = {}
  for (const l of copper) clearance[l.id] = await layerClearance(l.id)
  const now = useProject.getState()
  if (!now.machine) return
  const steps = recipe({
    layers,
    tools: now.tools,
    material,
    machine: now.machine,
    newId: () => uid('S'),
    clearance
  })
  now.setSteps(steps)
  scheduleRegenerate(true)
  const iso = steps.find((x) => x.kind === 'isolate')
  const tool = iso && now.tools.find((t) => t.id === iso.toolId)
  if (iso && tool) {
    const plan = planIsolation(tool, combinedClearance(iso.layerIds.map((id) => clearance[id])), material)
    if (plan.notes.length) useUi.getState().toast('info', plan.notes.join(' '))
  }
}

// ───────────────────────────────────────── places a step cannot machine

/** Opens the problem list of a step on the Manufacture board (on the side the step works on). */
export function showProblems(stepId: string): void {
  const step = useProject.getState().steps.find((s) => s.id === stepId)
  if (!step) return
  useUi.getState().set({
    stage: 'manufacture',
    problemStepId: stepId,
    problemFocus: null,
    selectedStepId: stepId,
    viewSide: step.side
  })
}

function patchStep(stepId: string, fn: (s: CamStep) => CamStep): void {
  const p = useProject.getState()
  const step = p.steps.find((s) => s.id === stepId)
  if (step) p.upsertStep(fn(structuredClone(step)))
}

/** Stops reporting places (they stay unmachined, the warning goes away). */
export function ignoreProblem(stepId: string, problemIds: string | string[]): void {
  const ids = Array.isArray(problemIds) ? problemIds : [problemIds]
  patchStep(stepId, (s) => ({ ...s, ignoredProblems: [...new Set([...(s.ignoredProblems ?? []), ...ids])] }))
  if (ids.includes(useUi.getState().problemFocus ?? '')) useUi.getState().set({ problemFocus: null })
}

/** Reports every place of a step again. */
export function restoreProblems(stepId: string): void {
  patchStep(stepId, (s) => ({ ...s, ignoredProblems: [] }))
}

/** Isolation: places where copper is closer than `mm` are not reported (0 = report all). */
export function setIgnoreGapsBelow(stepId: string, mm: number): void {
  patchStep(stepId, (s) => ({
    ...s,
    params: { ...s.params, isolation: { ...s.params.isolation, ignoreGapsBelow: Math.max(0, mm) } }
  }))
}

export function newStep(kind: StepKind) {
  const s = useProject.getState()
  return createStep(kind, {
    id: uid('S'),
    machine: s.machine ?? undefined,
    material: s.material ?? undefined
  })
}

// ───────────────────────────────────────── generation

let timer: ReturnType<typeof setTimeout> | null = null
let requestId = 0

/** Marks CAM as stale and regenerates (debounced) when auto-regenerate is on or `force`. */
export function scheduleRegenerate(force = false): void {
  useUi.getState().set({ camStale: true })
  const auto = useProject.getState().settings.autoRegenerate
  if (!auto && !force) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    // Re-check: the user may have switched auto-regenerate off while this was queued.
    if (force || useProject.getState().settings.autoRegenerate) void regenerate()
  }, 350)
}

// ───────────────────────────────────────── copper spacing (D-031)

const clearanceJobs = new Map<string, { geometry: unknown; promise: Promise<ClearanceInfo | null> }>()

/**
 * Measured copper spacing of one copper layer. Runs once per parsed geometry in the background
 * worker; the result also lands in `useUi().clearance`.
 */
export function layerClearance(layerId: string): Promise<ClearanceInfo | null> {
  const geometry = parsedCache.get(layerId)?.geometry
  if (!geometry?.length) return Promise.resolve(null)
  const job = clearanceJobs.get(layerId)
  if (job && job.geometry === geometry) return job.promise
  const promise = analysisWorker()
    .analyzeClearance(geometry)
    .then((info) => {
      if (clearanceJobs.get(layerId)?.geometry === geometry)
        useUi.getState().set({ clearance: { ...useUi.getState().clearance, [layerId]: info } })
      return info
    })
    .catch(() => null)
  clearanceJobs.set(layerId, { geometry, promise })
  return promise
}

/** Copper spacing of a step's copper layers (the narrowest of them). */
export async function stepClearance(layerIds: string[]): Promise<ClearanceInfo | null> {
  const copper = useProject
    .getState()
    .layers.filter((l) => layerIds.includes(l.id) && l.type === 'copper')
    .map((l) => l.id)
  return combinedClearance(await Promise.all(copper.map(layerClearance)))
}

/** Starts measuring every copper layer that is not measured yet (called after import / parse). */
export function analyzeCopperLayers(): void {
  for (const l of useProject.getState().layers) if (l.type === 'copper') void layerClearance(l.id)
}

const gapCache = new Map<string, number | null>()

/**
 * Narrowest distance between copper features on these layers (null: nothing closer than 1 mm), so
 * the tool picker can recommend V-bits whose groove fits. Cached per layers / parsed version.
 */
export async function measureNarrowestGap(layerIds: string[], ignoreBelow = 0): Promise<number | null> {
  const s = useProject.getState()
  const key = `${[...layerIds].sort().join(',')}|${s.parsedVersion}|${ignoreBelow}`
  if (gapCache.has(key)) return gapCache.get(key)!
  // Each layer on its own: top and bottom copper overlap when drawn together, which is no gap at all.
  let gap: number | null = null
  for (const id of layerIds) {
    const copper = parsedCache.get(id)?.geometry
    if (!copper?.length) continue
    const g = await camWorker().narrowestGap(copper, 1, ignoreBelow)
    if (g !== null && (gap === null || g < gap)) gap = g
  }
  gapCache.set(key, gap)
  return gap
}

/**
 * The toolpath an edited (unsaved) step would get, for the live results in the step editor. Runs
 * in the background worker so it does not wait behind a full regeneration.
 */
export async function previewStepToolpath(
  draft: CamStep
): Promise<{ toolpath: Toolpath | null; error: string | null }> {
  const s = useProject.getState()
  if (!s.machine || !s.material) return { toolpath: null, error: null }
  const steps = s.steps.some((x) => x.id === draft.id)
    ? s.steps.map((x) => (x.id === draft.id ? draft : x))
    : [...s.steps, draft]
  return analysisWorker().previewStep(
    { layers: layersWithParsed(s.layers), steps, tools: s.tools, material: s.material, machine: s.machine },
    draft
  )
}

export async function regenerate(): Promise<void> {
  const s = useProject.getState()
  if (!s.machine || !s.material || !s.layers.length) return
  const id = ++requestId
  const ui = useUi.getState()
  ui.set({ generating: true, camError: null })
  try {
    const res = await camWorker().runCam(
      {
        projectName: safeName(s.name),
        layers: layersWithParsed(s.layers),
        steps: s.steps,
        tools: s.tools,
        material: s.material,
        machine: s.machine,
        grouping: s.settings.exportGrouping
      },
      Comlink.proxy((stepId: string | null) => {
        if (id === requestId) useUi.getState().set({ generatingStepId: stepId })
      })
    )
    if (id !== requestId) return // a newer request superseded this one
    useUi.getState().set({ cam: res, camVersion: useUi.getState().camVersion + 1, camStale: false })
  } catch (e) {
    if (id === requestId) useUi.getState().set({ camError: e instanceof Error ? e.message : String(e) })
  } finally {
    if (id === requestId) useUi.getState().set({ generating: false, generatingStepId: null })
  }
}

function safeName(n: string): string {
  return (
    n
      .trim()
      .replace(/[^a-z0-9_-]+/gi, '_')
      .replace(/^_+|_+$/g, '') || 'board'
  )
}

// Regenerate whenever CAM-relevant inputs change.
let prev: Pick<ProjectState, 'steps' | 'tools' | 'material' | 'machine' | 'layers' | 'parsedVersion'> | null =
  null
useProject.subscribe((s) => {
  const cur = {
    steps: s.steps,
    tools: s.tools,
    material: s.material,
    machine: s.machine,
    layers: s.layers,
    parsedVersion: s.parsedVersion
  }
  if (prev && (Object.keys(cur) as (keyof typeof cur)[]).some((k) => cur[k] !== prev![k])) {
    if (cur.layers !== prev.layers || cur.parsedVersion !== prev.parsedVersion) syncMaterialToBoard()
    if (useProject.getState().steps.length) scheduleRegenerate()
  }
  prev = cur
})

// ───────────────────────────────────────── project files

/** Bumped by "New project": imports and generations started before it are dropped when they finish. */
let epoch = 0

/** "New project": asks first when there are unsaved changes (in-app dialog), then starts empty. */
export function newProject(): void {
  if (useProject.getState().dirty) useUi.getState().set({ confirmNew: true })
  else startNewProject()
}

/** Empties the project and every piece of UI state that belongs to it. */
export function startNewProject(): void {
  epoch++
  requestId++ // a generation still running belongs to the old project
  if (timer) clearTimeout(timer)
  timer = null
  gapCache.clear()
  useProject.getState().reset()
  useProject.temporal.getState().clear()
  useUi.getState().set({
    confirmNew: false,
    stage: 'board',
    viewSide: 'top',
    boardSide: 'top',
    cam: null,
    camStale: true,
    camError: null,
    generating: false,
    generatingStepId: null,
    pendingImport: null,
    pendingBrowse: null,
    pendingDuplicates: null,
    importing: false,
    skippedFiles: [],
    selectedStepId: null,
    problemStepId: null,
    problemFocus: null
  })
}

export async function saveProject(saveAs = false): Promise<void> {
  const s = useProject.getState()
  ensureDefaults()
  let text: string
  try {
    if (s.name === UNNAMED_PROJECT) useProject.getState().setName(suggestProjectName())
    text = serializeProject(toProject(useProject.getState()))
  } catch (e) {
    useUi.getState().toast('error', e instanceof Error ? e.message : String(e))
    return
  }
  const projectName = useProject.getState().name
  const name = `${safeName(projectName)}.tmill`
  if (window.tracemill) {
    const path = await window.tracemill.saveFile({
      defaultName: saveAs || !s.filePath ? name : s.filePath,
      path: !saveAs && s.filePath ? s.filePath : undefined,
      content: text,
      filters: [{ name: 'TraceMill project', extensions: ['tmill'] }]
    })
    if (!path) return
    useProject.getState().setFilePath(path)
  } else downloadText(name, text)
  rememberProjectName(projectName)
  useProject.getState().markClean()
  useUi.getState().toast('success', 'Project saved.')
}

export async function openProject(): Promise<void> {
  let content: string | null = null
  let path: string | null = null
  if (window.tracemill) {
    const r = await window.tracemill.openProject()
    if (!r) return
    content = r.content
    path = r.path
  } else {
    content = await pickTextFile('.tmill')
  }
  if (!content) return
  try {
    const project = await loadProjectText(content, path)
    useProject.getState().markClean()
    useUi.getState().set({ stage: 'board' })
    useUi.getState().toast('success', `Opened "${project.name}".`)
  } catch (e) {
    useUi.getState().toast('error', e instanceof Error ? e.message : String(e))
  }
}

/** Loads .tmill text into the stores (re-parsing every layer) and starts a regeneration. Throws on bad input. */
export async function loadProjectText(content: string, path: string | null): Promise<Project> {
  const project = deserializeProject(content)
  const parsed: Record<string, ParsedLayer> = {}
  for (const l of project.layers) {
    const fresh = await camWorker().parseOne(l.fileName, l.rawText, project.settings.edaTool, l.id, l.order)
    if (fresh.parsed) parsed[l.id] = fresh.parsed
  }
  useProject.getState().loadProject(project, parsed, path)
  refreshToolFeeds()
  refreshMachineHeights()
  addUserTools()
  useProject.temporal.getState().clear()
  useUi.getState().set({ cam: null, camStale: true })
  void regenerate()
  return project
}

export function downloadText(name: string, text: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export function pickTextFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = async () => resolve(input.files?.[0] ? await input.files[0].text() : null)
    input.click()
  })
}

export function undo(): void {
  useProject.temporal.getState().undo()
}
export function redo(): void {
  useProject.temporal.getState().redo()
}

export { parsedCache }

// ───────────────────────────────────────── test / automation hook
declare global {
  interface Window {
    __tm?: {
      importDropped: typeof importDropped
      resolveEda: typeof resolveEda
      resolveDuplicates: typeof resolveDuplicates
      applyRecipe: typeof applyRecipe
      loadProjectText: typeof loadProjectText
      regenerate: typeof regenerate
      project: typeof useProject
      ui: typeof useUi
    }
  }
}
window.__tm = {
  importDropped,
  resolveEda,
  resolveDuplicates,
  applyRecipe,
  loadProjectText,
  regenerate,
  project: useProject,
  ui: useUi
}
