/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { importFiles, parseOne } from '@core/pipeline/import'
import { runCam, type CamRequest } from '@core/pipeline/cam'
import { interpretGcode } from '@core/gcode'
import {
  addZTouchOff,
  applyHeightMap,
  importProbeLog,
  generateProbeProgram,
  type TouchOffOptions
} from '@core/heightmap'
import { narrowestGap } from '@core/toolpath'
import type { HeightMap, MachineProfile, PolygonSet, ProbeGridConfig } from '@core/model/types'

const api = {
  importFiles,
  parseOne,
  runCam: (req: CamRequest, onStep?: (stepId: string | null) => void) => runCam(req, onStep),
  interpret: (text: string) => interpretGcode(text),
  narrowestGap: (copper: PolygonSet, limit: number, ignoreBelow: number) =>
    narrowestGap(copper, limit, ignoreBelow),
  probeProgram: (cfg: ProbeGridConfig, machine: MachineProfile) => generateProbeProgram(cfg, machine),
  importProbe: (text: string, cfg?: ProbeGridConfig) => importProbeLog(text, cfg),
  level: (gcode: string, map: HeightMap, touchOff?: TouchOffOptions) => {
    const out = applyHeightMap(gcode, map)
    return touchOff ? addZTouchOff(out, touchOff) : out
  }
}

export type CamWorkerApi = typeof api
Comlink.expose(api)
