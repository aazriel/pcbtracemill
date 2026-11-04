import * as Comlink from 'comlink'
import type { CamWorkerApi } from './cam.worker'
import type { SimWorkerApi } from './sim.worker'

let cam: Comlink.Remote<CamWorkerApi> | null = null
let sim: Comlink.Remote<SimWorkerApi> | null = null
let simWorker: Worker | null = null

/** The CAM worker: parsing, toolpath generation, post-processing, height maps. */
export function camWorker(): Comlink.Remote<CamWorkerApi> {
  if (!cam)
    cam = Comlink.wrap<CamWorkerApi>(
      new Worker(new URL('./cam.worker.ts', import.meta.url), { type: 'module' })
    )
  return cam
}

/** The simulation worker (material removal). */
export function simWorkerApi(): Comlink.Remote<SimWorkerApi> {
  if (!sim) {
    simWorker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
    sim = Comlink.wrap<SimWorkerApi>(simWorker)
  }
  return sim
}

export type {
  SimInitResult,
  SimInitRequest,
  SimFrame,
  SimRegion,
  SimFieldInit,
  SimMoveData
} from './sim.worker'
