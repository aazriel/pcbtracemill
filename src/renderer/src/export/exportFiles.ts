/**
 * The list of files the Export stage offers, with the optional height-map correction applied
 * (in the CAM worker, because levelling subdivides every cutting move and can be slow).
 */
import { useEffect, useMemo, useState } from 'react'
import type { GcodeFile, MachineProfile } from '@core/model/types'
import {
  addZTouchOff,
  defaultProbeGrid,
  MACH3_SLOW_FEED,
  probePoints,
  type TouchOffOptions
} from '@core/heightmap'
import { camWorker } from '@workers/index'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { downloadText } from '@renderer/store/controller'
import { useAutoLevel } from '@renderer/heightmap/state'
import { boardProbeArea, useWorkScene } from '@renderer/heightmap/geometry'

export type Side = 'top' | 'bottom'

export interface ExportFile {
  file: GcodeFile
  /** Text that will be written (levelled when the correction applies). */
  text: string
  sizeBytes: number
  sides: Side[]
  /** Z correction from the height map was applied to this file. */
  levelled: boolean
  /** The file finds Z0 with the probe before each bit (at point 1 of the height map when corrected). */
  touchOff: boolean
  /** Why the correction is NOT applied although it is switched on. */
  levelSkip: string | null
}

const encoder = new TextEncoder()

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

export function useExportFiles(): { files: ExportFile[]; levelling: boolean; levelError: string | null } {
  const cam = useUi((s) => s.cam)
  const map = useProject((s) => s.heightMap)
  const apply = useAutoLevel((s) => s.apply)
  const measured = useAutoLevel((s) => s.measuredSide)
  const touchOffOn = useAutoLevel((s) => s.touchOff)
  const probeZeroOn = useAutoLevel((s) => s.probeZero)
  const machine = useProject((s) => s.machine)
  const sceneTop = useWorkScene('top')
  const sceneBottom = useWorkScene('bottom')
  const [levelled, setLevelled] = useState<{ key: unknown[]; texts: Map<string, string> } | null>(null)
  const [levelError, setLevelError] = useState<string | null>(null)

  const base = useMemo(() => {
    const sideByStep = new Map<string, Side>()
    for (const tp of cam?.toolpaths ?? []) sideByStep.set(tp.stepId, tp.side)
    return (cam?.files ?? []).map((file) => {
      const sides = sidesOf(file, sideByStep)
      return { file, sides, skip: levelSkipReason(sides, measured) }
    })
  }, [cam, measured])

  const active = apply && !!map
  const touch = useMemo<TouchOffOptions | undefined>(() => {
    if (!touchOffOn || !map || !machine) return undefined
    const p1 = probePoints(map.config)[0]
    return touchOffAt(machine, p1.x, p1.y, map.config.probeFeed)
  }, [touchOffOn, map, machine])

  // Files without a height-map correction: probe Z0 at point 1 of the default probe grid of their side
  const zeroed = useMemo(() => {
    const texts = new Map<string, string>()
    if (!probeZeroOn || !machine) return texts
    const at = (side: Side): { x: number; y: number } | null => {
      const sc = side === 'top' ? sceneTop : sceneBottom
      return sc ? probePoints(defaultProbeGrid(boardProbeArea(sc), 10))[0] : null
    }
    for (const b of base) {
      const pts = (b.sides.length ? b.sides : (['top'] as Side[])).map(at)
      const p = pts[0]
      // a file that mills both sides would need a different point after the flip
      if (!p || pts.some((q) => !q || Math.hypot(q.x - p.x, q.y - p.y) > 1e-6)) continue
      texts.set(b.file.name, addZTouchOff(b.file.text, touchOffAt(machine, p.x, p.y, 0)))
    }
    return texts
  }, [probeZeroOn, machine, base, sceneTop, sceneBottom])
  const key = useMemo(() => [base, map, touch], [base, map, touch])

  useEffect(() => {
    if (!active || !map) return
    let cancelled = false
    const run = async (): Promise<void> => {
      const texts = new Map<string, string>()
      try {
        for (const b of base) {
          if (b.skip) continue
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
  }, [active, base, map, touch, key])

  const ready = !!levelled && levelled.key === key
  const files = useMemo<ExportFile[]>(
    () =>
      base.map((b) => {
        const lv = active && ready ? levelled!.texts.get(b.file.name) : undefined
        const zt = lv ? undefined : zeroed.get(b.file.name)
        const text = lv ?? zt ?? b.file.text
        return {
          file: b.file,
          text,
          sizeBytes: text !== b.file.text ? encoder.encode(text).length : b.file.sizeBytes,
          sides: b.sides,
          levelled: !!lv,
          touchOff: (!!lv && !!touch) || !!zt,
          levelSkip: active ? b.skip : null
        }
      }),
    [base, active, ready, levelled, touch, zeroed]
  )
  return { files, levelling: active && !ready, levelError: active ? levelError : null }
}

export function gcodeFileFilters(machine: MachineProfile | null): { name: string; extensions: string[] }[] {
  const ext = (machine?.fileExtension || 'nc').replace(/^\.+/, '')
  return [
    { name: `G-code (*.${ext})`, extensions: [ext] },
    { name: 'All files', extensions: ['*'] }
  ]
}

/** Save one file: native "Save as" in the desktop app, browser download otherwise. */
export async function saveOne(name: string, text: string): Promise<boolean> {
  if (window.tracemill) {
    const path = await window.tracemill.saveFile({
      defaultName: name,
      content: text,
      filters: gcodeFileFilters(useProject.getState().machine)
    })
    return !!path
  }
  downloadText(name, text)
  return true
}

/** Save several files: pick a folder in the desktop app, one download per file in the browser. */
export async function saveMany(files: { name: string; text: string }[]): Promise<string | null | true> {
  if (window.tracemill)
    return window.tracemill.saveFilesToDir(files.map((f) => ({ name: f.name, content: f.text })))
  files.forEach((f, i) => setTimeout(() => downloadText(f.name, f.text), i * 250))
  return true
}
