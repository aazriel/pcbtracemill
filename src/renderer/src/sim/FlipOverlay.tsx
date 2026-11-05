/**
 * Big notice over the simulation when the job turns the board over: the view has switched to the
 * other face, and a short animation shows the flip so nobody misses it.
 */
import { useEffect } from 'react'
import { RefreshCcw } from 'lucide-react'
import { useProject } from '@renderer/store/project'
import { useSim } from './engine'

const SHOW_MS = 3800

export function FlipOverlay(): React.JSX.Element | null {
  const notice = useSim((s) => s.flipNotice)
  const axis = useProject((s) => s.material?.alignment.axis ?? 'x')
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => {
      if (useSim.getState().flipNotice?.key === notice.key) useSim.getState().set({ flipNotice: null })
    }, SHOW_MS)
    return () => clearTimeout(t)
  }, [notice])
  if (!notice) return null
  const bottom = notice.toSide === 'bottom'
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center"
      data-testid="sim-flip-notice"
    >
      <style>{`
        @keyframes tm-flip-card { 0% { opacity: 0; transform: scale(.92) } 8% { opacity: 1; transform: scale(1) } 85% { opacity: 1 } 100% { opacity: 0 } }
        @keyframes tm-flip-board { 0%, 15% { transform: rotate${axis === 'x' ? 'X' : 'Y'}(0deg) } 55%, 100% { transform: rotate${axis === 'x' ? 'X' : 'Y'}(180deg) } }
      `}</style>
      <div
        key={notice.key}
        className="pointer-events-auto flex items-center gap-6 rounded-3xl border border-violet-400/50 bg-slate-950/85 px-9 py-7 shadow-2xl shadow-violet-900/40 backdrop-blur-md"
        style={{ animation: `tm-flip-card ${SHOW_MS}ms ease-out forwards` }}
        onClick={() => useSim.getState().set({ flipNotice: null })}
      >
        <div style={{ perspective: 400 }} className="size-28 shrink-0">
          <div
            className="relative size-full"
            style={{ transformStyle: 'preserve-3d', animation: 'tm-flip-board 1.6s ease-in-out forwards' }}
          >
            {/* front: the side milled so far; back: the other side */}
            <div
              className="absolute inset-3 flex items-center justify-center rounded-lg border-2 border-amber-300/70 text-xs font-bold text-white"
              style={{ backfaceVisibility: 'hidden', background: 'linear-gradient(135deg,#e8915c,#b8582c)' }}
            >
              {bottom ? 'TOP' : 'BOTTOM'}
            </div>
            <div
              className="absolute inset-3 flex items-center justify-center rounded-lg border-2 border-amber-300/70 text-xs font-bold text-white"
              style={{
                backfaceVisibility: 'hidden',
                transform: `rotate${axis === 'x' ? 'X' : 'Y'}(180deg)`,
                background: 'linear-gradient(135deg,#a78bfa,#6d28d9)'
              }}
            >
              {bottom ? 'BOTTOM' : 'TOP'}
            </div>
          </div>
        </div>
        <div className="max-w-[340px]">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-violet-300">
            <RefreshCcw className="size-4" /> Flip the board
          </div>
          <div className="mt-1 text-2xl font-semibold text-white">Now milling the {notice.toSide} side</div>
          <p className="mt-1.5 text-sm text-slate-300">
            On the machine you turn the board over here (
            {axis === 'x' ? 'front edge to the back' : 'left edge to the right'}) and push it back onto the
            alignment pins. The view switched to the {notice.toSide} side.
          </p>
        </div>
      </div>
    </div>
  )
}
