import { useMemo, useRef, useState } from 'react'
import type { Path, ProbeGridConfig, Vec2 } from '@core/model/types'
import { probePoints, gridStep } from '@core/heightmap'
import { circlePath } from '@core/geometry'
import type { WorkScene } from './geometry'
import { cn } from '@renderer/lib/utils'

export type DrawTool = 'rect' | 'circle' | 'polygon'

const fmtMm = (v: number): string => String(Math.round(v * 10) / 10)

/**
 * To-scale top view (work coordinates) of the stock, the board and the probe grid. The serpentine
 * order the machine follows is drawn as a path with a dot travelling along it; grid points that are
 * skipped are drawn faint. With `onDraw` the user draws the probe area: drag a rectangle, drag a
 * circle from its centre, or click the corners of a polygon (click the first point or double-click
 * to close it, Esc to start over).
 */
export function ProbePreview({
  scene,
  cfg,
  className,
  tool = 'rect',
  areaShape,
  onDraw,
  onDrawStart
}: {
  scene: WorkScene
  cfg: ProbeGridConfig
  className?: string
  tool?: DrawTool
  /** A drawn area (work coordinates) to outline instead of the plain rectangle. */
  areaShape?: Path | null
  onDraw?: (shape: Path) => void
  /** The user started drawing (first press on the picture). */
  onDrawStart?: () => void
}): React.JSX.Element {
  const pts = useMemo(() => probePoints(cfg), [cfg])
  const skipped = useMemo(() => {
    if (!cfg.cells?.length) return []
    const keep = new Set(cfg.cells)
    return probePoints({ ...cfg, cells: undefined }).filter((p) => !keep.has(p.iy * cfg.countX + p.ix))
  }, [cfg])
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [poly, setPoly] = useState<Vec2[]>([])
  const [hover, setHover] = useState<Vec2 | null>(null)
  const toWork = (e: React.PointerEvent | React.MouseEvent): Vec2 | null => {
    const svg = svgRef.current
    const m = svg?.getScreenCTM()
    if (!svg || !m) return null
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: q.x, y: -q.y }
  }
  const r1 = (v: number): number => Math.round(v * 10) / 10
  const rounded = (p: Path): Path => p.map((q) => ({ x: r1(q.x), y: r1(q.y) }))
  /** The shape being dragged (rectangle or circle). */
  const dragShape: Path | null = drag
    ? tool === 'circle'
      ? circlePath(drag.x0, drag.y0, Math.max(0.01, Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0)), 64)
      : [
          { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1) },
          { x: Math.max(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1) },
          { x: Math.max(drag.x0, drag.x1), y: Math.max(drag.y0, drag.y1) },
          { x: Math.min(drag.x0, drag.x1), y: Math.max(drag.y0, drag.y1) }
        ]
    : null
  const finishPoly = (list: Vec2[]): void => {
    if (list.length >= 3 && onDraw) onDraw(rounded(list))
    setPoly([])
  }
  const { stock } = scene
  const minX = Math.min(stock.minX, cfg.minX, 0)
  const minY = Math.min(stock.minY, cfg.minY, 0)
  const maxX = Math.max(stock.maxX, cfg.maxX, 0)
  const maxY = Math.max(stock.maxY, cfg.maxY, 0)
  const span = Math.max(maxX - minX, maxY - minY, 1)
  const pad = span * 0.08
  const vb = [minX - pad, -(maxY + pad), maxX - minX + 2 * pad, maxY - minY + 2 * pad]
  const fs = span / 32
  const { dx, dy } = gridStep(cfg)
  const r = Math.max(span / 260, Math.min(Math.min(dx || span, dy || span) * 0.14, span / 90))
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)} ${(-p.y).toFixed(3)}`).join(' ')
  const dur = Math.min(24, Math.max(4, pts.length * 0.35))
  const outlineD = scene.outline
    .map((ring) => ring.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(3)} ${(-q.y).toFixed(3)}`).join(' '))
    .join(' ')
  const axisLen = span * 0.13
  const tooMany = pts.length > 600
  const closeDist = span * 0.025
  const d = (p: Path, close = true): string =>
    p.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(3)} ${(-q.y).toFixed(3)}`).join(' ') + (close ? ' Z' : '')

  return (
    <svg
      ref={svgRef}
      viewBox={vb.join(' ')}
      className={cn('select-none outline-none', className)}
      style={onDraw ? { cursor: 'crosshair', touchAction: 'none' } : undefined}
      tabIndex={onDraw ? 0 : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && (poly.length || drag)) {
          e.stopPropagation()
          setPoly([])
          setDrag(null)
        }
      }}
      onPointerDown={
        onDraw
          ? (e) => {
              const q = toWork(e)
              if (!q) return
              onDrawStart?.()
              if (tool === 'polygon') {
                if (poly.length >= 3 && Math.hypot(q.x - poly[0].x, q.y - poly[0].y) < closeDist)
                  finishPoly(poly)
                else setPoly([...poly, q])
                return
              }
              e.currentTarget.setPointerCapture(e.pointerId)
              setDrag({ x0: q.x, y0: q.y, x1: q.x, y1: q.y })
            }
          : undefined
      }
      onDoubleClick={onDraw && tool === 'polygon' ? () => finishPoly(poly) : undefined}
      onPointerMove={
        onDraw
          ? (e) => {
              const q = toWork(e)
              if (!q) return
              if (tool === 'polygon') setHover(q)
              else if (drag) setDrag({ ...drag, x1: q.x, y1: q.y })
            }
          : undefined
      }
      onPointerUp={
        onDraw && drag
          ? () => {
              const w = Math.abs(drag.x1 - drag.x0)
              const h = Math.abs(drag.y1 - drag.y0)
              const ok = tool === 'circle' ? Math.hypot(w, h) > 2 : w > 2 && h > 2
              if (ok && dragShape) onDraw(rounded(dragShape))
              setDrag(null)
            }
          : undefined
      }
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Material, board and probe points seen from above"
      data-testid="probe-preview"
    >
      <defs>
        <marker
          id="pp-ax"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 Z" fill="context-stroke" />
        </marker>
        <pattern id="pp-grid" width={10} height={10} patternUnits="userSpaceOnUse">
          <path d="M10 0 H0 V10" fill="none" stroke="#1e293b" strokeWidth={0.15} />
        </pattern>
      </defs>
      <rect x={vb[0]} y={vb[1]} width={vb[2]} height={vb[3]} fill="url(#pp-grid)" />
      {/* stock */}
      <rect
        x={stock.minX}
        y={-stock.maxY}
        width={stock.maxX - stock.minX}
        height={stock.maxY - stock.minY}
        fill="rgba(184,115,51,0.22)"
        stroke="rgba(217,149,84,0.9)"
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
      />
      <text x={stock.minX} y={-stock.maxY - fs * 0.5} fontSize={fs} fill="#d9a066">
        Material {(stock.maxX - stock.minX).toFixed(1)} × {(stock.maxY - stock.minY).toFixed(1)} mm
      </text>
      {/* board */}
      <rect
        x={scene.board.minX}
        y={-scene.board.maxY}
        width={scene.board.maxX - scene.board.minX}
        height={scene.board.maxY - scene.board.minY}
        fill="rgba(16,185,129,0.12)"
      />
      <path d={outlineD} fill="none" stroke="#34d399" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      <text
        x={scene.board.minX + fs * 0.3}
        y={-scene.board.minY - fs * 0.4}
        fontSize={fs * 0.8}
        fill="#6ee7b7"
      >
        board
      </text>
      {/* probe area */}
      {areaShape && areaShape.length >= 3 ? (
        <path
          d={d(areaShape)}
          fill="rgba(56,189,248,0.08)"
          stroke="#38bdf8"
          strokeWidth={1.5}
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <rect
          x={cfg.minX}
          y={-cfg.maxY}
          width={Math.max(0, cfg.maxX - cfg.minX)}
          height={Math.max(0, cfg.maxY - cfg.minY)}
          fill="rgba(56,189,248,0.06)"
          stroke="#38bdf8"
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {/* serpentine path */}
      {!tooMany && (
        <path
          d={path}
          fill="none"
          stroke="rgba(56,189,248,0.45)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {skipped.map((p, i) => (
        <circle key={`s${i}`} cx={p.x} cy={-p.y} r={r * 0.6} fill="#475569" opacity={0.6} />
      ))}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={-p.y} r={i === 0 ? r * 1.6 : r} fill={i === 0 ? '#fb7185' : '#e2e8f0'} />
      ))}
      {/* where point 1 is, measured from X0 Y0 */}
      <g data-testid="probe-point1-dims">
        <line
          x1={0}
          y1={0}
          x2={pts[0].x}
          y2={0}
          stroke="#fda4af"
          strokeDasharray="3 3"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={pts[0].x}
          y1={0}
          x2={pts[0].x}
          y2={-pts[0].y}
          stroke="#fda4af"
          strokeDasharray="3 3"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {Math.abs(pts[0].x) > fs && (
          <text
            x={pts[0].x / 2}
            y={pts[0].y >= 0 ? fs * 2.2 : -fs * 0.4}
            fontSize={fs * 0.75}
            fill="#fda4af"
            textAnchor="middle"
          >
            X {fmtMm(pts[0].x)}
          </text>
        )}
        {Math.abs(pts[0].y) > fs && (
          <text
            x={pts[0].x + fs * 0.35}
            y={-pts[0].y / 2}
            fontSize={fs * 0.75}
            fill="#fda4af"
            dominantBaseline="middle"
          >
            Y {fmtMm(pts[0].y)}
          </text>
        )}
      </g>
      <text
        x={pts[0].x + r * 2.2}
        y={-pts[0].y - fs * 0.5}
        fontSize={fs * 0.85}
        fill="#fda4af"
        fontWeight={600}
      >
        1 · start here, zero Z (X{fmtMm(pts[0].x)} Y{fmtMm(pts[0].y)})
      </text>
      {/* travelling dot */}
      <circle r={r * 1.5} fill="#38bdf8" stroke="#0c4a6e" strokeWidth={r * 0.3}>
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={path} />
      </circle>
      {dragShape && (
        <path
          d={d(dragShape)}
          fill="rgba(56,189,248,0.15)"
          stroke="#7dd3fc"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {poly.length > 0 && (
        <g>
          <path
            d={d(hover ? [...poly, hover] : poly, false)}
            fill="rgba(56,189,248,0.12)"
            stroke="#7dd3fc"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          {poly.map((q, i) => (
            <circle
              key={i}
              cx={q.x}
              cy={-q.y}
              r={i === 0 && poly.length >= 3 ? closeDist * 0.6 : r * 1.2}
              fill={i === 0 ? '#facc15' : '#7dd3fc'}
              opacity={i === 0 && poly.length >= 3 ? 0.8 : 1}
            />
          ))}
        </g>
      )}
      {/* work origin with the + directions */}
      <g data-testid="probe-origin">
        <line
          x1={0}
          y1={0}
          x2={axisLen}
          y2={0}
          stroke="#f87171"
          strokeWidth={2.5}
          markerEnd="url(#pp-ax)"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={-axisLen}
          stroke="#4ade80"
          strokeWidth={2.5}
          markerEnd="url(#pp-ax)"
          vectorEffect="non-scaling-stroke"
        />
        <circle r={r * 1.6} fill="#f8fafc" stroke="#0f172a" strokeWidth={r * 0.4} />
        <text x={axisLen + fs * 0.25} y={fs * 0.3} fontSize={fs * 0.85} fill="#fca5a5" fontWeight={700}>
          X+
        </text>
        <text
          x={0}
          y={-axisLen - fs * 0.35}
          fontSize={fs * 0.85}
          fill="#86efac"
          fontWeight={700}
          textAnchor="middle"
        >
          Y+
        </text>
        <text x={-fs * 0.3} y={fs * 1.1} fontSize={fs * 0.8} fill="#f8fafc" fontWeight={700} textAnchor="end">
          X0 Y0
        </text>
      </g>
    </svg>
  )
}
