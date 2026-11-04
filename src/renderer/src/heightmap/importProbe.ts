/** Step 2 of auto-leveling: pick a probe log, parse it in the CAM worker and store the height map. */
import { camWorker } from '@workers/index'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { useAutoLevel } from './state'

const ACCEPT = '.txt,.csv,.log,.nc,.tap,.ngc,.gcode,.xyz,.dig,.dat,.tsv'

export const FORMAT_LABELS: Record<string, string> = {
  grbl: 'GRBL console log ([PRB:…] lines)',
  linuxcnc: 'LinuxCNC probe file (x y z)',
  mach3: 'Mach3 digitize file (x,y,z)',
  csv: 'Table with x / y / z columns',
  unknown: 'Unknown format'
}

async function pickFile(): Promise<{ name: string; text: string } | null> {
  if (window.tracemill) {
    const files = await window.tracemill.openFiles({
      filters: [
        { name: 'Probe results', extensions: ['txt', 'csv', 'log', 'nc', 'ngc', 'tap', 'gcode'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    const f = files[0]
    if (!f) return null
    return { name: f.name, text: f.encoding === 'base64' ? atob(f.data) : f.data }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = ACCEPT
    input.onchange = async () => {
      const f = input.files?.[0]
      resolve(f ? { name: f.name, text: await f.text() } : null)
    }
    input.click()
  })
}

/** Parse probe results text and store the map. Exposed separately so tests can feed text directly. */
export async function importProbeText(name: string, text: string): Promise<boolean> {
  const al = useAutoLevel.getState()
  const ui = useUi.getState()
  let res = await camWorker().importProbe(text, al.probeCfg ?? undefined)
  // The saved grid may belong to another run; fall back to inferring the grid from the points.
  if (!res.map && al.probeCfg) {
    const inferred = await camWorker().importProbe(text)
    if (inferred.map)
      res = {
        ...inferred,
        warnings: [
          'Points did not match the saved probe grid; grid was inferred from the file.',
          ...inferred.warnings
        ]
      }
  }
  al.set({ importInfo: { fileName: name, format: res.format, warnings: res.warnings, ok: !!res.map } })
  if (!res.map) {
    ui.toast(
      'error',
      `Could not build a height map from ${name}: ${res.warnings.slice(-1)[0] ?? 'no points'}`
    )
    return false
  }
  useProject.getState().setHeightMap({ ...res.map, source: name })
  al.set({ apply: true })
  ui.toast(
    'success',
    `Height map imported: ${res.map.config.countX} × ${res.map.config.countY} points. Exported files are now height-corrected.`
  )
  return true
}

export async function importProbeResults(): Promise<void> {
  const f = await pickFile()
  if (!f) return
  try {
    await importProbeText(f.name, f.text)
  } catch (e) {
    useUi.getState().toast('error', `Import failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
