import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BBox, Material, OriginCorner } from '@core/model/types'
import { compose, bboxIsEmpty, type Affine } from '@core/geometry'
import { rotatedBoardSize } from '@core/cam'
import {
  alignmentPinPositions,
  boardToStockTransform,
  placedBoardBBox,
  workOriginInStock
} from '@core/toolpath'
import type { BoardDrawing } from './boardDrawing'
import { mm } from './materialIssues'
import { useTween } from './useTween'

const PAD = { l: 64, r: 64, t: 56, b: 70 }

function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 640, h: 440 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect
      if (r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

const fin = (v: number, d = 0): number => (Number.isFinite(v) ? v : d)

/** Problems with the size/placement, phrased for the red banner. */
export function sizeProblems(m: Material, bbox: BBox): string[] {
  if (bboxIsEmpty(bbox)) return []
  const { width: bw, height: bh } = rotatedBoardSize(bbox, fin(m.rotation))
  const out: string[] = []
  if (bw > m.width + 1e-9) out.push(`Material is ${mm(bw - m.width, 2)} mm too narrow`)
  if (bh > m.height + 1e-9) out.push(`Material is ${mm(bh - m.height, 2)} mm too short`)
  if (!out.length) {
    const p = placedBoardBBox(m, bbox)
    if (p.minX < -1e-9) out.push(`Board sticks out ${mm(-p.minX, 2)} mm on the left`)
    if (p.maxX > m.width + 1e-9) out.push(`Board sticks out ${mm(p.maxX - m.width, 2)} mm on the right`)
    if (p.minY < -1e-9) out.push(`Board sticks out ${mm(-p.minY, 2)} mm at the front`)
    if (p.maxY > m.height + 1e-9) out.push(`Board sticks out ${mm(p.maxY - m.height, 2)} mm at the back`)
  }
  return out
}

/** Arrow-headed dimension line with a centred label. */
function Dim({
  x1,
  y1,
  x2,
  y2,
  label,
  color,
  labelOffset = 0,
  vertical = false,
  labelAt
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
  color: string
  labelOffset?: number
  /** Explicit label position (start-anchored), e.g. next to a short arrow. */
  labelAt?: { x: number; y: number }
  vertical?: boolean
}): React.JSX.Element {
  const len = Math.hypot(x2 - x1, y2 - y1)
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const short = len < 16
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={1.2}
        markerStart={short ? undefined : `url(#mp-arrow-${color.slice(1)})`}
        markerEnd={short ? undefined : `url(#mp-arrow-${color.slice(1)})`}
      />
      <text
        x={labelAt ? labelAt.x : vertical ? mx + labelOffset : mx}
        y={labelAt ? labelAt.y : vertical ? my : my + labelOffset}
        fontSize={11}
        fontWeight={600}
        fill={color}
        textAnchor={labelAt ? 'start' : vertical ? (labelOffset < 0 ? 'end' : 'start') : 'middle'}
        dominantBaseline="middle"
        stroke="#0b0f14"
        strokeWidth={3.5}
        paintOrder="stroke"
      >
        {label}
      </text>
    </g>
  )
}

function Defs(): React.JSX.Element {
  return (
    <defs>
      <linearGradient id="mp-copper" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#c47f45" />
        <stop offset="0.45" stopColor="#e3a46c" />
        <stop offset="0.55" stopColor="#d18f55" />
        <stop offset="1" stopColor="#a8622e" />
      </linearGradient>
      <pattern id="mp-brush" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="#fff3e0" strokeOpacity="0.09" strokeWidth="1" />
        <line x1="3" y1="0" x2="3" y2="6" stroke="#5a2e10" strokeOpacity="0.08" strokeWidth="1" />
      </pattern>
      <pattern id="mp-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="7" height="7" fill="rgba(244,63,94,0.18)" />
        <line x1="0" y1="0" x2="0" y2="7" stroke="#f43f5e" strokeWidth="2.2" />
      </pattern>
      {['38bdf8', 'fbbf24', 'f43f5e'].map((c) => (
        <marker
          key={c}
          id={`mp-arrow-${c}`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill={`#${c}`} />
        </marker>
      ))}
      <marker
        id="mp-ax-x"
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto"
      >
        <path d="M0 0L10 5L0 10z" fill="#f87171" />
      </marker>
      <marker
        id="mp-ax-y"
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto"
      >
        <path d="M0 0L10 5L0 10z" fill="#4ade80" />
      </marker>
      <marker
        id="mp-flip"
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto"
      >
        <path d="M0 0L10 5L0 10z" fill="#c4b5fd" />
      </marker>
    </defs>
  )
}

/**
 * Live, to-scale top view of the material: copper-clad stock, the board placed on it (outline + faint copper),
 * dimensions, offsets, the work origin, alignment pins with the flip line, and red marks where it does not fit.
 * All geometry is derived from a tweened copy of the material so every change glides.
 */
export function MaterialPreview({
  material,
  bbox,
  drawing,
  overlay
}: {
  material: Material
  bbox: BBox
  drawing: BoardDrawing
  overlay?: ReactNode
}): React.JSX.Element {
  const [ref, size] = useSize<HTMLDivElement>()
  const o0 = workOriginInStock(material, bbox)
  const pinsOn = material.doubleSided && material.alignment.enabled
  const t = useTween({
    width: Math.max(0.1, fin(material.width, 1)),
    height: Math.max(0.1, fin(material.height, 1)),
    offsetX: fin(material.offsetX),
    offsetY: fin(material.offsetY),
    rotation: fin(material.rotation),
    ox: fin(o0.x),
    oy: fin(o0.y),
    pinD: pinsOn ? Math.max(0, fin(material.alignment.pinDiameter)) : 0,
    margin: fin(material.alignment.margin)
  })
  const tm: Material = {
    ...material,
    width: t.width,
    height: t.height,
    offsetX: t.offsetX,
    offsetY: t.offsetY,
    rotation: t.rotation,
    alignment: { ...material.alignment, margin: t.margin }
  }
  const hasBoard = !bboxIsEmpty(bbox)
  const pb = placedBoardBBox(tm, bbox)
  const pins = pinsOn && hasBoard ? alignmentPinPositions(tm, bbox) : []

  // Fit stock ∪ board ∪ pins into the available area.
  const ext = {
    minX: Math.min(0, hasBoard ? pb.minX : 0, ...pins.map((p) => p.x - t.pinD)),
    minY: Math.min(0, hasBoard ? pb.minY : 0, ...pins.map((p) => p.y - t.pinD)),
    maxX: Math.max(t.width, hasBoard ? pb.maxX : 0, ...pins.map((p) => p.x + t.pinD)),
    maxY: Math.max(t.height, hasBoard ? pb.maxY : 0, ...pins.map((p) => p.y + t.pinD))
  }
  const ew = Math.max(1, ext.maxX - ext.minX)
  const eh = Math.max(1, ext.maxY - ext.minY)
  const aw = Math.max(40, size.w - PAD.l - PAD.r)
  const ah = Math.max(40, size.h - PAD.t - PAD.b)
  const s = Math.min(aw / ew, ah / eh)
  const left = PAD.l + (aw - ew * s) / 2 - ext.minX * s
  const top = PAD.t + (ah - eh * s) / 2 + ext.maxY * s
  const X = (x: number): number => left + x * s
  const Y = (y: number): number => top - y * s
  const screen: Affine = [s, 0, 0, -s, left, top]
  const boardM = compose(screen, boardToStockTransform(tm, bbox))
  const matrix = `matrix(${boardM.join(' ')})`

  const problems = useMemo(() => sizeProblems(material, bbox), [material, bbox])
  const sizeBad = problems.length > 0

  // Stock corners on screen.
  const sx0 = X(0)
  const sx1 = X(t.width)
  const sy0 = Y(0) // bottom (front)
  const sy1 = Y(t.height) // top (back)

  // Origin
  const OX = X(t.ox)
  const OY = Y(t.oy)
  const corner: OriginCorner = material.origin
  const right = corner === 'bottom-right' || corner === 'top-right'
  const topSide = corner === 'top-left' || corner === 'top-right'
  const labelX = corner === 'center' ? OX + 12 : right ? OX + 4 : OX - 4
  const labelY = corner === 'center' ? OY - 22 : topSide ? sy1 - 34 : sy0 + 44
  // Text runs from the corner towards the middle of the stock so it never leaves the view.
  const anchor = corner === 'center' ? 'start' : right ? 'end' : 'start'

  // Offsets (only meaningful when the board exists)
  const bx0 = X(pb.minX)
  const by0 = Y(pb.minY)
  const bcx = X((pb.minX + pb.maxX) / 2)
  // X-offset arrow sits low on the board so it does not collide with the flip line / pins.
  const offY = Y(pb.minY + (pb.maxY - pb.minY) * 0.22)

  // Flip line
  const axisX = material.alignment.axis === 'x'
  const flipY = Y(t.height / 2)
  const flipX = X(t.width / 2)

  const overhang: { x: number; y: number; w: number; h: number }[] = []
  if (hasBoard) {
    const clip = (x0: number, y0: number, x1: number, y1: number): void => {
      if (x1 - x0 > 1e-6 && y1 - y0 > 1e-6)
        overhang.push({ x: X(x0), y: Y(y1), w: (x1 - x0) * s, h: (y1 - y0) * s })
    }
    clip(pb.minX, pb.minY, Math.min(0, pb.maxX), pb.maxY) // left
    clip(Math.max(t.width, pb.minX), pb.minY, pb.maxX, pb.maxY) // right
    clip(Math.max(0, pb.minX), pb.minY, Math.min(t.width, pb.maxX), Math.min(0, pb.maxY)) // bottom
    clip(Math.max(0, pb.minX), Math.max(t.height, pb.minY), Math.min(t.width, pb.maxX), pb.maxY) // top
  }

  const nonScale = { vectorEffect: 'non-scaling-stroke' } as const
  const { width: bw, height: bh } = rotatedBoardSize(bbox, fin(material.rotation))

  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden" data-testid="material-preview">
      <svg width={size.w} height={size.h} className="absolute inset-0 select-none">
        <Defs />
        {/* stock */}
        <rect
          x={sx0 + 5}
          y={sy1 + 6}
          width={sx1 - sx0}
          height={sy0 - sy1}
          rx={3}
          fill="#000"
          opacity={0.45}
        />
        <rect x={sx0} y={sy1} width={sx1 - sx0} height={sy0 - sy1} rx={2} fill="url(#mp-copper)" />
        <rect x={sx0} y={sy1} width={sx1 - sx0} height={sy0 - sy1} rx={2} fill="url(#mp-brush)" />
        <rect
          x={sx0}
          y={sy1}
          width={sx1 - sx0}
          height={sy0 - sy1}
          rx={2}
          fill="none"
          stroke={sizeBad ? '#f43f5e' : '#f5c08a'}
          strokeWidth={sizeBad ? 2 : 1}
        />
        <text x={sx0 + 6} y={sy1 + 14} fontSize={10} fill="#3b1f0b" fontWeight={600} opacity={0.75}>
          Copper-clad material
        </text>

        {/* board */}
        {hasBoard && (
          <g transform={matrix}>
            <rect
              x={bbox.minX}
              y={bbox.minY}
              width={bbox.maxX - bbox.minX}
              height={bbox.maxY - bbox.minY}
              fill="#1f2937"
              fillOpacity={0.28}
              stroke={drawing.outline ? 'none' : '#fef3c7'}
              strokeWidth={1.4}
              strokeDasharray={drawing.outline ? undefined : '5 3'}
              style={nonScale}
            />
            {drawing.copperBottom && (
              <path d={drawing.copperBottom} fill="#fde7c7" fillOpacity={0.1} fillRule="evenodd" />
            )}
            {drawing.copperTop && (
              <path d={drawing.copperTop} fill="#fff1dc" fillOpacity={0.42} fillRule="evenodd" />
            )}
            {drawing.holes.map((h, i) => (
              <circle key={i} cx={h.x} cy={h.y} r={h.r} fill="#0b0f14" fillOpacity={0.7} />
            ))}
            {drawing.outline && (
              <path d={drawing.outline} fill="none" stroke="#fef3c7" strokeWidth={1.6} style={nonScale} />
            )}
          </g>
        )}

        {/* overhang (board outside the material) */}
        {overhang.map((r, i) => (
          <rect
            key={i}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            fill="url(#mp-hatch)"
            stroke="#f43f5e"
            strokeWidth={1.5}
          />
        ))}

        {/* flip line + animated ghost of the flipped board */}
        {pinsOn && hasBoard && (
          <g>
            {axisX ? (
              <line
                x1={sx0 - 16}
                x2={sx1 + 16}
                y1={flipY}
                y2={flipY}
                stroke="#c4b5fd"
                strokeWidth={1.5}
                strokeDasharray="7 5"
              >
                <animate
                  attributeName="stroke-dashoffset"
                  values="0;-24"
                  dur="1.2s"
                  repeatCount="indefinite"
                />
              </line>
            ) : (
              <line
                y1={sy1 - 16}
                y2={sy0 + 16}
                x1={flipX}
                x2={flipX}
                stroke="#c4b5fd"
                strokeWidth={1.5}
                strokeDasharray="7 5"
              >
                <animate
                  attributeName="stroke-dashoffset"
                  values="0;-24"
                  dur="1.2s"
                  repeatCount="indefinite"
                />
              </line>
            )}
            <g transform={axisX ? `translate(0 ${flipY})` : `translate(${flipX} 0)`}>
              <g>
                <animateTransform
                  attributeName="transform"
                  type="scale"
                  values={axisX ? '1 1;1 1;1 -1;1 -1;1 1' : '1 1;1 1;-1 1;-1 1;1 1'}
                  keyTimes="0;0.15;0.45;0.7;1"
                  dur="4s"
                  repeatCount="indefinite"
                />
                <g transform={axisX ? `translate(0 ${-flipY})` : `translate(${-flipX} 0)`}>
                  <rect
                    x={bx0}
                    y={Y(pb.maxY)}
                    width={(pb.maxX - pb.minX) * s}
                    height={(pb.maxY - pb.minY) * s}
                    fill="#a78bfa"
                    fillOpacity={0.12}
                    stroke="#c4b5fd"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                  />
                </g>
              </g>
            </g>
            {/* curved flip arrow */}
            {axisX ? (
              <g transform={`translate(${sx1 + 30} ${flipY})`}>
                <path
                  d="M -8 22 C 18 14, 18 -14, -8 -22"
                  fill="none"
                  stroke="#c4b5fd"
                  strokeWidth={2}
                  markerEnd="url(#mp-flip)"
                  strokeDasharray="5 3"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    values="16;0"
                    dur="0.9s"
                    repeatCount="indefinite"
                  />
                </path>
                <text x={-2} y={38} fontSize={10} fill="#c4b5fd" textAnchor="middle" fontWeight={600}>
                  flip
                </text>
              </g>
            ) : (
              <g transform={`translate(${flipX} ${sy1 - 30})`}>
                <path
                  d="M -22 8 C -14 -18, 14 -18, 22 8"
                  fill="none"
                  stroke="#c4b5fd"
                  strokeWidth={2}
                  markerEnd="url(#mp-flip)"
                  strokeDasharray="5 3"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    values="16;0"
                    dur="0.9s"
                    repeatCount="indefinite"
                  />
                </path>
                <text x={30} y={-6} fontSize={10} fill="#c4b5fd" fontWeight={600}>
                  flip
                </text>
              </g>
            )}
          </g>
        )}

        {/* pins */}
        {pins.map((p, i) => (
          <g key={i}>
            <circle
              cx={X(p.x)}
              cy={Y(p.y)}
              r={Math.max(2.5, (t.pinD / 2) * s)}
              fill="#0b0f14"
              stroke="#e2e8f0"
              strokeWidth={1.4}
            />
            <circle cx={X(p.x)} cy={Y(p.y)} r={1.4} fill="#e2e8f0" />
          </g>
        ))}

        {/* dimensions */}
        <Dim
          x1={sx0}
          y1={sy0 + 18}
          x2={sx1}
          y2={sy0 + 18}
          label={`${mm(material.width, 2)} mm`}
          color="#38bdf8"
          labelOffset={0}
        />
        <line x1={sx0} x2={sx0} y1={sy0 + 4} y2={sy0 + 24} stroke="#38bdf8" strokeOpacity={0.5} />
        <line x1={sx1} x2={sx1} y1={sy0 + 4} y2={sy0 + 24} stroke="#38bdf8" strokeOpacity={0.5} />
        <Dim
          x1={sx0 - 18}
          y1={sy0}
          x2={sx0 - 18}
          y2={sy1}
          label={`${mm(material.height, 2)} mm`}
          color="#38bdf8"
          vertical
          labelOffset={-6}
        />
        <line y1={sy0} y2={sy0} x1={sx0 - 24} x2={sx0 - 4} stroke="#38bdf8" strokeOpacity={0.5} />
        <line y1={sy1} y2={sy1} x1={sx0 - 24} x2={sx0 - 4} stroke="#38bdf8" strokeOpacity={0.5} />
        {hasBoard && (
          <>
            {Math.abs(bx0 - sx0) > 2 && (
              <Dim
                x1={sx0}
                y1={offY}
                x2={bx0}
                y2={offY}
                label={`X offset ${mm(material.offsetX, 2)}`}
                color="#fbbf24"
                labelAt={{ x: Math.max(sx0, bx0) + 6, y: offY }}
              />
            )}
            {Math.abs(by0 - sy0) > 2 && (
              <Dim
                x1={bcx}
                y1={sy0}
                x2={bcx}
                y2={by0}
                label={`Y offset ${mm(material.offsetY, 2)}`}
                color="#fbbf24"
                vertical
                labelOffset={6}
              />
            )}
            <text
              x={bcx}
              y={Y(pb.maxY) - 6}
              fontSize={10}
              fill="#fef3c7"
              textAnchor="middle"
              stroke="#0b0f14"
              strokeWidth={3}
              paintOrder="stroke"
            >
              Board {mm(bw, 1)} × {mm(bh, 1)} mm
            </text>
          </>
        )}

        {/* origin */}
        <g>
          <circle cx={OX} cy={OY} r={6} fill="none" stroke="#38bdf8" strokeWidth={2}>
            <animate attributeName="r" values="5;18" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <line
            x1={OX}
            y1={OY}
            x2={OX + 34}
            y2={OY}
            stroke="#f87171"
            strokeWidth={2}
            markerEnd="url(#mp-ax-x)"
          />
          <line
            x1={OX}
            y1={OY}
            x2={OX}
            y2={OY - 34}
            stroke="#4ade80"
            strokeWidth={2}
            markerEnd="url(#mp-ax-y)"
          />
          <text
            x={OX + 40}
            y={OY + 4}
            fontSize={10}
            fontWeight={700}
            fill="#f87171"
            stroke="#0b0f14"
            strokeWidth={3}
            paintOrder="stroke"
          >
            X+
          </text>
          <text
            x={OX - 6}
            y={OY - 40}
            fontSize={10}
            fontWeight={700}
            fill="#4ade80"
            stroke="#0b0f14"
            strokeWidth={3}
            paintOrder="stroke"
          >
            Y+
          </text>
          <circle cx={OX} cy={OY} r={5.5} fill="#38bdf8" stroke="#0b0f14" strokeWidth={2} />
          {corner !== 'center' && (
            <line
              x1={OX}
              y1={OY}
              x2={labelX}
              y2={labelY - 12}
              stroke="#38bdf8"
              strokeOpacity={0.6}
              strokeDasharray="2 2"
            />
          )}
          <text
            x={labelX}
            y={labelY}
            fontSize={12}
            fontWeight={700}
            fill="#7dd3fc"
            textAnchor={anchor}
            stroke="#0b0f14"
            strokeWidth={4}
            paintOrder="stroke"
          >
            X0 Y0
            <tspan fontWeight={400} fill="#cbd5e1" fontSize={11}>
              {' '}
              — the tool starts measuring from here
            </tspan>
          </text>
        </g>

        {/* orientation hint */}
        <text x={size.w - 10} y={size.h - 10} fontSize={10} fill="#64748b" textAnchor="end">
          Seen from above · front of the machine (you) is at the bottom
        </text>
      </svg>
      {problems.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-2 flex -translate-x-1/2 flex-col items-center gap-1">
          {problems.map((p) => (
            <div
              key={p}
              className="rounded-full border border-rose-500/60 bg-rose-950/90 px-3 py-1 text-xs font-semibold text-rose-200 shadow-lg"
            >
              ✕ {p}
            </div>
          ))}
        </div>
      )}
      {overlay}
    </div>
  )
}
