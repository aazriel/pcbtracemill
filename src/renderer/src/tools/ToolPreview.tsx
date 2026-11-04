import { useId } from 'react'
import type { Tool } from '@core/model/types'

/** Maps spindle RPM onto a visible animation period (real speeds are far too fast to see). */
function spinPeriod(rpm: number): number {
  const r = Math.max(0, Math.min(30000, Number.isFinite(rpm) ? rpm : 0))
  return Math.max(0.25, 2.4 - (r / 30000) * 2.15)
}

/**
 * Animated side-view drawing of a cutting tool. Proportions follow the actual geometry so
 * users see how diameter, tip angle, flute length etc. change the tool's shape. The flutes scroll
 * sideways to suggest rotation; the speed follows the spindle RPM.
 */
export function ToolPreview({
  tool,
  width = 220,
  height = 260,
  depth,
  spinning = true,
  compact = false
}: {
  tool: Tool
  width?: number
  height?: number
  /** Optional cut depth to visualise the cut width at the surface (V-bits). */
  depth?: number
  spinning?: boolean
  /** Small thumbnail: no dimension labels. */
  compact?: boolean
}): React.JSX.Element {
  const rid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const id = `tp${rid}`
  const g = tool.geometry
  const D = Math.max(0.05, Number.isFinite(g.diameter) ? g.diameter : 1)
  const flute = Math.max(0.2, Number.isFinite(g.fluteLength) ? g.fluteLength : 1)
  const shankD = tool.type === 'vbit' ? D : Math.max(D, 3.175)
  const shankLen = Math.max(shankD * 2.2, 6)
  const totalLen = flute + shankLen
  const padTop = compact ? 4 : 34
  const padBottom = compact ? 4 : 26
  const usableH = height - padTop - padBottom
  const scale = Math.min(
    (width * (compact ? 0.62 : 0.42)) / D,
    (width * (compact ? 0.8 : 0.6)) / shankD,
    usableH / totalLen
  )
  const cx = width / 2
  const tipY = height - padBottom
  const r = (D / 2) * scale
  const shankR = (shankD / 2) * scale
  const fluteTop = tipY - flute * scale
  const shankTop = fluteTop - shankLen * scale

  // Tip profile polygon (from fluteTop down to the tip), symmetric around cx.
  let body: string
  let tipLabel = ''
  let angleArc: { half: number; apexY: number } | null = null
  if (tool.type === 'vbit') {
    const angle = Math.min(170, Math.max(5, g.tipAngle ?? 30))
    const half = (angle * Math.PI) / 360
    const tipR = Math.min(r, ((g.tipDiameter ?? 0) / 2) * scale)
    const coneH = Math.min(flute * scale, (r - tipR) / Math.tan(half))
    const coneTop = tipY - coneH
    body = `M ${cx - r} ${fluteTop} L ${cx + r} ${fluteTop} L ${cx + r} ${coneTop} L ${cx + tipR} ${tipY} L ${cx - tipR} ${tipY} L ${cx - r} ${coneTop} Z`
    tipLabel = `${angle}°`
    angleArc = { half, apexY: tipY + tipR / Math.tan(half) }
  } else if (tool.type === 'ball') {
    const br = Math.min(r, flute * scale)
    body = `M ${cx - r} ${fluteTop} L ${cx + r} ${fluteTop} L ${cx + r} ${tipY - br} A ${r} ${br} 0 0 1 ${cx - r} ${tipY - br} Z`
  } else if (tool.type === 'drill') {
    const angle = Math.min(180, Math.max(60, g.pointAngle ?? 118))
    const half = (angle * Math.PI) / 360
    const pointH = Math.min(flute * scale, r / Math.tan(half))
    body = `M ${cx - r} ${fluteTop} L ${cx + r} ${fluteTop} L ${cx + r} ${tipY - pointH} L ${cx} ${tipY} L ${cx - r} ${tipY - pointH} Z`
    tipLabel = `${angle}°`
    angleArc = { half, apexY: tipY }
  } else {
    body = `M ${cx - r} ${fluteTop} L ${cx + r} ${fluteTop} L ${cx + r} ${tipY} L ${cx - r} ${tipY} Z`
  }

  const fluteCount = Math.max(1, Math.min(8, Math.round(g.flutes) || 2))
  const helixPitch = Math.max(8, r * 2.2)
  const isCorn = tool.type === 'corn'
  const period = spinPeriod(tool.feeds.spindleRpm)

  // Cut width at depth for V-bits
  let cutW: number | null = null
  if (tool.type === 'vbit' && depth && depth > 0) {
    const half = ((g.tipAngle ?? 30) * Math.PI) / 360
    cutW = Math.min(D, (g.tipDiameter ?? 0) + 2 * depth * Math.tan(half))
  }

  const arcR = Math.max(12, Math.min(26, r * 0.9))
  const arcPath =
    angleArc &&
    (() => {
      const { half, apexY } = angleArc
      const x1 = cx - arcR * Math.sin(half)
      const x2 = cx + arcR * Math.sin(half)
      const y = apexY - arcR * Math.cos(half)
      return `M ${x1} ${y} A ${arcR} ${arcR} 0 0 1 ${x2} ${y}`
    })()

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Preview of ${tool.name}`}
      className="select-none"
    >
      <defs>
        <linearGradient id={`${id}-steel`} x1="0" x2="1">
          <stop offset="0" stopColor="#6b7280" />
          <stop offset="0.35" stopColor="#e5e7eb" />
          <stop offset="0.55" stopColor="#9ca3af" />
          <stop offset="1" stopColor="#4b5563" />
        </linearGradient>
        <linearGradient id={`${id}-carbide`} x1="0" x2="1">
          <stop offset="0" stopColor="#52525b" />
          <stop offset="0.4" stopColor="#d4d4d8" />
          <stop offset="0.6" stopColor="#a1a1aa" />
          <stop offset="1" stopColor="#3f3f46" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" x2="1">
          <stop offset="0" stopColor="white" stopOpacity="0" />
          <stop offset="0.5" stopColor="white" stopOpacity="0.35" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d={body} />
        </clipPath>
        <pattern
          id={`${id}-flutes`}
          width={helixPitch}
          height={helixPitch}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(35)"
        >
          {Array.from({ length: fluteCount }).map((_, i) => (
            <rect
              key={i}
              x={(i * helixPitch) / fluteCount}
              y="0"
              width={helixPitch / fluteCount / 2.2}
              height={helixPitch}
              fill="rgba(15,23,42,0.55)"
            />
          ))}
          {spinning && (
            <animateTransform
              attributeName="patternTransform"
              type="translate"
              from="0 0"
              to={`${helixPitch} 0`}
              dur={`${period}s`}
              repeatCount="indefinite"
              additive="sum"
            />
          )}
        </pattern>
        <pattern id={`${id}-corn`} width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 3 L3 0 L6 3 L3 6 Z" fill="rgba(15,23,42,0.5)" />
          {spinning && (
            <animateTransform
              attributeName="patternTransform"
              type="translate"
              from="0 0"
              to="6 0"
              dur={`${period / 2}s`}
              repeatCount="indefinite"
            />
          )}
        </pattern>
      </defs>

      {/* PCB surface line for V-bit depth visualisation */}
      {depth !== undefined && depth > 0 && (
        <g>
          <rect
            x={0}
            y={tipY - depth * scale}
            width={width}
            height={depth * scale + padBottom}
            fill="rgba(217,119,6,0.12)"
          />
          <line
            x1={0}
            x2={width}
            y1={tipY - depth * scale}
            y2={tipY - depth * scale}
            stroke="#d97706"
            strokeDasharray="4 3"
          />
        </g>
      )}

      {/* shank */}
      <rect
        x={cx - shankR}
        y={shankTop}
        width={shankR * 2}
        height={shankLen * scale}
        fill={`url(#${id}-steel)`}
        rx={2}
      />
      {shankR > r + 0.5 && tool.type !== 'vbit' && (
        <path
          d={`M ${cx - shankR} ${fluteTop} L ${cx - r} ${fluteTop + Math.min(6, (shankR - r) * 0.8)} L ${cx + r} ${fluteTop + Math.min(6, (shankR - r) * 0.8)} L ${cx + shankR} ${fluteTop} Z`}
          fill={`url(#${id}-steel)`}
        />
      )}
      {/* cutting body */}
      <path d={body} fill={`url(#${id}-carbide)`} stroke="#27272a" strokeWidth={0.8} />
      <g clipPath={`url(#${id}-clip)`}>
        <rect
          x={cx - r - 2}
          y={fluteTop}
          width={r * 2 + 4}
          height={tipY - fluteTop + 2}
          fill={`url(#${id}-${isCorn ? 'corn' : 'flutes'})`}
        />
        {spinning && (
          <rect x={cx - r} y={fluteTop} width={r} height={tipY - fluteTop} fill={`url(#${id}-shine)`}>
            <animate
              attributeName="x"
              values={`${cx - r * 1.5};${cx + r * 0.5};${cx - r * 1.5}`}
              dur={`${period * 2}s`}
              repeatCount="indefinite"
            />
          </rect>
        )}
      </g>

      {!compact && (
        <g fontSize="11" fontFamily="ui-sans-serif, system-ui">
          {/* rotation arrow + RPM */}
          <g stroke="#64748b" fill="none" strokeWidth={1.4}>
            <path
              d={`M ${cx - shankR - 6} ${shankTop + 10} Q ${cx} ${shankTop - 6} ${cx + shankR + 6} ${shankTop + 10}`}
              markerEnd=""
            />
            <path
              d={`M ${cx + shankR + 1} ${shankTop + 4} L ${cx + shankR + 6} ${shankTop + 10} L ${cx + shankR - 1} ${shankTop + 11}`}
            />
          </g>
          <text x={cx} y={shankTop - 10} textAnchor="middle" fill="#94a3b8">
            {Math.round(tool.feeds.spindleRpm).toLocaleString('en-US')} RPM
          </text>

          {/* diameter */}
          <g stroke="#38bdf8" fill="#38bdf8">
            <line x1={cx - r} x2={cx + r} y1={fluteTop - 8} y2={fluteTop - 8} />
            <line x1={cx - r} x2={cx - r} y1={fluteTop - 12} y2={fluteTop - 4} />
            <line x1={cx + r} x2={cx + r} y1={fluteTop - 12} y2={fluteTop - 4} />
            <text x={cx + Math.max(r, shankR) + 8} y={fluteTop - 4} stroke="none">
              Ø{' '}
              {D.toFixed(D < 1 ? 2 : D % 1 ? 3 : 1)
                .replace(/0+$/, '')
                .replace(/\.$/, '')}{' '}
              mm
            </text>
          </g>

          {/* cutting length */}
          <g stroke="#a78bfa" fill="#a78bfa">
            <line
              x1={cx - Math.max(r, shankR) - 12}
              x2={cx - Math.max(r, shankR) - 12}
              y1={fluteTop}
              y2={tipY}
            />
            <line
              x1={cx - Math.max(r, shankR) - 16}
              x2={cx - Math.max(r, shankR) - 8}
              y1={fluteTop}
              y2={fluteTop}
            />
            <line x1={cx - Math.max(r, shankR) - 16} x2={cx - Math.max(r, shankR) - 8} y1={tipY} y2={tipY} />
            <text
              x={cx - Math.max(r, shankR) - 18}
              y={(fluteTop + tipY) / 2 + 4}
              stroke="none"
              textAnchor="end"
              fontSize="10"
            >
              {flute.toFixed(1)} mm
            </text>
          </g>

          {/* tip / point angle */}
          {arcPath && (
            <g>
              <path d={arcPath} stroke="#fbbf24" fill="none" strokeWidth={1.5} />
              <text x={cx + arcR + 6} y={tipY - arcR * 0.4} fill="#fbbf24">
                {tipLabel}
              </text>
            </g>
          )}

          {tool.type === 'vbit' && (g.tipDiameter ?? 0) > 0 && (
            <text x={cx} y={tipY + 16} textAnchor="middle" fill="#fb7185" fontSize="10">
              tip {g.tipDiameter} mm
            </text>
          )}

          {cutW !== null && (
            <g stroke="#f43f5e" fill="#f43f5e">
              <line
                x1={cx - (cutW / 2) * scale}
                x2={cx + (cutW / 2) * scale}
                y1={tipY - (depth ?? 0) * scale}
                y2={tipY - (depth ?? 0) * scale}
                strokeWidth={2.5}
              />
            </g>
          )}
        </g>
      )}
    </svg>
  )
}
