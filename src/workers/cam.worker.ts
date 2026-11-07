/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { importFiles, parseOne } from '@core/pipeline/import'
import { previewStep, runCam, type CamRequest } from '@core/pipeline/cam'
import { interpretGcode } from '@core/gcode'
import {
  addZTouchOff,
  applyHeightMap,
  importProbeLog,
  generateProbeProgram,
  type ProbeProgramOptions,
  type TouchOffOptions
} from '@core/heightmap'
import { analyzeClearance, narrowestGap } from '@core/toolpath'
import type { CamStep, HeightMap, MachineProfile, PolygonSet, ProbeGridConfig } from '@core/model/types'

const api = {
  importFiles,
  parseOne,
  runCam: (req: CamRequest, onStep?: (stepId: string | null) => void) => runCam(req, onStep),
  previewStep: (req: Omit<CamRequest, 'grouping' | 'projectName'>, step: CamStep) => previewStep(req, step),
  interpret: (text: string) => interpretGcode(text),
  narrowestGap: (copper: PolygonSet, limit: number, ignoreBelow: number) =>
    narrowestGap(copper, limit, ignoreBelow),
  analyzeClearance: (copper: PolygonSet) => analyzeClearance(copper),
  probeProgram: (cfg: ProbeGridConfig, machine: MachineProfile, opts?: ProbeProgramOptions) =>
    generateProbeProgram(cfg, machine, opts),
  importProbe: (text: string, cfg?: ProbeGridConfig) => importProbeLog(text, cfg),
  level: (gcode: string, map: HeightMap, touchOff?: TouchOffOptions) => {
    const out = applyHeightMap(gcode, map)
    return touchOff ? addZTouchOff(out, touchOff) : out
  }
}

export type CamWorkerApi = typeof api
Comlink.expose(api)
