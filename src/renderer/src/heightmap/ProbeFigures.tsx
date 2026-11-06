/**
 * Animated figures for the probe grid settings (shown in the (?) of each field, like the step
 * editor): what the probe speed, the maximum depth, the lift, the point distance and the area mean.
 * Side views use the shared kit (copper on top, fibreglass below); everything is SVG + SMIL.
 */
import type { ReactNode } from 'react'
import { BoardSide, Bit, Label, Scene, W } from '@renderer/components/illustrations/kit'

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
const r1 = (v: number): string => String(Math.round(v * 10) / 10)
const kt = (v: number[]): string => v.map((x) => clamp(x, 0, 1).toFixed(3)).join(';')
const COPPER_Y = 104
const TOUCH = '#22c55e'
const STOP = '#f43f5e'
const AREA = '#38bdf8'

/** The bit goes down at the probe speed until it touches the copper, then lifts quickly. */
export function ProbeSpeedFigure({ feed }: { feed: number }): ReactNode {
  // a slower feed takes longer in the animation (clamped so it stays watchable)
  const down = clamp(120 / Math.max(feed, 1), 0.8, 5)
  const dur = down + 1.6
  const t1 = down / dur
  const top = COPPER_Y - 34
  return (
    <Scene
      caption={`The bit creeps down at ${r1(feed)} mm/min until it touches the copper, then lifts fast. Slow = it stops right at the surface; fast = it overshoots and reads a little too deep.`}
    >
      <BoardSide y={COPPER_Y} />
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values={`160 ${top};160 ${COPPER_Y};160 ${COPPER_Y};160 ${top};160 ${top}`}
          keyTimes={kt([0, t1, t1 + 0.12, t1 + 0.3, 1])}
          dur={`${dur}s`}
          repeatCount="indefinite"
        />
        <Bit kind="vbit" r={6} len={30} />
      </g>
      <circle cx={160} cy={COPPER_Y} r={9} fill="none" stroke={TOUCH} strokeWidth={2} opacity={0}>
        <animate
          attributeName="opacity"
          values="0;0;1;0;0"
          keyTimes={kt([0, t1 - 0.01, t1 + 0.04, t1 + 0.2, 1])}
          dur={`${dur}s`}
          repeatCount="indefinite"
        />
      </circle>
      <path d={`M 200 ${top - 10} L 200 ${COPPER_Y - 8}`} stroke="#64748b" strokeWidth={1.5} />
      <path
        d={`M 195 ${COPPER_Y - 15} L 200 ${COPPER_Y - 6} L 205 ${COPPER_Y - 15}`}
        fill="none"
        stroke="#64748b"
        strokeWidth={1.5}
      />
      <Label x={210} y={top + 6} color="#cbd5e1" size={11}>
        {r1(feed)} mm/min
      </Label>
      <Label x={210} y={top + 20} size={9.5}>
        {feed <= 100 ? 'accurate' : feed <= 200 ? 'a bit fast' : 'too fast: less accurate'}
      </Label>
      <Label x={176} y={COPPER_Y - 4} color={TOUCH} size={9.5}>
        touch
      </Label>
    </Scene>
  )
}

/**
 * Maximum depth: normally the bit touches the copper at once. If the probe wire is loose it never
 * "feels" the copper and keeps going down; at the maximum depth the controller stops with an error.
 */
export function ProbeDepthFigure({ depth }: { depth: number }): ReactNode {
  const pxPerMm = 9
  const d = Math.abs(depth)
  const limitY = COPPER_Y + clamp(d * pxPerMm, 6, 36)
  const top = COPPER_Y - 30
  const dur = 6
  return (
    <Scene
      height={160}
      caption={`If the wire is loose the bit never "feels" the copper. It keeps going down, but never further than ${r1(d)} mm below zero: there the controller stops with an alarm. Small = less damage when that happens.`}
    >
      <BoardSide y={COPPER_Y} thick={34} />
      <line
        x1={20}
        x2={W - 20}
        y1={COPPER_Y}
        y2={COPPER_Y}
        stroke="#e2e8f0"
        strokeDasharray="4 3"
        strokeWidth={0.8}
      />
      <Label x={W - 22} y={COPPER_Y - 4} anchor="end" color="#e2e8f0" size={9.5}>
        Z0 (copper)
      </Label>
      <line
        x1={20}
        x2={W - 20}
        y1={limitY}
        y2={limitY}
        stroke={STOP}
        strokeDasharray="5 3"
        strokeWidth={1.2}
      />
      <Label x={W - 22} y={limitY + 12} anchor="end" color={STOP} size={9.5}>
        max depth −{r1(d)} mm
      </Label>
      {/* left: wired probe touches and stops */}
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values={`90 ${top};90 ${COPPER_Y};90 ${COPPER_Y};90 ${top};90 ${top}`}
          keyTimes={kt([0, 0.3, 0.45, 0.6, 1])}
          dur={`${dur}s`}
          repeatCount="indefinite"
        />
        <Bit kind="vbit" r={6} len={28} />
      </g>
      <Label x={90} y={20} anchor="middle" color={TOUCH} size={10}>
        wire OK: stops at the copper
      </Label>
      {/* right: loose wire, goes on to the limit */}
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values={`230 ${top};230 ${limitY};230 ${limitY};230 ${top};230 ${top}`}
          keyTimes={kt([0, 0.55, 0.8, 0.95, 1])}
          dur={`${dur}s`}
          repeatCount="indefinite"
        />
        <Bit kind="vbit" r={6} len={28} />
      </g>
      <Label x={230} y={20} anchor="middle" color={STOP} size={10}>
        wire loose: down to the limit
      </Label>
      <g opacity={0}>
        <animate
          attributeName="opacity"
          values="0;0;1;1;0"
          keyTimes={kt([0, 0.54, 0.57, 0.8, 0.85])}
          dur={`${dur}s`}
          repeatCount="indefinite"
        />
        <rect x={250} y={limitY - 24} width={46} height={15} rx={3} fill={STOP} />
        <Label x={273} y={limitY - 13} anchor="middle" color="#fff" size={9}>
          ALARM
        </Label>
      </g>
    </Scene>
  )
}

/** Lift: after each touch the bit rises this high above the copper, moves over, and goes down again. */
export function ProbeLiftFigure({ lift }: { lift: number }): ReactNode {
  const liftPx = clamp(lift * 9, 8, 60)
  const tipTop = COPPER_Y - liftPx
  const xa = 80
  const xb = 240
  const dur = 4.5
  return (
    <Scene
      caption={`After every touch the bit rises ${r1(lift)} mm above the copper before it moves to the next point. High enough to clear clamps and bumps; more is only slower.`}
    >
      <BoardSide y={COPPER_Y} />
      <line
        x1={xa - 20}
        x2={xb + 20}
        y1={tipTop}
        y2={tipTop}
        stroke={AREA}
        strokeDasharray="4 3"
        strokeWidth={1}
      />
      <line x1={xb + 30} x2={xb + 30} y1={tipTop} y2={COPPER_Y} stroke="#cbd5e1" strokeWidth={1} />
      <path
        d={`M ${xb + 26} ${tipTop + 5} L ${xb + 30} ${tipTop} L ${xb + 34} ${tipTop + 5} M ${xb + 26} ${COPPER_Y - 5} L ${xb + 30} ${COPPER_Y} L ${xb + 34} ${COPPER_Y - 5}`}
        fill="none"
        stroke="#cbd5e1"
        strokeWidth={1}
      />
      <Label x={xb + 36} y={(tipTop + COPPER_Y) / 2 + 4} color="#cbd5e1" size={10}>
        {r1(lift)} mm
      </Label>
      <circle cx={xa} cy={COPPER_Y} r={3} fill={TOUCH} />
      <circle cx={xb} cy={COPPER_Y} r={3} fill="#94a3b8" />
      <path
        d={`M ${xa} ${COPPER_Y} L ${xa} ${tipTop} L ${xb} ${tipTop} L ${xb} ${COPPER_Y}`}
        fill="none"
        stroke="#64748b"
        strokeDasharray="2 3"
      />
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values={`${xa} ${COPPER_Y};${xa} ${tipTop};${xb} ${tipTop};${xb} ${COPPER_Y};${xb} ${COPPER_Y}`}
          keyTimes={kt([0, 0.2, 0.55, 0.85, 1])}
          dur={`${dur}s`}
          repeatCount="indefinite"
        />
        <Bit kind="vbit" r={6} len={28} />
      </g>
    </Scene>
  )
}

/** Distance between points: a top view of the grid, the bit visiting the points row by row. */
export function ProbeSpacingFigure({ spacing }: { spacing: number }): ReactNode {
  const cols = clamp(Math.round(60 / Math.max(spacing, 1)) + 1, 3, 9)
  const rows = clamp(Math.round(cols * 0.55), 2, 5)
  const x0 = 50
  const x1 = 270
  const y0 = 22
  const y1 = 112
  const dx = (x1 - x0) / (cols - 1)
  const dy = (y1 - y0) / (rows - 1)
  const pts: { x: number; y: number }[] = []
  for (let j = 0; j < rows; j++)
    for (let k = 0; k < cols; k++) {
      const i = j % 2 ? cols - 1 - k : k
      pts.push({ x: x0 + i * dx, y: y1 - j * dy })
    }
  const dur = pts.length * 0.35
  return (
    <Scene
      caption={`One measurement every ${r1(spacing)} mm, row by row. Between the points the height is blended, so ~10 mm is enough for a board that bends gently; smaller only adds time.`}
    >
      <rect
        x={x0 - 12}
        y={y0 - 12}
        width={x1 - x0 + 24}
        height={y1 - y0 + 24}
        fill="#d08a4a"
        opacity={0.18}
        stroke={AREA}
        strokeDasharray="5 3"
      />
      <polyline
        points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={AREA}
        strokeOpacity={0.35}
      />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3.2} fill={i === 0 ? '#fb7185' : '#e2e8f0'} />
      ))}
      <circle r={7} fill="none" stroke="#facc15" strokeWidth={2}>
        <animateMotion
          path={`M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')}`}
          dur={`${dur}s`}
          repeatCount="indefinite"
          calcMode="linear"
        />
      </circle>
      <line x1={x0} x2={x0 + dx} y1={y1 + 20} y2={y1 + 20} stroke="#cbd5e1" />
      <line x1={x0} x2={x0} y1={y1 + 15} y2={y1 + 25} stroke="#cbd5e1" />
      <line x1={x0 + dx} x2={x0 + dx} y1={y1 + 15} y2={y1 + 25} stroke="#cbd5e1" />
      <Label x={x0 + dx + 6} y={y1 + 24} color="#cbd5e1" size={10}>
        {r1(spacing)} mm
      </Label>
    </Scene>
  )
}

/**
 * The probe area is a rectangle measured from X0 Y0 (where you zero the machine): its left and right
 * edges are X values, its front and back edges are Y values.
 */
export function ProbeAreaFigure(): ReactNode {
  const ox = 40
  const oy = 130
  const a = { x0: 100, x1: 225, y0: 100, y1: 30 }
  return (
    <Scene caption="All four numbers are distances from X0 Y0, the corner where you zero the machine (the same zero you use for milling). Left / right edges are X, front / back edges are Y.">
      <rect
        x={ox + 10}
        y={18}
        width={250}
        height={oy - 26}
        fill="#d08a4a"
        opacity={0.14}
        stroke="#d99554"
        strokeDasharray="4 3"
      />
      <rect
        x={a.x0}
        y={a.y1}
        width={a.x1 - a.x0}
        height={a.y0 - a.y1}
        fill={AREA}
        fillOpacity={0.1}
        stroke={AREA}
        strokeWidth={1.5}
        strokeDasharray="5 3"
      >
        <animate attributeName="stroke-opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
      </rect>
      {/* axes */}
      <line x1={ox} y1={oy} x2={ox + 32} y2={oy} stroke="#f43f5e" strokeWidth={2} />
      <line x1={ox} y1={oy} x2={ox} y2={oy - 32} stroke="#22c55e" strokeWidth={2} />
      <circle cx={ox} cy={oy} r={3.5} fill="#fff" />
      <Label x={ox - 4} y={oy + 14} anchor="middle" color="#e2e8f0" size={9.5}>
        X0 Y0
      </Label>
      {/* X edges */}
      <line x1={ox} x2={a.x0} y1={oy + 8} y2={oy + 8} stroke={AREA} strokeWidth={1} />
      <Label x={(ox + a.x0) / 2} y={oy + 18} anchor="middle" color={AREA} size={9}>
        Left edge
      </Label>
      <line x1={ox} x2={a.x1} y1={12} y2={12} stroke={AREA} strokeWidth={1} opacity={0.6} />
      <Label x={a.x1 - 4} y={10} anchor="end" color={AREA} size={9}>
        Right edge
      </Label>
      {/* Y edges */}
      <line x1={a.x1 + 14} x2={a.x1 + 14} y1={oy} y2={a.y0} stroke={AREA} strokeWidth={1} />
      <Label x={a.x1 + 18} y={(oy + a.y0) / 2 + 3} color={AREA} size={9}>
        Front edge
      </Label>
      <line x1={a.x1 + 30} x2={a.x1 + 30} y1={oy} y2={a.y1} stroke={AREA} strokeWidth={1} opacity={0.6} />
      <Label x={a.x1 + 34} y={a.y1 + 8} color={AREA} size={9}>
        Back edge
      </Label>
    </Scene>
  )
}

/** Tiny picture for each "Area to measure" choice: which points get measured. */
export function AreaChoiceArt({ kind }: { kind: 'board' | 'stock' | 'custom' }): ReactNode {
  const dots: ReactNode[] = []
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 6; i++) {
      const x = 12 + i * 8
      const y = 9 + j * 8
      const inBoard = Math.hypot(x - 32, y - 21) <= 16
      const inCustom = x >= 20 && x <= 44 && y >= 9 && y <= 25
      const on = kind === 'stock' || (kind === 'board' ? inBoard : inCustom)
      dots.push(
        <circle key={`${i}-${j}`} cx={x} cy={y} r={on ? 1.5 : 0.9} fill={on ? '#e2e8f0' : '#475569'} />
      )
    }
  return (
    <svg viewBox="0 0 64 42" className="h-9 w-14" aria-hidden>
      <rect
        x={3}
        y={2}
        width={58}
        height={38}
        rx={2}
        fill="#d08a4a"
        opacity={0.18}
        stroke="#d99554"
        strokeDasharray="2 1.5"
        strokeWidth={0.6}
      />
      <circle cx={32} cy={21} r={15} fill="none" stroke="#34d399" strokeWidth={0.9} />
      {kind === 'custom' && (
        <rect
          x={17}
          y={6}
          width={30}
          height={22}
          fill="rgba(56,189,248,0.12)"
          stroke={AREA}
          strokeDasharray="2 1.5"
          strokeWidth={0.8}
        >
          <animate
            attributeName="width"
            values="0;30;30"
            keyTimes="0;0.6;1"
            dur="2.4s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="height"
            values="0;22;22"
            keyTimes="0;0.6;1"
            dur="2.4s"
            repeatCount="indefinite"
          />
        </rect>
      )}
      {dots}
    </svg>
  )
}

/** The mouse pointer of the hints (tip at 0,0). */
function Pointer(): ReactNode {
  return (
    <path d="M0 0 L0 22 L6 16 L10 26 L14 24 L10 14 L18 14 Z" fill="#fff" stroke="#0f172a" strokeWidth={1.5} />
  )
}

const HINT_TEXT: Record<'rect' | 'circle' | 'polygon', string> = {
  rect: 'Drag on the picture to draw a rectangle',
  circle: 'Drag from the centre outwards to draw a circle',
  polygon: 'Click the corners; click the first point (or double-click) to finish'
}

/**
 * Shown over the probe preview in "Custom" until the user drew an area once, so it is obvious the
 * picture can be drawn on: a pointer drags a rectangle open, drags a circle out from its centre, or
 * clicks the corners of a polygon, depending on the chosen shape.
 */
export function DrawAreaHint({ tool = 'rect' }: { tool?: 'rect' | 'circle' | 'polygon' }): ReactNode {
  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col items-center"
      data-testid="probe-draw-hint"
    >
      <div className="z-[1] mt-3 rounded-full bg-sky-500/90 px-3 py-1 text-xs font-semibold text-white shadow-lg">
        {HINT_TEXT[tool]}
      </div>
      <svg
        viewBox="0 0 400 300"
        className="absolute inset-0 size-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        {tool === 'rect' && <RectHint />}
        {tool === 'circle' && <CircleHint />}
        {tool === 'polygon' && <PolygonHint />}
      </svg>
    </div>
  )
}

const HINT_STROKE = {
  fill: 'rgba(56,189,248,0.15)',
  stroke: '#7dd3fc',
  strokeWidth: 2,
  strokeDasharray: '6 4'
}

function RectHint(): ReactNode {
  const dur = '2.6s'
  const k = '0;0.15;0.7;1'
  return (
    <>
      <rect x={130} y={95} width={0} height={0} {...HINT_STROKE}>
        <animate attributeName="width" values="0;0;140;140" keyTimes={k} dur={dur} repeatCount="indefinite" />
        <animate
          attributeName="height"
          values="0;0;110;110"
          keyTimes={k}
          dur={dur}
          repeatCount="indefinite"
        />
      </rect>
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="130 95;130 95;270 205;270 205"
          keyTimes={k}
          dur={dur}
          repeatCount="indefinite"
        />
        <Pointer />
      </g>
    </>
  )
}

function CircleHint(): ReactNode {
  const dur = '2.6s'
  const k = '0;0.15;0.7;1'
  return (
    <>
      <circle cx={200} cy={150} r={0} {...HINT_STROKE}>
        <animate attributeName="r" values="0;0;85;85" keyTimes={k} dur={dur} repeatCount="indefinite" />
      </circle>
      <circle cx={200} cy={150} r={3} fill="#facc15" />
      <line x1={200} y1={150} x2={200} y2={150} stroke="#facc15" strokeDasharray="3 3">
        <animate
          attributeName="x2"
          values="200;200;285;285"
          keyTimes={k}
          dur={dur}
          repeatCount="indefinite"
        />
      </line>
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="200 150;200 150;285 150;285 150"
          keyTimes={k}
          dur={dur}
          repeatCount="indefinite"
        />
        <Pointer />
      </g>
    </>
  )
}

function PolygonHint(): ReactNode {
  const P = [
    [150, 90],
    [270, 105],
    [285, 205],
    [170, 215],
    [150, 90]
  ]
  const dur = 4
  // pointer reaches corner i at time t[i]; each corner appears when it is clicked
  const t = [0.05, 0.25, 0.45, 0.65, 0.85]
  const keyTimes = ['0', ...t.map(String), '1'].join(';')
  const pos = [P[0], ...P, P[4]].map(([x, y]) => `${x} ${y}`).join(';')
  return (
    <>
      {P.slice(0, 4).map(([x, y], i) => {
        const [nx, ny] = P[i + 1]
        return (
          <line key={i} x1={x} y1={y} x2={nx} y2={ny} stroke="#7dd3fc" strokeWidth={2} opacity={0}>
            <animate
              attributeName="opacity"
              values="0;0;1;1;0"
              keyTimes={`0;${t[i + 1]};${t[i + 1] + 0.01};0.97;1`}
              dur={`${dur}s`}
              repeatCount="indefinite"
            />
          </line>
        )
      })}
      <polygon
        points={P.slice(0, 4)
          .map(([x, y]) => `${x},${y}`)
          .join(' ')}
        fill="rgba(56,189,248,0.15)"
        opacity={0}
      >
        <animate
          attributeName="opacity"
          values="0;0;1;0"
          keyTimes="0;0.85;0.9;1"
          dur={`${dur}s`}
          repeatCount="indefinite"
        />
      </polygon>
      {P.slice(0, 4).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 0 ? 6 : 4} fill={i === 0 ? '#facc15' : '#7dd3fc'} opacity={0}>
          <animate
            attributeName="opacity"
            values="0;0;1;1;0"
            keyTimes={`0;${t[i]};${t[i] + 0.01};0.97;1`}
            dur={`${dur}s`}
            repeatCount="indefinite"
          />
        </circle>
      ))}
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values={pos}
          keyTimes={keyTimes}
          dur={`${dur}s`}
          repeatCount="indefinite"
        />
        <Pointer />
      </g>
    </>
  )
}
