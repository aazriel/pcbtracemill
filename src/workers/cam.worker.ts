/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { importFiles, parseOne } from '@core/pipeline/import'
import { runCam, type CamRequest } from '@core/pipeline/cam'
import { interpretGcode } from '@core/gcode'
import { applyHeightMap, buildHeightMap, parseProbeResults, generateProbeProgram } from '@core/heightmap'
import type { HeightMap, MachineProfile, ProbeGridConfig } from '@core/model/types'

const api = {
  importFiles,
  parseOne,
  runCam: (req: CamRequest) => runCam(req),
  interpret: (text: string) => interpretGcode(text),
  probeProgram: (cfg: ProbeGridConfig, machine: MachineProfile) => generateProbeProgram(cfg, machine),
  importProbe(
    text: string,
    cfg?: ProbeGridConfig
  ): { map: HeightMap | null; warnings: string[]; format: string } {
    const r = parseProbeResults(text)
    if (r.points.length < 4)
      return {
        map: null,
        warnings: [...r.warnings, 'Not enough probe points found (need at least 4).'],
        format: r.format
      }
    try {
      return { map: buildHeightMap(r.points, cfg, r.format), warnings: r.warnings, format: r.format }
    } catch (e) {
      return {
        map: null,
        warnings: [...r.warnings, e instanceof Error ? e.message : String(e)],
        format: r.format
      }
    }
  },
  level: (gcode: string, map: HeightMap) => applyHeightMap(gcode, map)
}

export type CamWorkerApi = typeof api
Comlink.expose(api)
