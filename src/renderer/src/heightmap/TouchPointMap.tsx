/**
 * To-scale top view of the board (work coordinates) with the point where every probed bit finds Z0.
 * Hovering a file (Auto-level step 3 or the files table) lights up its points; while a bit's point is
 * being moved, a click on the map places it (D-037).
 */
import { useMemo, useRef } from 'react'
import { Crosshair, MousePointerClick } from 'lucide-react'
import type { Vec2 } from '@core/model/types'
import { cn } from '@renderer/lib/utils'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { setStepTouchPoint, type ExportFile } from '@renderer/export/exportFiles'
import { useWorkScene } from './geometry'
import { useAutoLevel } from './state'
import { FILE_COLOURS, useTouchUi } from './touchState'

const fmt = (v: number): string => String(Math.round(v * 10) / 10)
/** Most points drawn for the faint toolpaths (keeps the SVG light). */
const MAX_PATH_POINTS = 12000

export function TouchPointMap({ files }: { files: ExportFile[] }): React.JSX.Element | null {
  const cam = useUi((s) => s.cam)
  const map = useProject((s) => s.heightMap)
  const measured = useAutoLevel((s) => s.measuredSide)
  const hoverFile = useTouchUi((s) => s.hoverFile)
  const editStep = useTouchUi((s) => s.editStep)
  const setTouch = useTouchUi((s) => s.set)
  const svgRef = useRef<SVGSVGElement>(null)

  const points = useMemo(
    () =>
      files.flatMap((f, i) =>
        f.probeOn
          ? f.touchPoints.map((p, k) => ({
              ...p,
              file: f.file.name,
              colour: FILE_COLOURS[i % FILE_COLOURS.length],
              n: k + 1
            }))
          : []
      ),
    [files]
  )
  const sideOfStep = useMemo(() => new Map((cam?.toolpaths ?? []).map((t) => [t.stepId, t.side])), [cam])
  const hovered = files.find((f) => f.file.name === hoverFile)
  const side =
    (editStep && sideOfStep.get(editStep)) || hovered?.sides[0] || points[0]?.side || measured || 'top'
  const scene = useWorkScene(side)

  // the cuts of this side, faint, so the board is recognisable
  const cuts = useMemo(() => {
    const tps = (cam?.toolpaths ?? []).filter((t) => t.side === side)
    const total = tps.reduce((a, t) => a + t.segments.reduce((b, s) => b + s.moves.length, 0), 0)
    const stride = Math.max(1, Math.ceil(total / MAX_PATH_POINTS))
    const parts: string[] = []
    for (const t of tps)
      for (const seg of t.segments) {
        if (seg.drill) {
          parts.push(`M${seg.drill.x.toFixed(2)} ${(-seg.drill.y).toFixed(2)}h0.01`)
          continue
        }
        let open = false
        seg.moves.forEach((m, i) => {
          const cut = m.z < 0 && m.kind !== 'rapid'
          if (!cut) {
            open = false
            return
          }
          if (i % stride && open && i < seg.moves.length - 1) return
          parts.push(`${open ? 'L' : 'M'}${m.x.toFixed(2)} ${(-m.y).toFixed(2)}`)
          open = true
        })
      }
    return parts.join('')
  }, [cam, side])

  if (!scene) return null
  const shown = points.filter((p) => (p.side ?? 'top') === side)
  const { stock } = scene
  const span = Math.max(stock.maxX - stock.minX, stock.maxY - stock.minY, 1)
  const pad = span * 0.05
  const vb = [
    stock.minX - pad,
    -(stock.maxY + pad),
    stock.maxX - stock.minX + 2 * pad,
    stock.maxY - stock.minY + 2 * pad
  ]
  const r = span / 55
  const d = (ring: Vec2[]): string =>
    ring.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(3)} ${(-q.y).toFixed(3)}`).join(' ') + ' Z'
  const shapeD = scene.shape.map((p) => [p.outer, ...p.holes].map(d).join(' ')).join(' ')
  const editing = editStep ? shown.find((p) => p.stepId === editStep) : null
  const editName = editStep ? cam?.toolpaths.find((t) => t.stepId === editStep)?.stepName : null

  const toWork = (e: React.MouseEvent): Vec2 | null => {
    const m = svgRef.current?.getScreenCTM()
    if (!m) return null
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: q.x, y: -q.y }
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="touch-map">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
        <Crosshair className="size-3.5" /> Where each bit finds Z0 ({side} side)
      </div>
      <svg
        ref={svgRef}
        viewBox={vb.join(' ')}
        className={cn(
          'w-full select-none rounded-lg border bg-slate-950/70',
          editStep ? 'cursor-crosshair border-sky-500' : 'border-slate-800'
        )}
        onClick={(e) => {
          if (!editStep) return
          const q = toWork(e)
          if (q) setStepTouchPoint(editStep, q)
        }}
        data-testid="touch-map-svg"
      >
        <rect
          x={stock.minX}
          y={-stock.maxY}
          width={stock.maxX - stock.minX}
          height={stock.maxY - stock.minY}
          fill="#b4530926"
          stroke="#b45309"
          strokeWidth={span / 400}
        />
        {shapeD && (
          <path d={shapeD} fill="#f59e0b1f" fillRule="evenodd" stroke="#fbbf24" strokeWidth={span / 300} />
        )}
        {cuts && (
          <path
            d={cuts}
            fill="none"
            stroke="#94a3b8"
            strokeOpacity={0.35}
            strokeWidth={span / 500}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {map && (
          <rect
            x={map.config.minX}
            y={-map.config.maxY}
            width={map.config.maxX - map.config.minX}
            height={map.config.maxY - map.config.minY}
            fill="none"
            stroke="#38bdf8"
            strokeOpacity={0.5}
            strokeDasharray={`${span / 80} ${span / 120}`}
            strokeWidth={span / 400}
          />
        )}
        {/* X0 Y0 */}
        <g stroke="#e2e8f0" strokeOpacity={0.6} strokeWidth={span / 350}>
          <line x1={0} y1={0} x2={span * 0.08} y2={0} />
          <line x1={0} y1={0} x2={0} y2={-span * 0.08} />
        </g>
        {shown.map((p, i) => {
          const lit = !hoverFile || hoverFile === p.file || p.stepId === editStep
          const big = hoverFile === p.file || p.stepId === editStep
          return (
            <g key={i} opacity={lit ? 1 : 0.18} data-testid="touch-map-point">
              {p.rejected && (
                <g stroke="#f87171" strokeWidth={span / 250}>
                  <line
                    x1={p.rejected.x - r / 2}
                    y1={-p.rejected.y - r / 2}
                    x2={p.rejected.x + r / 2}
                    y2={-p.rejected.y + r / 2}
                  />
                  <line
                    x1={p.rejected.x - r / 2}
                    y1={-p.rejected.y + r / 2}
                    x2={p.rejected.x + r / 2}
                    y2={-p.rejected.y - r / 2}
                  />
                </g>
              )}
              {big && <circle cx={p.x} cy={-p.y} r={r * 1.9} fill={p.colour} fillOpacity={0.22} />}
              <circle
                cx={p.x}
                cy={-p.y}
                r={big ? r * 1.15 : r * 0.8}
                fill={p.colour}
                stroke="#020617"
                strokeWidth={span / 400}
              />
              <text
                x={p.x}
                y={-p.y}
                fontSize={big ? r * 1.4 : r}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#020617"
                fontWeight={700}
              >
                {p.n}
              </text>
              <title>{`${p.file} – bit ${p.n}: X${fmt(p.x)} Y${fmt(p.y)} (${p.where})`}</title>
            </g>
          )
        })}
      </svg>
      {editStep ? (
        <div className="flex items-start gap-1.5 rounded-md border border-sky-500/50 bg-sky-500/10 p-1.5 text-[11px] leading-snug text-sky-100">
          <MousePointerClick className="mt-px size-3.5 shrink-0" />
          <span className="flex-1">
            Click on the board where “{editName ?? 'this bit'}” should find Z0
            {editing ? ` (now X${fmt(editing.x)} Y${fmt(editing.y)})` : ''}.
          </span>
          <button
            type="button"
            className="font-semibold text-sky-300 hover:underline"
            onClick={() => setTouch({ editStep: null })}
          >
            Done
          </button>
        </div>
      ) : shown.length ? (
        <p className="text-[10.5px] leading-snug text-slate-500">
          Numbered dots: where each bit touches the copper, in the colour of its file. Point at a file to
          light up its points. Dashed: the probed area.
        </p>
      ) : (
        <p className="text-[10.5px] leading-snug text-slate-500">
          Switch on “Find Z zero with the probe” to see where each bit touches the copper.
        </p>
      )}
    </div>
  )
}
