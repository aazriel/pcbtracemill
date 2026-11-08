/**
 * Small live (animated) SVG illustrations used in the Step editor. They are deliberately schematic:
 * thin layers such as copper are drawn exaggerated so beginners can see what a value means.
 */
import type { ReactNode } from 'react'
import type { CutDirection, ToolType } from '@core/model/types'

const COPPER = '#c98a4b'
const COPPER_DARK = '#8a5a2c'
const FR4 = '#4d6b3a'
const SPOIL = '#5b4a3a'
const CUT = '#0b1220'
const ACCENT = '#38bdf8'

export function Figure({
  caption,
  children
}: {
  caption?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <figure className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
      {children}
      {caption && (
        <figcaption className="mt-1 text-[10.5px] leading-snug text-slate-500">{caption}</figcaption>
      )}
    </figure>
  )
}

const r3 = (v: number): string => String(Math.round(v * 1000) / 1000)

// ───────────────────────────────────────── cut depth cross-section

export function DepthCrossSection({
  depth,
  copper,
  thickness,
  toolType,
  tipAngle
}: {
  depth: number
  copper: number
  thickness: number
  toolType: ToolType | null
  tipAngle?: number
}): React.JSX.Element {
  const cu = Math.max(0.005, copper)
  const top = 34
  // Logarithmic depth scale so 35 µm copper and 1.6 mm board both fit and stay readable.
  const y = (d: number): number => top + 14 * Math.log2(1 + Math.max(0, d) / cu)
  const yCu = y(cu)
  const yBoard = Math.min(y(thickness), 118)
  const yDepth = Math.min(y(depth), 136)
  const cx = 120
  const half = toolType === 'vbit' ? ((tipAngle ?? 30) * Math.PI) / 360 : 0
  const grooveTop = toolType === 'vbit' ? Math.max(2, Math.min(18, (yDepth - top) * Math.tan(half))) : 9
  const groove =
    toolType === 'vbit'
      ? `M${cx - grooveTop},${top} L${cx},${yDepth} L${cx + grooveTop},${top} Z`
      : toolType === 'drill'
        ? `M${cx - 9},${top} L${cx - 9},${yDepth - 5} L${cx},${yDepth} L${cx + 9},${yDepth - 5} L${cx + 9},${top} Z`
        : `M${cx - 9},${top} L${cx - 9},${yDepth} L${cx + 9},${yDepth} L${cx + 9},${top} Z`
  // Tool drawn with its tip at (cx, yDepth)
  const shank = 9
  const toolPath =
    toolType === 'vbit'
      ? `M${cx},${yDepth} L${cx - shank},${yDepth - shank / Math.max(0.15, Math.tan(half))} L${cx - shank},${yDepth - 80} L${cx + shank},${yDepth - 80} L${cx + shank},${yDepth - shank / Math.max(0.15, Math.tan(half))} Z`
      : toolType === 'drill'
        ? `M${cx},${yDepth} L${cx - 9},${yDepth - 5} L${cx - 9},${yDepth - 80} L${cx + 9},${yDepth - 80} L${cx + 9},${yDepth - 5} Z`
        : `M${cx - 9},${yDepth} L${cx + 9},${yDepth} L${cx + 9},${yDepth - 80} L${cx - 9},${yDepth - 80} Z`
  const intoSpoil = depth > thickness
  return (
    <svg
      viewBox="0 0 300 140"
      className="mx-auto h-auto w-full max-w-[380px]"
      role="img"
      aria-label="Cut depth cross-section"
    >
      <rect x="0" y="0" width="300" height="140" fill="#020617" />
      <rect x="0" y={yBoard} width="240" height={140 - yBoard} fill={SPOIL} />
      <rect x="0" y={yCu} width="240" height={yBoard - yCu} fill={FR4} />
      <rect x="0" y={top} width="240" height={yCu - top} fill={COPPER} />
      <path d={groove} fill={CUT} />
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 -30; 0 -30; 0 0; 0 0; 0 -30"
          keyTimes="0; 0.2; 0.55; 0.85; 1"
          dur="3.2s"
          repeatCount="indefinite"
        />
        <path d={toolPath} fill="#cbd5e1" stroke="#64748b" strokeWidth="0.8" />
      </g>
      {/* depth dimension */}
      <line x1="30" y1={top} x2="30" y2={yDepth} stroke={ACCENT} strokeWidth="1.2" />
      <line x1="24" y1={top} x2="36" y2={top} stroke={ACCENT} strokeWidth="1.2" />
      <line x1="24" y1={yDepth} x2="36" y2={yDepth} stroke={ACCENT} strokeWidth="1.2" />
      <line
        x1="36"
        y1={yDepth}
        x2={cx - 10}
        y2={yDepth}
        stroke={ACCENT}
        strokeWidth="0.6"
        strokeDasharray="2 2"
      />
      <text
        x="40"
        y={Math.max(top + 10, (top + yDepth) / 2 + 3)}
        fill={ACCENT}
        fontSize="10"
        fontWeight="600"
      >
        {r3(depth)} mm
      </text>
      <text x="4" y={top - 6} fill="#94a3b8" fontSize="9">
        Z0 = copper surface
      </text>
      {/* legend */}
      <g fontSize="9" fill="#cbd5e1">
        <rect x="246" y={top} width="8" height="8" fill={COPPER} />
        <text x="257" y={top + 7}>
          Copper
        </text>
        <text x="257" y={top + 17} fill="#64748b">
          {r3(copper)} mm
        </text>
        <rect x="246" y={top + 26} width="8" height="8" fill={FR4} />
        <text x="257" y={top + 33}>
          Board
        </text>
        <text x="257" y={top + 43} fill="#64748b">
          {r3(thickness)} mm
        </text>
        <rect x="246" y={top + 52} width="8" height="8" fill={SPOIL} />
        <text x="257" y={top + 59}>
          Spoil-
        </text>
        <text x="257" y={top + 69}>
          board
        </text>
      </g>
      {intoSpoil && (
        <text x="140" y="134" fill="#fbbf24" fontSize="9">
          goes {r3(depth - thickness)} mm into the spoilboard
        </text>
      )}
    </svg>
  )
}

// ───────────────────────────────────────── isolation passes around a pad

function roundedRectPath(cx: number, cy: number, half: number, r: number, clockwise: boolean): string {
  const a = half - r
  // start at top middle (SVG y down)
  if (clockwise)
    return `M${cx},${cy - half} L${cx + a},${cy - half} A${r},${r} 0 0 1 ${cx + half},${cy - a} L${cx + half},${cy + a} A${r},${r} 0 0 1 ${cx + a},${cy + half} L${cx - a},${cy + half} A${r},${r} 0 0 1 ${cx - half},${cy + a} L${cx - half},${cy - a} A${r},${r} 0 0 1 ${cx - a},${cy - half} Z`
  return `M${cx},${cy - half} L${cx - a},${cy - half} A${r},${r} 0 0 0 ${cx - half},${cy - a} L${cx - half},${cy + a} A${r},${r} 0 0 0 ${cx - a},${cy + half} L${cx + a},${cy + half} A${r},${r} 0 0 0 ${cx + half},${cy + a} L${cx + half},${cy - a} A${r},${r} 0 0 0 ${cx + a},${cy - half} Z`
}

export function IsolationDiagram({
  passes,
  overlap,
  cutWidth,
  extraClearance,
  direction
}: {
  passes: number
  overlap: number
  cutWidth: number
  extraClearance: number
  direction: CutDirection
}): React.JSX.Element {
  const n = Math.max(1, Math.min(10, Math.round(passes) || 1))
  const w = Math.max(0.02, cutWidth)
  const ov = Math.min(0.9, Math.max(0, overlap))
  const padHalf = 0.8
  const offsets = Array.from({ length: n }, (_, i) => Math.max(0, extraClearance) + w / 2 + i * w * (1 - ov))
  const outer = padHalf + offsets[n - 1] + w / 2
  const s = 58 / outer
  const cx = 110
  const cy = 72
  // Climb milling around an outside contour runs clockwise (spindle turning clockwise).
  const cw = direction === 'climb'
  const lastPath = roundedRectPath(
    cx,
    cy,
    (padHalf + offsets[n - 1]) * s,
    Math.max(1, (offsets[n - 1] + 0.1) * s),
    cw
  )
  return (
    <svg
      viewBox="0 0 220 144"
      className="mx-auto h-auto w-full max-w-[380px]"
      role="img"
      aria-label="Isolation passes around a pad"
    >
      <rect x="0" y="0" width="220" height="144" fill={COPPER_DARK} />
      {offsets
        .map((o, i) => (
          <path
            key={i}
            d={roundedRectPath(cx, cy, (padHalf + o) * s, Math.max(1, (o + 0.1) * s), true)}
            fill="none"
            stroke={CUT}
            strokeOpacity={0.7}
            strokeWidth={w * s}
          />
        ))
        .reverse()}
      {offsets.map((o, i) => (
        <path
          key={i}
          d={roundedRectPath(cx, cy, (padHalf + o) * s, Math.max(1, (o + 0.1) * s), true)}
          fill="none"
          stroke={ACCENT}
          strokeOpacity={0.55}
          strokeWidth="0.7"
          strokeDasharray="3 2"
        />
      ))}
      <rect
        x={cx - padHalf * s}
        y={cy - padHalf * s}
        width={2 * padHalf * s}
        height={2 * padHalf * s}
        rx={0.15 * s}
        fill={COPPER}
      />
      <text x={cx} y={cy + 3} textAnchor="middle" fontSize="9" fill="#3b2410" fontWeight="700">
        pad
      </text>
      <circle r={Math.max(2.5, (w * s) / 2)} fill="#e2e8f0" fillOpacity="0.85" stroke="#0ea5e9">
        <animateMotion dur="5s" repeatCount="indefinite" path={lastPath} />
      </circle>
      <text x="6" y="12" fontSize="9" fill="#e2e8f0">
        {n} pass{n > 1 ? 'es' : ''} · groove {r3(offsets[n - 1] + w / 2 - Math.max(0, extraClearance))} mm
        wide
      </text>
      <text x="6" y="138" fontSize="9" fill="#cbd5e1">
        Tool runs {cw ? 'clockwise' : 'counter-clockwise'} ({direction})
      </text>
    </svg>
  )
}

// ───────────────────────────────────────── climb vs conventional

export function DirectionAnimation({ direction }: { direction: CutDirection }): React.JSX.Element {
  const climb = direction === 'climb'
  // Tool moves left → right, spinning clockwise (seen from above). The finished edge is on the
  // right-hand side of travel for climb milling (lower half on screen), left-hand for conventional.
  const partY = climb ? 70 : 0
  return (
    <svg
      viewBox="0 0 240 110"
      className="mx-auto h-auto w-full max-w-[380px]"
      role="img"
      aria-label={`${direction} milling`}
    >
      <rect x="0" y="0" width="240" height="110" fill="#020617" />
      <rect x="0" y={partY} width="240" height="40" fill={COPPER} />
      <rect x="0" y="40" width="240" height="30" fill={CUT} />
      <text x="6" y={climb ? 104 : 12} fontSize="9" fill="#3b2410" fontWeight="700">
        the edge you keep (trace)
      </text>
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="-40 0; 200 0"
          dur="4s"
          repeatCount="indefinite"
        />
        <g transform="translate(20 55)">
          <circle r="15" fill="#cbd5e1" stroke="#64748b" />
          <g>
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0"
              to="360"
              dur="0.8s"
              repeatCount="indefinite"
            />
            {[0, 90, 180, 270].map((a) => (
              <path key={a} d="M0,-15 L5,-10 L0,-6 Z" fill="#475569" transform={`rotate(${a})`} />
            ))}
          </g>
          <path d="M-8,-21 A22,22 0 0 1 10,-19" stroke="#f8fafc" fill="none" strokeWidth="1.2" />
          <path d="M10,-19 l-4,-2 l1,4 z" fill="#f8fafc" />
        </g>
      </g>
      <path
        d={`M185,${climb ? 26 : 88} L220,${climb ? 26 : 88} m-5,-4 l5,4 l-5,4`}
        stroke={ACCENT}
        strokeWidth="1.6"
        fill="none"
      />
      <text x="150" y={climb ? 29 : 91} fontSize="9" fill={ACCENT}>
        travel
      </text>
      <text x="6" y={climb ? 12 : 104} fontSize="9" fill="#94a3b8">
        {climb
          ? 'Climb: teeth bite in thick and leave the edge smooth'
          : 'Conventional: teeth start thin and push into the edge'}
      </text>
    </svg>
  )
}

// ───────────────────────────────────────── cutout with tabs

export function CutoutDiagram({
  tabs,
  tabWidth,
  outside,
  toolDiameter
}: {
  tabs: number
  tabWidth: number
  outside: boolean
  toolDiameter: number
}): React.JSX.Element {
  const bx = 50
  const by = 30
  const bw = 140
  const bh = 80
  const off = Math.max(3, Math.min(9, toolDiameter * 3)) * (outside ? 1 : -1)
  const x0 = bx - off
  const y0 = by - off
  const w = bw + 2 * off
  const h = bh + 2 * off
  const per = 2 * (w + h)
  const path = `M${x0},${y0} L${x0 + w},${y0} L${x0 + w},${y0 + h} L${x0},${y0 + h} Z`
  const pointAt = (d: number): { x: number; y: number; horiz: boolean } => {
    let t = ((d % per) + per) % per
    if (t < w) return { x: x0 + t, y: y0, horiz: true }
    t -= w
    if (t < h) return { x: x0 + w, y: y0 + t, horiz: false }
    t -= h
    if (t < w) return { x: x0 + w - t, y: y0 + h, horiz: true }
    t -= w
    return { x: x0, y: y0 + h - t, horiz: false }
  }
  const n = Math.max(0, Math.min(20, Math.round(tabs) || 0))
  const tw = Math.max(4, Math.min(18, tabWidth * 3))
  const tabPts = Array.from({ length: n }, (_, i) => pointAt(w / 2 + (i * per) / n))
  const cutW = Math.max(3, Math.min(9, toolDiameter * 3)) * 1.1
  return (
    <svg
      viewBox="0 0 240 140"
      className="mx-auto h-auto w-full max-w-[380px]"
      role="img"
      aria-label="Cutout with tabs"
    >
      <rect x="0" y="0" width="240" height="140" fill={COPPER_DARK} />
      <rect x={bx} y={by} width={bw} height={bh} fill={FR4} stroke="#a3e635" strokeWidth="0.8" />
      <text x={bx + bw / 2} y={by + bh / 2 + 3} textAnchor="middle" fontSize="10" fill="#e2e8f0">
        your board
      </text>
      <path d={path} fill="none" stroke={CUT} strokeWidth={cutW} strokeLinejoin="round" />
      {tabPts.map((p, i) =>
        p.horiz ? (
          <rect key={i} x={p.x - tw / 2} y={p.y - cutW / 2} width={tw} height={cutW} fill="#fbbf24" />
        ) : (
          <rect key={i} x={p.x - cutW / 2} y={p.y - tw / 2} width={cutW} height={tw} fill="#fbbf24" />
        )
      )}
      <path d={path} fill="none" stroke={ACCENT} strokeWidth="0.7" strokeDasharray="3 2" />
      <circle r={cutW / 2} fill="#e2e8f0" stroke="#0ea5e9">
        <animateMotion dur="6s" repeatCount="indefinite" path={path} />
      </circle>
      <text x="6" y="12" fontSize="9" fill="#e2e8f0">
        Cut {outside ? 'outside' : 'inside'} the outline
      </text>
      <text x="6" y="134" fontSize="9" fill="#fbbf24">
        {n > 0 ? `${n} tab${n > 1 ? 's' : ''} hold the board in place` : 'No tabs — the board comes loose'}
      </text>
    </svg>
  )
}

// ───────────────────────────────────────── copper clearing

export function ClearDiagram({
  overlap,
  clearMargin,
  minIslandArea
}: {
  overlap: number
  clearMargin: number
  minIslandArea: number
}): React.JSX.Element {
  const ov = Math.min(0.9, Math.max(0, overlap))
  const passW = 7
  const sp = Math.max(1.5, passW * (1 - ov))
  const top = 34
  const bottom = 92
  const m = clearMargin > 0 ? Math.max(6, Math.min(24, clearMargin * 8)) : 0
  const bands: [number, number][] = m
    ? [
        [top, top + m],
        [bottom - m, bottom]
      ]
    : [[top, bottom]]
  const lines: number[] = []
  for (const [a, b] of bands) for (let y = a + passW / 2; y <= b - passW / 2 + 0.01; y += sp) lines.push(y)
  const zig = lines.map((y, i) => (i % 2 ? `L230,${y} L10,${y}` : `L10,${y} L230,${y}`)).join(' ')
  const motion = lines.length ? `M10,${lines[0]} ${zig}` : 'M10,60 L230,60'
  return (
    <svg
      viewBox="0 0 240 126"
      className="mx-auto h-auto w-full max-w-[380px]"
      role="img"
      aria-label="Copper clearing"
    >
      <rect x="0" y="0" width="240" height="126" fill={COPPER_DARK} />
      <rect x="0" y="20" width="240" height="14" fill={COPPER} />
      <rect x="0" y="92" width="240" height="14" fill={COPPER} />
      <text x="6" y="30" fontSize="8" fill="#3b2410" fontWeight="700">
        trace
      </text>
      <text x="6" y="102" fontSize="8" fill="#3b2410" fontWeight="700">
        trace
      </text>
      {lines.map((y, i) => (
        <line key={i} x1="10" x2="230" y1={y} y2={y} stroke={CUT} strokeOpacity="0.6" strokeWidth={passW} />
      ))}
      <rect x="150" y="59" width="5" height="5" fill={COPPER} />
      {minIslandArea > 0 && (
        <>
          <path d="M147,56 l11,11 M158,56 l-11,11" stroke="#fb7185" strokeWidth="1.2" />
          <text x="162" y="64" fontSize="8" fill="#fecdd3">
            tiny island: ignored
          </text>
        </>
      )}
      <circle r="3.5" fill="#e2e8f0" stroke="#0ea5e9">
        <animateMotion dur={`${Math.max(3, lines.length * 0.7)}s`} repeatCount="indefinite" path={motion} />
      </circle>
      <text x="6" y="12" fontSize="9" fill="#e2e8f0">
        {m ? `Clears a ${r3(clearMargin)} mm band along the traces` : 'Clears all copper between traces'}
      </text>
      <text x="6" y="120" fontSize="9" fill="#cbd5e1">
        {Math.round(ov * 100)}% overlap between passes
      </text>
    </svg>
  )
}

// ───────────────────────────────────────── drilling with pecks

export function PeckAnimation({
  peck,
  depth,
  thickness
}: {
  peck: number
  depth: number
  thickness: number
}): React.JSX.Element {
  const scale = 60 / Math.max(depth, thickness, 0.1)
  const n = peck > 0 ? Math.min(8, Math.ceil(depth / peck)) : 1
  const values: string[] = ['0 -14']
  for (let i = 1; i <= n; i++) {
    values.push(`0 ${(depth * i * scale) / n}`)
    if (i < n) values.push('0 -6')
  }
  values.push('0 -14')
  const boardTop = 30
  const finalY = boardTop + depth * scale
  return (
    <svg
      viewBox="0 0 220 110"
      className="mx-auto h-auto w-full max-w-[380px]"
      role="img"
      aria-label="Drilling"
    >
      <rect x="0" y="0" width="220" height="110" fill="#020617" />
      <rect x="0" y={boardTop + thickness * scale} width="220" height="110" fill={SPOIL} />
      <rect x="0" y={boardTop} width="220" height={thickness * scale} fill={FR4} />
      <rect x="0" y={boardTop} width="220" height="3" fill={COPPER} />
      <rect x="104" y={boardTop} width="12" height={depth * scale} fill={CUT} />
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values={values.join('; ')}
          dur={`${1.2 + n * 0.6}s`}
          repeatCount="indefinite"
        />
        <path
          d={`M110,${boardTop} l-6,-4 l0,-70 l12,0 l0,70 z`}
          fill="#cbd5e1"
          stroke="#64748b"
          strokeWidth="0.8"
        />
      </g>
      <line x1="125" y1={finalY} x2="150" y2={finalY} stroke={ACCENT} strokeDasharray="2 2" />
      <text x="152" y={finalY + 3} fontSize="9" fill={ACCENT}>
        {r3(depth)} mm
      </text>
      <text x="6" y="12" fontSize="9" fill="#e2e8f0">
        {peck > 0 ? `${n} pecks of ${r3(peck)} mm, lifting out between them` : 'One smooth plunge'}
      </text>
    </svg>
  )
}

// ───────────────────────────────────────── side (top / bottom)

export function SideIllustration({ side }: { side: 'top' | 'bottom' }): React.JSX.Element {
  const bottom = side === 'bottom'
  return (
    <svg
      viewBox="0 0 220 64"
      className="mx-auto h-auto w-full max-w-[380px]"
      role="img"
      aria-label={`${side} side`}
    >
      <rect x="0" y="0" width="220" height="64" fill="#020617" />
      <g transform={bottom ? 'translate(160 0) scale(-1 1)' : undefined}>
        <rect x="10" y="9" width="140" height="46" rx="3" fill={FR4} stroke={COPPER} />
        <text x="80" y="37" textAnchor="middle" fontSize="13" fill={COPPER} fontWeight="700">
          PCB TraceMill
        </text>
      </g>
      <text x="158" y="28" fontSize="9" fill="#e2e8f0" fontWeight="600">
        {bottom ? 'Bottom up' : 'Top up'}
      </text>
      <text x="158" y="41" fontSize="8" fill="#94a3b8">
        {bottom ? 'mirrored' : 'as designed'}
      </text>
    </svg>
  )
}
