/**
 * Code-split wrapper around `GcodeViewer`: Monaco (several MB) is only downloaded and parsed the
 * first time a G-code view is shown, keeping app start-up fast. Same props as `GcodeViewer`.
 */
import { lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import type { GcodeViewerProps } from './GcodeViewer'

const Viewer = lazy(() => import('./GcodeViewer').then((m) => ({ default: m.GcodeViewer })))

export function LazyGcodeViewer(props: GcodeViewerProps): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Loading G-code viewer…
        </div>
      }
    >
      <Viewer {...props} />
    </Suspense>
  )
}

export type { GcodeViewerProps }
