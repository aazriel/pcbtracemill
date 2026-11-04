/**
 * Import pipeline: raw files (text or zip bytes) → ImportedLayer[] with parsed geometry.
 * Pure; runs inside the CAM worker.
 */
import type { EdaTool, ImportedLayer } from '../model/types'
import { buildImportedLayer, expandInputs, isRelevantFile, type InputFile } from '../import'
import { defaultParse } from '../import/parse'

export interface ImportResult {
  layers: ImportedLayer[]
  skipped: { name: string; reason: string }[]
}

export async function importFiles(
  files: InputFile[],
  eda: EdaTool | null,
  startOrder: number,
  idPrefix: string
): Promise<ImportResult> {
  const expanded = await expandInputs(files)
  const layers: ImportedLayer[] = []
  const skipped: { name: string; reason: string }[] = []
  let n = 0
  for (const f of expanded) {
    const rel = isRelevantFile(f.name, f.text, eda)
    if (!rel.relevant) {
      skipped.push({ name: f.path || f.name, reason: rel.reason })
      continue
    }
    const layer = buildImportedLayer(f, eda, defaultParse, startOrder + n, `${idPrefix}-${n}`)
    layers.push(layer)
    n++
  }
  return { layers, skipped }
}

/** Re-parse one file (used by "re-import" and when loading a project). */
export function parseOne(
  name: string,
  text: string,
  eda: EdaTool | null,
  id: string,
  order: number
): ImportedLayer {
  return buildImportedLayer({ name, text }, eda, defaultParse, order, id)
}
