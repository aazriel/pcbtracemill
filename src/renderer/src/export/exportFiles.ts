/**
 * The list of files the Export stage offers, with the optional height-map correction applied
 * (in the CAM worker, because levelling subdivides every cutting move and can be slow).
 */
import { useEffect, useMemo, useState } from 'react'
import type { GcodeFile, MachineProfile } from '@core/model/types'
import {
  addZTouchOff,
  MACH3_SLOW_FEED,
  touchOffStepOrder,
  type TouchOffOptions,
  type TouchPoint,
  type TouchPointRequest
} from '@core/heightmap'
import { camWorker } from '@workers/index'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { downloadText, useBoardBBox } from '@renderer/store/controller'
import { useAutoLevel } from '@renderer/heightmap/state'
import { useWorkScene } from '@renderer/heightmap/geometry'

export type Side = 'top' | 'bottom'

export interface ExportFile {
  file: GcodeFile
  /** Text that will be written (levelled when the correction applies). */
  text: string
  sizeBytes: number
  sides: Side[]
  /** Z correction from the height map was applied to this file. */
  levelled: boolean
  /** The file finds Z0 with the probe before each bit. */
  touchOff: boolean
  /** Why the file is NOT probed although probing is switched on. */
  levelSkip: string | null
  /** The user wants this file probed (Auto-level step 3, per file). */
  probeOn: boolean
  /** Where each bit of the file finds Z0 (in order), when it does. */
  touchPoints: TouchPoint[]
}

type PointMap = Map<string, TouchPoint | null>
type FilePlan = { points: TouchPoint[] } | { error: string }

const encoder = new TextEncoder()
const NO_STEPS: string[] = []

/** Which board sides a file mills, from the toolpaths in the CAM result. */
function sidesOf(file: GcodeFile, sideByStep: Map<string, Side>): Side[] {
  const out: Side[] = []
  for (const id of file.stepIds) {
    const s = sideByStep.get(id)
    if (s && !out.includes(s)) out.push(s)
  }
  return out
}

function touchOffAt(machine: MachineProfile, x: number, y: number, probeFeed: number): TouchOffOptions {
  return {
    x,
    y,
    feed: probeFeed > 0 ? probeFeed : 50,
    safeZ: machine.safeZ,
    dialect: machine.postProcessor,
    probeCommand: machine.probeCommand,
    // the cutting bit touches: one slow touch so a 0.1 mm V-bit tip survives
    slowFeed: MACH3_SLOW_FEED
  }
}

export function levelSkipReason(sides: Side[], measured: Side): string | null {
  if (sides.length > 1)
    return 'Mills both sides in one file – the height map only fits the side that was face-up while probing.'
  if (sides[0] && sides[0] !== measured)
    return `Mills the ${sides[0]} side, but the board was probed with the ${measured} side up.`
  return null
}

/** The step id of every line of a file (to find which step follows each touch-off). */
function lineSteps(file: GcodeFile): (string | null)[] {
  const out: (string | null)[] = []
  for (const m of file.lineMeta) out[m.line] = m.stepId
  return out
}

/**
 * The touch-off point of each bit of a file, or why the probe cannot find Z0 in it (no copper left
 * that is still connected to the probe clip, D-037). Null while the points are not known yet.
 */
function filePlan(file: GcodeFile, points: PointMap | null, names: Map<string, string>): FilePlan | null {
  if (!points) return null
  const out: TouchPoint[] = []
  for (const id of touchOffStepOrder(file.text, lineSteps(file))) {
    const p = id ? points.get(id) : undefined
    if (p === undefined) return null
    if (p === null)
      return {
        error: `no copper left where the probe can touch for “${names.get(id!) ?? 'a step'}” – set Z0 by hand for this file.`
      }
    out.push(p)
  }
  return { points: out }
}

/** Touch-off points of every step, computed in the CAM worker (null while not needed or not ready). */
function useTouchPoints(withGrid: boolean, free: boolean): { grid: PointMap | null; free: PointMap | null } {
  const cam = useUi((s) => s.cam)
  const map = useProject((s) => s.heightMap)
  const tools = useProject((s) => s.tools)
  const material = useProject((s) => s.material)
  const choice = useProject((s) => s.settings.autoLevelTouchPoint)
  const custom = useProject((s) => s.settings.autoLevelTouchXY)
  const stepPoints = useProject((s) => s.settings.autoLevelStepTouch)
  const bbox = useBoardBBox()
  const sceneTop = useWorkScene('top')
  const sceneBottom = useWorkScene('bottom')
  const grid = map?.config
  const key = useMemo(
    () => [
      cam,
      grid,
      tools,
      material,
      choice,
      custom,
      stepPoints,
      bbox,
      sceneTop,
      sceneBottom,
      withGrid,
      free
    ],
    [cam, grid, tools, material, choice, custom, stepPoints, bbox, sceneTop, sceneBottom, withGrid, free]
  )
  const [res, setRes] = useState<{ key: unknown[]; grid: PointMap | null; free: PointMap | null } | null>(
    null
  )
  useEffect(() => {
    if (!cam || !material || (!withGrid && !free)) return
    let cancelled = false
    const req: TouchPointRequest = {
      toolpaths: cam.toolpaths,
      tools,
      material,
      boardBBox: bbox,
      boardShape: { top: sceneTop?.shape ?? [], bottom: sceneBottom?.shape ?? [] },
      grid: null,
      choice: choice ?? 'center',
      custom: custom ?? null,
      stepPoints: stepPoints ?? {}
    }
    void (async () => {
      try {
        const g = withGrid && grid ? await camWorker().touchPoints({ ...req, grid }) : null
        const f = free ? await camWorker().touchPoints(req) : null
        if (!cancelled) setRes({ key, grid: g, free: f })
      } catch {
        if (!cancelled) setRes({ key, grid: null, free: null })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    key,
    cam,
    material,
    withGrid,
    free,
    tools,
    bbox,
    sceneTop,
    sceneBottom,
    choice,
    custom,
    stepPoints,
    grid
  ])
  return res && res.key === key ? res : { grid: null, free: null }
}

export function useExportFiles(): { files: ExportFile[]; levelling: boolean; levelError: string | null } {
  const cam = useUi((s) => s.cam)
  const map = useProject((s) => s.heightMap)
  const apply = useAutoLevel((s) => s.apply)
  const measured = useAutoLevel((s) => s.measuredSide)
  const touchOffOn = useAutoLevel((s) => s.touchOff)
  const probeZeroOn = useAutoLevel((s) => s.probeZero)
  const skipSteps = useProject((s) => s.settings.autoLevelSkipSteps) ?? NO_STEPS
  const machine = useProject((s) => s.machine)
  const [levelled, setLevelled] = useState<{ key: unknown[]; texts: Map<string, string> } | null>(null)
  const [levelError, setLevelError] = useState<string | null>(null)

  const names = useMemo(() => new Map((cam?.toolpaths ?? []).map((t) => [t.stepId, t.stepName])), [cam])
  const base = useMemo(() => {
    const sideByStep = new Map<string, Side>()
    for (const tp of cam?.toolpaths ?? []) sideByStep.set(tp.stepId, tp.side)
    return (cam?.files ?? []).map((file) => {
      const sides = sidesOf(file, sideByStep)
      const probeOn = !file.stepIds.length || !file.stepIds.every((id) => skipSteps.includes(id))
      return { file, sides, skip: levelSkipReason(sides, measured), probeOn }
    })
  }, [cam, measured, skipSteps])

  const active = apply && !!map
  const touching = active && touchOffOn && !!machine
  const pts = useTouchPoints(touching, probeZeroOn && !!machine)

  // Height-corrected files: the touch-off point of every bit (null: still being computed)
  const levelPlan = useMemo(() => {
    const plan = new Map<string, FilePlan>()
    if (!active) return plan
    for (const b of base) {
      if (b.skip || !b.probeOn) continue
      if (!touching) {
        plan.set(b.file.name, { points: [] })
        continue
      }
      const fp = filePlan(b.file, pts.grid, names)
      if (!fp) return null
      plan.set(b.file.name, fp)
    }
    return plan
  }, [active, touching, base, pts.grid, names])

  // Files without a height-map correction: find Z0 with the probe before each bit where the copper allows
  const zeroed = useMemo(() => {
    const out = new Map<string, { text: string; points: TouchPoint[] } | { error: string }>()
    if (!probeZeroOn || !machine || !pts.free) return out
    for (const b of base) {
      if (!b.probeOn) continue
      const fp = filePlan(b.file, pts.free, names)
      if (!fp) continue
      if ('error' in fp) {
        out.set(b.file.name, fp)
        continue
      }
      const first = fp.points[0]
      if (!first) continue
      out.set(b.file.name, {
        text: addZTouchOff(b.file.text, { ...touchOffAt(machine, first.x, first.y, 0), points: fp.points }),
        points: fp.points
      })
    }
    return out
  }, [probeZeroOn, machine, base, pts.free, names])

  const key = useMemo(
    () => [base, map, levelPlan, machine, touching],
    [base, map, levelPlan, machine, touching]
  )
  useEffect(() => {
    if (!active || !map || !levelPlan) return
    let cancelled = false
    const run = async (): Promise<void> => {
      const texts = new Map<string, string>()
      try {
        for (const b of base) {
          const plan = levelPlan.get(b.file.name)
          if (!plan || 'error' in plan) continue
          const first = plan.points[0]
          const touch =
            touching && machine && first
              ? { ...touchOffAt(machine, first.x, first.y, map.config.probeFeed), points: plan.points }
              : undefined
          texts.set(b.file.name, await camWorker().level(b.file.text, map, touch))
          if (cancelled) return
        }
        setLevelError(null)
      } catch (e) {
        setLevelError(e instanceof Error ? e.message : String(e))
      }
      if (!cancelled) setLevelled({ key, texts })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [key, active, map, levelPlan, base, touching, machine])

  const ready = !!levelled && levelled.key === key
  const files = useMemo<ExportFile[]>(
    () =>
      base.map((b) => {
        const plan = levelPlan?.get(b.file.name)
        const lv = active && ready ? levelled!.texts.get(b.file.name) : undefined
        const z = lv ? undefined : zeroed.get(b.file.name)
        const zt = z && 'text' in z ? z : undefined
        const text = lv ?? zt?.text ?? b.file.text
        const planError = plan && 'error' in plan ? plan.error : null
        const zeroError = z && 'error' in z ? z.error : null
        return {
          file: b.file,
          text,
          sizeBytes: text !== b.file.text ? encoder.encode(text).length : b.file.sizeBytes,
          sides: b.sides,
          levelled: !!lv,
          touchOff: (!!lv && touching) || !!zt,
          levelSkip: active && b.probeOn ? (b.skip ?? planError) : zeroError,
          probeOn: b.probeOn,
          touchPoints: lv && plan && 'points' in plan ? plan.points : (zt?.points ?? [])
        }
      }),
    [base, active, ready, levelled, touching, zeroed, levelPlan]
  )
  return { files, levelling: active && (!ready || !levelPlan), levelError: active ? levelError : null }
}

/** The user's own Z touch-off point for one bit (step), or back to the automatic point (null). */
export function setStepTouchPoint(stepId: string, p: { x: number; y: number } | null): void {
  const s = useProject.getState()
  const cur = { ...(s.settings.autoLevelStepTouch ?? {}) }
  if (p) cur[stepId] = { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }
  else delete cur[stepId]
  s.setSettings({ autoLevelStepTouch: cur })
}

/** Probe (height-correct + touch off) the files of these steps, or leave them as they are. */
export function setStepsProbed(stepIds: string[], on: boolean): void {
  const p = useProject.getState()
  const cur = new Set(p.settings.autoLevelSkipSteps ?? [])
  for (const id of stepIds) {
    if (on) cur.delete(id)
    else cur.add(id)
  }
  p.setSettings({ autoLevelSkipSteps: [...cur] })
}

export function gcodeFileFilters(machine: MachineProfile | null): { name: string; extensions: string[] }[] {
  const ext = (machine?.fileExtension || 'nc').replace(/^\.+/, '')
  return [
    { name: `G-code (*.${ext})`, extensions: [ext] },
    { name: 'All files', extensions: ['*'] }
  ]
}

/** Errors from the main process arrive as "Error invoking remote method '…': Error: <message>". */
function showSaveError(e: unknown): void {
  const msg = (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']*': (Error: )?/,
    ''
  )
  useUi.getState().toast('error', `Not saved: ${msg}`)
}

/**
 * Save one file: native "Save as" in the desktop app (returns the path), browser download
 * otherwise (true); false when cancelled or failed.
 */
export async function saveOne(name: string, text: string): Promise<string | boolean> {
  if (window.tracemill) {
    try {
      const path = await window.tracemill.saveFile({
        defaultName: name,
        content: text,
        filters: gcodeFileFilters(useProject.getState().machine)
      })
      return path || false
    } catch (e) {
      showSaveError(e)
      return false
    }
  }
  downloadText(name, text)
  return true
}

/** Save several files: pick a folder in the desktop app, one download per file in the browser. */
export async function saveMany(files: { name: string; text: string }[]): Promise<string | null | true> {
  if (window.tracemill) {
    try {
      return await window.tracemill.saveFilesToDir(files.map((f) => ({ name: f.name, content: f.text })))
    } catch (e) {
      showSaveError(e)
      return null
    }
  }
  files.forEach((f, i) => setTimeout(() => downloadText(f.name, f.text), i * 250))
  return true
}
