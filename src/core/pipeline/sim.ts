/**
 * Simulation setup: turns a G-code program + project data into a SimRunner.
 * Bridges the geometry Affine layout [a,b,c,d,e,f] (x' = a·x + c·y + e) and the sim module's
 * layout [a,b,c,d,e,f] (x' = a·x + b·y + c) in ONE place.
 */
import type {
  BBox,
  GcodeLineMeta,
  MachineProfile,
  Material,
  PolygonSet,
  SimMove,
  Tool,
  Toolpath
} from '../model/types'
import { compose as composeGeo, type Affine as GeoAffine } from '../geometry'
import { boardToStockTransform, flipTransform, stockToWork } from '../toolpath'
import { interpretGcode, machineTiming } from '../gcode'
import {
  SimRunner,
  createStock,
  invertAffine,
  rasterizeCopperMask,
  type Affine as SimAffine,
  type SimStock
} from '../sim'

export function geoToSimAffine(m: GeoAffine): SimAffine {
  return [m[0], m[2], m[4], m[1], m[3], m[5]]
}

export interface SimSetupRequest {
  gcode: string
  lineMeta?: GcodeLineMeta[]
  tools: Tool[]
  toolpaths: Pick<Toolpath, 'stepId' | 'side'>[]
  material: Material
  boardBBox: BBox
  /** Design copper (board coords) per side for the "show intended copper" overlay. */
  designTop?: PolygonSet
  designBottom?: PolygonSet
  resolution?: number
  /** Machine rapid rates and acceleration, so the play-back time matches the file estimate. */
  timing?: Pick<MachineProfile, 'maxFeedXY' | 'maxFeedZ' | 'accel'>
}

export interface SimMarker {
  t: number
  line: number
  stepId: string | null
  toolId: string | null
  side: 'top' | 'bottom'
  kind: 'step' | 'tool'
}

export interface SimSetup {
  runner: SimRunner
  moves: SimMove[]
  totalTime: number
  markers: SimMarker[]
  sides: Record<string, 'top' | 'bottom'>
  warnings: string[]
}

export function setupSimulation(req: SimSetupRequest): SimSetup {
  const { material: m } = req
  const interp = interpretGcode(req.gcode, {
    lineMeta: req.lineMeta,
    ...(req.timing ? machineTiming(req.timing) : {})
  })
  const sides: Record<string, 'top' | 'bottom'> = {}
  for (const tp of req.toolpaths) sides[tp.stepId] = tp.side
  const usesBottom = Object.values(sides).includes('bottom')

  const mkStock = (mask?: Uint8Array): SimStock =>
    createStock({
      width: m.width,
      height: m.height,
      thickness: m.thickness,
      copperThickness: m.copperThickness,
      resolution: req.resolution,
      copperMask: mask
    })
  const stockTop = mkStock()
  const stockBottom = usesBottom || m.doubleSided ? mkStock() : undefined

  const boardToStock = boardToStockTransform(m, req.boardBBox)
  const flip = flipTransform(m)
  if (req.designTop)
    stockTop.copperMask = rasterizeCopperMask(req.designTop, stockTop, geoToSimAffine(boardToStock))
  if (stockBottom && req.designBottom) {
    // bottom face coordinates = top-view stock coords after the flip
    const bm: GeoAffine = composeGeo(flip, boardToStock)
    stockBottom.copperMask = rasterizeCopperMask(req.designBottom, stockBottom, geoToSimAffine(bm))
  }

  // Work → stock is the same for both faces: the bottom face stock frame is the bed frame after flipping.
  const workToStock = invertAffine(geoToSimAffine(stockToWork(m, req.boardBBox)))
  const runner = new SimRunner({
    moves: interp.moves,
    tools: Object.fromEntries(req.tools.map((t) => [t.id, t])),
    sides,
    stockTop,
    stockBottom,
    workToStock: { top: workToStock, bottom: workToStock },
    topToBottom: geoToSimAffine(flip)
  })

  // Timeline markers: where the step or the tool changes.
  const markers: SimMarker[] = []
  let lastStep: string | null | undefined
  let lastTool: string | null | undefined
  let t = 0
  for (const mv of interp.moves) {
    if (mv.stepId !== lastStep && mv.stepId) {
      markers.push({
        t,
        line: mv.line,
        stepId: mv.stepId,
        toolId: mv.toolId,
        side: sides[mv.stepId] ?? 'top',
        kind: 'step'
      })
      lastStep = mv.stepId
      lastTool = mv.toolId
    } else if (mv.toolId !== lastTool && mv.toolId) {
      markers.push({
        t,
        line: mv.line,
        stepId: mv.stepId,
        toolId: mv.toolId,
        side: sides[mv.stepId ?? ''] ?? 'top',
        kind: 'tool'
      })
      lastTool = mv.toolId
    }
    t = mv.tEnd
  }
  return {
    runner,
    moves: interp.moves,
    totalTime: runner.totalTime,
    markers,
    sides,
    warnings: interp.warnings
  }
}
