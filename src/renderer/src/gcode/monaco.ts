/**
 * Offline Monaco setup for Electron / Vite: the editor core (no bundled languages) is loaded from
 * the local `monaco-editor` package instead of a CDN, and its background worker is bundled by Vite.
 */
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
// Editor contributions (hover, find, folding, …) without the heavy language packs.
import 'monaco-editor/esm/vs/editor/editor.all.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { registerGcodeLanguage } from './language'

let done = false

/** Idempotent. Call before rendering any `@monaco-editor/react` editor. */
export function setupMonaco(): typeof monaco {
  if (done) return monaco
  done = true
  self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
  loader.config({ monaco })
  registerGcodeLanguage(monaco)
  return monaco
}

export type MonacoApi = typeof monaco
