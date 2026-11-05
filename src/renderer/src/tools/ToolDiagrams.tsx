import { useId } from 'react'
import type { Tool } from '@core/model/types'
import { cutWidthAt, fmtMm } from './toolMeta'

const COPPER_MM = 0.035

/**
 * Zoomed-in cross-section of the tool tip pushed `depth` mm into a copper-clad board, showing the cut it
 * leaves and how wide it is at the surface: a V-groove for V-bits, a round groove for ball end mills, a
 * straight-walled groove for flat end mills and corn bits, a pointed hole for drills.
 * With `animate` the tool plunges in, pauses, and lifts out again so the cut is revealed.
 */
export function CutDepthDiagram({
  tool,
  depth,
  width = 300,
  height = 150,
  animate = false
}: {
  tool: Tool
  depth: number
  width?: number
  height?: number
  animate?: boolean
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
  // tool height (mm above the tip) visible up to the top edge, also while it is lifted out
  const topH = d + (surfaceY + 40) / s

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
  } else if (tool.type === 'ball') {
    const N = 24
    for (let i = 0; i <= N; i++) {
      const a = Math.PI - (i / N) * Math.PI // from left (π) to right (0) along the bottom
      pts.push([R * Math.cos(a), -(R - R * Math.sin(a))])
    }
    pts.push([R, -Math.max(topH, R)], [-R, -Math.max(topH, R)])
  } else if (tool.type === 'drill') {
    const half = ((g.pointAngle ?? 118) * Math.PI) / 360
    const pointH = R / Math.tan(half)
    pts.push([0, 0], [R, -pointH], [R, -Math.max(topH, pointH)], [-R, -Math.max(topH, pointH)], [-R, -pointH])
  } else {
    pts.push([-R, 0], [R, 0], [R, -topH], [-R, -topH])
  }
  const poly = pts.map(([x, y]) => `${cx + x * s},${y * s}`).join(' ')
  const tipY = surfaceY + d * s
  const liftY = surfaceY - 30
  const copperH = Math.max(3, COPPER_MM * s)
  const wPx = cutW * s
  const dur = 3.2

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
        <clipPath id={`${rid}-below`}>
          <rect x={0} y={surfaceY} width={width} height={height - surfaceY} />
        </clipPath>
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
      {/* the cut it leaves */}
      <polygon
        points={poly}
        transform={`translate(0 ${tipY})`}
        clipPath={`url(#${rid}-below)`}
        fill="#0b0f14"
        stroke="#1e293b"
      />
      {/* tool */}
      <g
        transform={`translate(0 ${tipY})`}
        style={animate ? undefined : { transition: 'transform 250ms ease-out' }}
      >
        {animate && (
          <animateTransform
            attributeName="transform"
            type="translate"
            dur={`${dur}s`}
            repeatCount="indefinite"
            keyTimes="0;0.3;0.65;0.9;1"
            values={`0 ${liftY};0 ${tipY};0 ${tipY};0 ${liftY};0 ${liftY}`}
          />
        )}
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
          {tool.type === 'drill' ? `hole ${cutW.toFixed(2)} mm wide` : `cuts ${cutW.toFixed(3)} mm wide`}
        </text>
      </g>
    </svg>
  )
}
