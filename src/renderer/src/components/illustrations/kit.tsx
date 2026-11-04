/**
 * Small building blocks for the animated help illustrations shown in (?) tooltips: a framed scene,
 * a copper-clad board in side view, a cutter, a block of G-code and a dial. Everything is SVG with
 * SMIL animation so it runs without JavaScript timers.
 */
import type { ReactNode } from 'react'

export const W = 320
export const H = 150

/** Dark rounded frame with an optional caption at the bottom. */
export function Scene({
  children,
  caption,
  height = H
}: {
  children: ReactNode
  caption?: ReactNode
  height?: number
}): React.JSX.Element {
  return (
    <figure className="overflow-hidden rounded-md border border-slate-800 bg-[#0b1220]">
      <svg viewBox={`0 0 ${W} ${height}`} className="block h-auto w-full select-none" role="img">
        {children}
      </svg>
      {caption && (
        <figcaption className="px-2 pb-1.5 text-[10.5px] leading-snug text-slate-500">{caption}</figcaption>
      )}
    </figure>
  )
}

/** Side view of a copper-clad board: copper on top (y), fibreglass below. */
export function BoardSide({
  y = 110,
  x = 10,
  width = W - 20,
  thick = 22
}: {
  y?: number
  x?: number
  width?: number
  thick?: number
}): React.JSX.Element {
  return (
    <g>
      <rect x={x} y={y + 3} width={width} height={thick} fill="#3f5a2a" />
      <rect x={x} y={y} width={width} height={3} fill="#d08a4a" />
    </g>
  )
}

/** A cutter drawn tip-down at (0,0) (use a transform to place / animate it). */
export function Bit({
  kind = 'flat',
  r = 6,
  len = 34,
  shank = 9
}: {
  kind?: 'flat' | 'vbit' | 'ball' | 'drill'
  r?: number
  len?: number
  shank?: number
}): React.JSX.Element {
  const tip =
    kind === 'vbit'
      ? `M ${-r} ${-len * 0.55} L 0 0 L ${r} ${-len * 0.55}`
      : kind === 'drill'
        ? `M ${-r} ${-r * 0.7} L 0 0 L ${r} ${-r * 0.7}`
        : kind === 'ball'
          ? `M ${-r} ${-r} A ${r} ${r} 0 0 0 ${r} ${-r}`
          : `M ${-r} 0 L ${r} 0`
  const sideTop = -len
  const body =
    kind === 'vbit'
      ? `M ${-r} ${sideTop} L ${r} ${sideTop} L ${r} ${-len * 0.55} L 0 0 L ${-r} ${-len * 0.55} Z`
      : kind === 'drill'
        ? `M ${-r} ${sideTop} L ${r} ${sideTop} L ${r} ${-r * 0.7} L 0 0 L ${-r} ${-r * 0.7} Z`
        : kind === 'ball'
          ? `M ${-r} ${sideTop} L ${r} ${sideTop} L ${r} ${-r} A ${r} ${r} 0 0 1 ${-r} ${-r} Z`
          : `M ${-r} ${sideTop} L ${r} ${sideTop} L ${r} 0 L ${-r} 0 Z`
  return (
    <g>
      <rect x={-shank / 2} y={sideTop - 26} width={shank} height={26} fill="#94a3b8" />
      <rect x={-shank / 2 - 6} y={sideTop - 46} width={shank + 12} height={20} rx={3} fill="#475569" />
      <path d={body} fill="#cbd5e1" stroke="#1e293b" strokeWidth={0.8} />
      <path d={tip} fill="none" stroke="#f8fafc" strokeWidth={0.6} opacity={0.6} />
      {kind !== 'vbit' && (
        <g stroke="#475569" strokeWidth={1.2}>
          {Array.from({ length: 4 }).map((_, i) => (
            <line key={i} x1={-r} x2={r} y1={sideTop + 6 + i * 7} y2={sideTop + 10 + i * 7} />
          ))}
        </g>
      )}
    </g>
  )
}

/** Monospace G-code lines; `hl` lines are highlighted, `dim` lines faded. */
export function Code({
  lines,
  x = 14,
  y = 22,
  hl = [],
  dim = [],
  size = 11
}: {
  lines: string[]
  x?: number
  y?: number
  hl?: number[]
  dim?: number[]
  size?: number
}): React.JSX.Element {
  return (
    <g fontFamily="ui-monospace, monospace" fontSize={size}>
      {lines.map((l, i) => (
        <g key={i}>
          {hl.includes(i) && (
            <rect
              x={x - 4}
              y={y + i * (size + 5) - size}
              width={W - 2 * x + 8}
              height={size + 5}
              rx={2}
              fill="#0ea5e9"
              opacity={0.18}
            />
          )}
          <text
            x={x}
            y={y + i * (size + 5)}
            fill={hl.includes(i) ? '#7dd3fc' : dim.includes(i) ? '#475569' : '#cbd5e1'}
          >
            {l}
          </text>
        </g>
      ))}
    </g>
  )
}

/** Semicircular dial with a needle; `from`/`to` are 0..1 positions the needle sweeps between. */
export function Dial({
  cx,
  cy,
  r = 40,
  from,
  to,
  label,
  dur = 3
}: {
  cx: number
  cy: number
  r?: number
  from: number
  to: number
  label?: ReactNode
  dur?: number
}): React.JSX.Element {
  const ang = (f: number): number => 180 - 180 * Math.max(0, Math.min(1, f))
  return (
    <g>
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="#334155"
        strokeWidth={8}
      />
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="#38bdf8"
        strokeWidth={8}
        strokeDasharray={`${Math.PI * r * to} ${Math.PI * r}`}
        opacity={0.35}
      />
      <g>
        <animateTransform
          attributeName="transform"
          type="rotate"
          values={`${-ang(from)} ${cx} ${cy};${-ang(to)} ${cx} ${cy};${-ang(from)} ${cx} ${cy}`}
          dur={`${dur}s`}
          repeatCount="indefinite"
        />
        <line
          x1={cx}
          y1={cy}
          x2={cx + r - 6}
          y2={cy}
          stroke="#fbbf24"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      </g>
      <circle cx={cx} cy={cy} r={4} fill="#fbbf24" />
      {label && (
        <text x={cx} y={cy + 18} textAnchor="middle" fontSize={11} fill="#cbd5e1">
          {label}
        </text>
      )}
    </g>
  )
}

export function Label({
  x,
  y,
  children,
  color = '#94a3b8',
  anchor = 'start',
  size = 10
}: {
  x: number
  y: number
  children: ReactNode
  color?: string
  anchor?: 'start' | 'middle' | 'end'
  size?: number
}): React.JSX.Element {
  return (
    <text x={x} y={y} fontSize={size} fill={color} textAnchor={anchor} fontFamily="ui-sans-serif, system-ui">
      {children}
    </text>
  )
}
