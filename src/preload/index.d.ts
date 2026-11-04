import type { TraceMillApi } from '../shared/ipc-types'

declare global {
  interface Window {
    /** Undefined when running in a plain browser (e.g. vite preview / tests). */
    tracemill?: TraceMillApi & { pathForFile(f: File): string }
  }
}
export {}
