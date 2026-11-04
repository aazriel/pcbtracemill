import { useId } from 'react'
import type { Tool } from '@core/model/types'
import { cutWidthAt, fmtMm } from './toolMeta'

const COPPER_MM = 0.035

/**
 * Zoomed-in cross-section of the tool tip pushed `depth` mm into a copper-clad board, showing how wide the
 * groove is at the surface. Used for V-bits and ball end mills, whose cut width depends on depth.
 */
export function CutDepthDiagram({
  tool,
  depth,
  width = 300,
  height = 150
}: {
  tool: Tool
  depth: number
  width?: number
  height?: number
}): React.JSX.Element {
  const rid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const g = tool.geometry
  const d = Math.max(0.005, depth)
  const surfaceY = 38
  const viewDepth = Math.max(0.25, d * 2.2)
  const cutW = cutWidthAt(tool, d)
  const s = Math.min((height - surfaceY - 8) / viewDepth, (width * 0.55) / Math.max(cutW, 0.05))
  const cx = width / 2
  const R = g.diameter / 2
  const topH = d + surfaceY / s // tool height (mm above the tip) visible up to the top edge

  // Tool profile relative to its tip at (0,0), y grows downwards in px.
  const pts: [number, number][] = []
  if (tool.type === 'vbit') {
    const half = ((g.tipAngle ?? 60) * Math.PI) / 360
    const tipR = (g.tipDiameter ?? 0) / 2
    const coneH = (R - tipR) / Math.tan(half)
    pts.push([-tipR, 0], [tipR, 0])
    if (coneH < topH) pts.push([R, -coneH], [R, -topH], [-R, -topH], [-R, -coneH])
    else {
      const rr = tipR + topH * Math.tan(half)
      pts.push([rr, -topH], [-rr, -topH])
    }
  } else {
    // ball: half circle then straight sides
    const N = 24
    for (let i = 0; i <= N; i++) {
      const a = Math.PI - (i / N) * Math.PI // from left (π) to right (0) along the bottom
      pts.push([R * Math.cos(a), -(R - R * Math.sin(a))])
    }
    pts.push([R, -Math.max(topH, R)], [-R, -Math.max(topH, R)])
  }
  const poly = pts.map(([x, y]) => `${cx + x * s},${y * s}`).join(' ')
  const tipY = surfaceY + d * s
  const copperH = Math.max(3, COPPER_MM * s)
  const wPx = cutW * s

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto max-w-full select-none"
    >
      <defs>
        <linearGradient id={`${rid}-c`} x1="0" x2="1">
          <stop offset="0" stopColor="#52525b" />
          <stop offset="0.45" stopColor="#d4d4d8" />
          <stop offset="1" stopColor="#3f3f46" />
        </linearGradient>
      </defs>
      {/* board */}
      <rect x={0} y={surfaceY} width={width} height={height - surfaceY} fill="#3f5a3a" />
      <rect x={0} y={surfaceY} width={width} height={copperH} fill="#c47a3a" />
      <text x={6} y={surfaceY + copperH + 12} fill="#d6a46e" fontSize="10">
        copper
      </text>
      <text x={6} y={height - 6} fill="#9fbf98" fontSize="10">
        fibreglass board
      </text>
      {/* tool, sliding to the depth */}
      <g style={{ transform: `translateY(${tipY}px)`, transition: 'transform 250ms ease-out' }}>
        <polygon points={poly} fill={`url(#${rid}-c)`} stroke="#18181b" strokeWidth={0.8} opacity={0.95} />
      </g>
      {/* surface + depth markers */}
      <line x1={0} x2={width} y1={surfaceY} y2={surfaceY} stroke="#f59e0b" strokeDasharray="4 3" />
      <text x={6} y={surfaceY - 6} fill="#f59e0b" fontSize="10">
        surface (Z0)
      </text>
      <g stroke="#a78bfa" fill="#a78bfa" fontSize="10">
        <line x1={cx + wPx / 2 + 26} x2={cx + wPx / 2 + 26} y1={surfaceY} y2={tipY} />
        <line x1={cx + wPx / 2 + 22} x2={cx + wPx / 2 + 30} y1={tipY} y2={tipY} />
        <text x={cx + wPx / 2 + 34} y={(surfaceY + tipY) / 2 + 4} stroke="none">
          {fmtMm(Number(d.toFixed(3)))} mm deep
        </text>
      </g>
      <g stroke="#f43f5e" fill="#f43f5e">
        <line x1={cx - wPx / 2} x2={cx + wPx / 2} y1={surfaceY - 10} y2={surfaceY - 10} strokeWidth={2} />
        <line x1={cx - wPx / 2} x2={cx - wPx / 2} y1={surfaceY - 15} y2={surfaceY} />
        <line x1={cx + wPx / 2} x2={cx + wPx / 2} y1={surfaceY - 15} y2={surfaceY} />
        <text
          x={cx}
          y={13}
          textAnchor="middle"
          stroke="#0b1220"
          strokeWidth={3}
          paintOrder="stroke"
          fontSize="11"
          fontWeight={600}
        >
          cuts {cutW.toFixed(3)} mm wide
        </text>
      </g>
    </svg>
  )
}

/**
 * Top view: the tool makes three side-by-side passes. Shows how far it moves over (stepover) and how much
 * the passes overlap.
 */
export function StepoverDiagram({
  stepOver,
  width = 300,
  height = 130
}: {
  stepOver: number
  width?: number
  height?: number
}): React.JSX.Element {
  const so = Math.min(1, Math.max(0.05, Number.isFinite(stepOver) ? stepOver : 0.4))
  const W = 30
  const passes = 3
  const top = 18
  const x0 = 30
  const x1 = width - 70
  const dur = 4.5
  const lanes = Array.from({ length: passes }, (_, i) => top + W / 2 + i * so * W)
  const pct = Math.round(so * 100)
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto max-w-full select-none"
    >
      <rect x={0} y={0} width={width} height={height} fill="#0b1220" rx={6} />
      {lanes.map((y, i) => {
        const kt = `0;${(i / passes).toFixed(3)};${((i + 1) / passes).toFixed(3)};1`
        return (
          <g key={i}>
            <rect x={x0 - W / 2} y={y - W / 2} height={W} width={0} rx={W / 2} fill="rgba(56,189,248,0.32)">
              <animate
                attributeName="width"
                values={`0;0;${x1 - x0 + W};${x1 - x0 + W}`}
                keyTimes={kt}
                dur={`${dur}s`}
                repeatCount="indefinite"
              />
            </rect>
            <circle cx={x0} cy={y} r={W / 2} fill="none" stroke="#e2e8f0" strokeWidth={1.5} opacity={0}>
              <animate
                attributeName="cx"
                values={`${x0};${x0};${x1};${x1}`}
                keyTimes={kt}
                dur={`${dur}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0;1;1;0;0"
                keyTimes={`0;${(i / passes).toFixed(3)};${((i + 1) / passes - 0.01).toFixed(3)};${((i + 1) / passes).toFixed(3)};1`}
                dur={`${dur}s`}
                repeatCount="indefinite"
              />
            </circle>
          </g>
        )
      })}
      {/* stepover bracket */}
      <g stroke="#fbbf24" fill="#fbbf24" fontSize="10">
        <line x1={x1 + W / 2 + 8} x2={x1 + W / 2 + 8} y1={lanes[0]} y2={lanes[1]} />
        <line x1={x1 + W / 2 + 4} x2={x1 + W / 2 + 12} y1={lanes[0]} y2={lanes[0]} />
        <line x1={x1 + W / 2 + 4} x2={x1 + W / 2 + 12} y1={lanes[1]} y2={lanes[1]} />
        <text x={x1 + W / 2 + 15} y={(lanes[0] + lanes[1]) / 2 + 4} stroke="none">
          {pct}%
        </text>
      </g>
      <text x={10} y={height - 10} fill="#94a3b8" fontSize="10.5">
        Moves over {pct}% of the cut width · {100 - pct}% overlap
      </text>
    </svg>
  )
}
