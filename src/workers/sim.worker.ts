/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { geoToSimAffine, setupSimulation, type SimMarker, type SimSetupRequest } from '@core/pipeline/sim'
import {
  invertAffine,
  takeDirty,
  trailPolyline,
  type Affine,
  type SimSide,
  type SimRunner,
  type ToolPosition
} from '@core/sim'
import { stockToWork } from '@core/toolpath'
import { union } from '@core/geometry'
import type { PolygonSet, SimMove } from '@core/model/types'

export interface SimFieldInit {
  nx: number
  ny: number
  res: number
  width: number
  height: number
  thickness: number
  copperThickness: number
  top: Float32Array
  mat: Uint8Array
  design: Uint8Array | null
}

/**
 * Compact copy of the interpreted program for the UI thread (tool position, trail, G-code sync
 * without a worker round trip). XY are STOCK coordinates of the face being machined; Z is work Z.
 */
export interface SimMoveData {
  count: number
  /** from.xyz, to.xyz per move (6 floats). */
  xyz: Float32Array
  /** 0 = rapid, 1 = feed. */
  kind: Uint8Array
  /** Index into `stepIds` (-1 = none). */
  step: Int16Array
  /** Index into `toolIds` (-1 = none). */
  tool: Int16Array
  /** G-code line per move. */
  line: Int32Array
  /** Cumulative time at the end of each move (s). */
  tEnd: Float64Array
  stepIds: string[]
  toolIds: string[]
}

export interface SimInitResult {
  totalTime: number
  markers: SimMarker[]
  warnings: string[]
  fields: Partial<Record<SimSide, SimFieldInit>>
  /** Compact move timeline for the G-code panel: [line, tEnd] pairs. */
  lineTimes: Float64Array
  moves: SimMoveData
  sides: Record<string, SimSide>
}

/** Extra init inputs: per-layer design copper, unioned here so the UI thread never blocks. */
export interface SimInitRequest extends SimSetupRequest {
  designTopParts?: PolygonSet[]
  designBottomParts?: PolygonSet[]
}

export interface SimRegion {
  side: SimSide
  x0: number
  y0: number
  x1: number
  y1: number
  top: Float32Array
  mat: Uint8Array
}

export interface SimFrame {
  time: number
  pos: ToolPosition | null
  regions: SimRegion[]
}

let runner: SimRunner | null = null
let moves: SimMove[] = []
let w2s: Affine = [1, 0, 0, 0, 1, 0]

function mergeParts(
  parts: PolygonSet[] | undefined,
  fallback: PolygonSet | undefined
): PolygonSet | undefined {
  if (!parts || !parts.length) return fallback
  return parts.length === 1 ? parts[0] : union(...parts)
}

function snapshotFields(transfer: ArrayBuffer[]): Partial<Record<SimSide, SimFieldInit>> {
  const fields: Partial<Record<SimSide, SimFieldInit>> = {}
  if (!runner) return fields
  for (const side of ['top', 'bottom'] as SimSide[]) {
    const live = runner.stock(side)
    if (!live) continue
    // The snapshot is the full current state, so any pending dirty rect is no longer needed.
    takeDirty(live)
    const st = runner.snapshot(side)
    if (!st) continue
    fields[side] = {
      nx: st.nx,
      ny: st.ny,
      res: st.res,
      width: st.width,
      height: st.height,
      thickness: st.thickness,
      copperThickness: st.copperThickness,
      top: st.top,
      mat: st.mat,
      design: st.copperMask ? st.copperMask.slice() : null
    }
    transfer.push(st.top.buffer as ArrayBuffer, st.mat.buffer as ArrayBuffer)
    if (fields[side]!.design) transfer.push(fields[side]!.design!.buffer as ArrayBuffer)
  }
  return fields
}

function packMoves(list: SimMove[]): SimMoveData {
  const n = list.length
  const stepIds: string[] = []
  const toolIds: string[] = []
  const stepIdx = new Map<string, number>()
  const toolIdx = new Map<string, number>()
  const xyz = new Float32Array(n * 6)
  const kind = new Uint8Array(n)
  const step = new Int16Array(n)
  const tool = new Int16Array(n)
  const line = new Int32Array(n)
  const tEnd = new Float64Array(n)
  const a = w2s
  for (let i = 0; i < n; i++) {
    const m = list[i]
    const o = i * 6
    xyz[o] = a[0] * m.from[0] + a[1] * m.from[1] + a[2]
    xyz[o + 1] = a[3] * m.from[0] + a[4] * m.from[1] + a[5]
    xyz[o + 2] = m.from[2]
    xyz[o + 3] = a[0] * m.to[0] + a[1] * m.to[1] + a[2]
    xyz[o + 4] = a[3] * m.to[0] + a[4] * m.to[1] + a[5]
    xyz[o + 5] = m.to[2]
    kind[i] = m.kind === 'rapid' ? 0 : 1
    if (m.stepId === null) step[i] = -1
    else {
      let k = stepIdx.get(m.stepId)
      if (k === undefined) {
        k = stepIds.length
        stepIds.push(m.stepId)
        stepIdx.set(m.stepId, k)
      }
      step[i] = k
    }
    if (m.toolId === null) tool[i] = -1
    else {
      let k = toolIdx.get(m.toolId)
      if (k === undefined) {
        k = toolIds.length
        toolIds.push(m.toolId)
        toolIdx.set(m.toolId, k)
      }
      tool[i] = k
    }
    line[i] = m.line
    tEnd[i] = m.tEnd
  }
  return { count: n, xyz, kind, step, tool, line, tEnd, stepIds, toolIds }
}

const api = {
  init(req: SimInitRequest): SimInitResult {
    const { designTopParts, designBottomParts, ...base } = req
    const s = setupSimulation({
      ...base,
      designTop: mergeParts(designTopParts, base.designTop),
      designBottom: mergeParts(designBottomParts, base.designBottom)
    })
    runner = s.runner
    moves = s.moves
    // Work → stock XY (identical for both faces, see setupSimulation).
    w2s = invertAffine(geoToSimAffine(stockToWork(req.material, req.boardBBox)))
    const transfer: ArrayBuffer[] = []
    const fields = snapshotFields(transfer)
    const lineTimes = new Float64Array(moves.length * 2)
    moves.forEach((m, i) => {
      lineTimes[i * 2] = m.line
      lineTimes[i * 2 + 1] = m.tEnd
    })
    const packed = packMoves(moves)
    transfer.push(
      lineTimes.buffer,
      packed.xyz.buffer as ArrayBuffer,
      packed.kind.buffer as ArrayBuffer,
      packed.step.buffer as ArrayBuffer,
      packed.tool.buffer as ArrayBuffer,
      packed.line.buffer as ArrayBuffer,
      packed.tEnd.buffer as ArrayBuffer
    )
    return Comlink.transfer(
      {
        totalTime: s.totalTime,
        markers: s.markers,
        warnings: s.warnings,
        fields,
        lineTimes,
        moves: packed,
        sides: s.sides
      },
      transfer
    )
  },
  /** Full copy of both faces in their current state (e.g. after the WebGL view was recreated). */
  fields(): Partial<Record<SimSide, SimFieldInit>> {
    const transfer: ArrayBuffer[] = []
    const f = snapshotFields(transfer)
    return Comlink.transfer(f, transfer)
  },
  seek(time: number): SimFrame {
    if (!runner) return { time, pos: null, regions: [] }
    runner.seek(time)
    const regions: SimRegion[] = []
    const transfer: ArrayBuffer[] = []
    for (const side of ['top', 'bottom'] as SimSide[]) {
      const r = runner.takeDirtyRegion(side)
      if (!r) continue
      regions.push({ side, ...r })
      transfer.push(r.top.buffer as ArrayBuffer, r.mat.buffer as ArrayBuffer)
    }
    return Comlink.transfer({ time: runner.currentTime, pos: runner.toolPosition(time), regions }, transfer)
  },
  /** Recent tool path in STOCK coordinates (xyz triples, oldest first). */
  trail(time: number, maxPoints: number, stepId: string | null): Float32Array {
    const out = trailPolyline(moves, time, maxPoints, w2s, stepId ? (m) => m.stepId === stepId : undefined)
    return Comlink.transfer(out, [out.buffer as ArrayBuffer])
  },
  dispose(): void {
    runner = null
    moves = []
  }
}

export type SimWorkerApi = typeof api
Comlink.expose(api)
