import { useMemo } from 'react'
import type { ProbeGridConfig } from '@core/model/types'
import { probePoints, gridStep } from '@core/heightmap'
import type { WorkScene } from './geometry'

/**
 * To-scale top view (work coordinates) of the stock, the board and the probe grid. The serpentine
 * order the machine follows is drawn as a path with a dot travelling along it.
 */
export function ProbePreview({
  scene,
  cfg,
  className
}: {
  scene: WorkScene
  cfg: ProbeGridConfig
  className?: string
}): React.JSX.Element {
  const pts = useMemo(() => probePoints(cfg), [cfg])
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
  const axisLen = span * 0.09
  const tooMany = pts.length > 600

  return (
    <svg
      viewBox={vb.join(' ')}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Material, board and probe points seen from above"
      data-testid="probe-preview"
    >
      <defs>
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
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={-p.y} r={i === 0 ? r * 1.6 : r} fill={i === 0 ? '#fb7185' : '#e2e8f0'} />
      ))}
      <text
        x={pts[0].x + r * 2.2}
        y={-pts[0].y + fs * 1.1}
        fontSize={fs * 0.85}
        fill="#fda4af"
        fontWeight={600}
      >
        1 · start, zero Z here
      </text>
      {/* travelling dot */}
      <circle r={r * 1.5} fill="#38bdf8" stroke="#0c4a6e" strokeWidth={r * 0.3}>
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={path} />
      </circle>
      {/* work origin */}
      <g stroke="none">
        <line
          x1={0}
          y1={0}
          x2={axisLen}
          y2={0}
          stroke="#f87171"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={-axisLen}
          stroke="#4ade80"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <circle r={r * 1.2} fill="#f8fafc" />
        <text x={axisLen + fs * 0.2} y={-fs * 0.2} fontSize={fs * 0.8} fill="#fca5a5">
          X
        </text>
        <text x={-fs * 0.3} y={-axisLen - fs * 0.3} fontSize={fs * 0.8} fill="#86efac">
          Y
        </text>
        <text x={-fs * 0.3} y={fs * 1.1} fontSize={fs * 0.75} fill="#cbd5e1" textAnchor="end">
          X0 Y0
        </text>
      </g>
    </svg>
  )
}
