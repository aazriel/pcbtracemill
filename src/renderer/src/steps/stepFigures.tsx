/**
 * Animated illustrations for step settings that the older diagrams in `illustrations.tsx` do not
 * cover, plus "how this step works" animations for hole milling, engraving and alignment pins.
 */
import type { ReactNode } from 'react'
import { Bit, BoardSide, Label, Scene, W } from '@renderer/components/illustrations/kit'

const r2 = (v: number): string => String(Math.round(v * 100) / 100)

/** Side view of a cut-out groove with one tab left standing; the bit lifts over the tab. */
export function TabHeightFigure({
  tabHeight,
  thickness
}: {
  tabHeight: number
  thickness: number
}): ReactNode {
  const th = Math.max(0.2, thickness)
  const frac = Math.max(0, Math.min(1, tabHeight / th))
  const top = 70
  const H = 50
  const tabTop = top + H * (1 - frac)
  const tabX = 140
  const tabW = 50
  return (
    <Scene
      caption={`The tab keeps ${r2(tabHeight)} mm of the ${r2(th)} mm board standing, so the board stays in the sheet until you snap it out.`}
    >
      <rect x={20} y={top} width={280} height={H} fill="#1e293b" />
      <rect x={tabX} y={tabTop} width={tabW} height={top + H - tabTop} fill="#3f5a2a" stroke="#facc15" />
      <rect x={20} y={top + H} width={280} height={14} fill="#6b4f35" />
      <Label x={24} y={top + H + 11} color="#d6c4a8" size={9}>
        spoilboard
      </Label>
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values={`30 ${top + H};${tabX - 8} ${top + H};${tabX - 8} ${tabTop};${tabX + tabW + 8} ${tabTop};${tabX + tabW + 8} ${top + H};290 ${top + H}`}
          dur="4s"
          repeatCount="indefinite"
        />
        <Bit r={7} len={30} />
      </g>
      <g stroke="#facc15" fill="#facc15">
        <line x1={tabX + tabW + 30} x2={tabX + tabW + 30} y1={tabTop} y2={top + H} />
        <Label x={tabX + tabW + 36} y={(tabTop + top + H) / 2 + 4} color="#fde047" size={11}>
          {r2(tabHeight)} mm
        </Label>
      </g>
    </Scene>
  )
}

/** A row of holes of growing size: only those between min and max are drilled / milled. */
export function HoleRangeFigure({
  min,
  max,
  mode
}: {
  min: number
  max: number
  mode: 'drill' | 'mill'
}): ReactNode {
  const sizes = [0.4, 0.6, 0.8, 1.0, 1.5, 2.0, 3.0]
  const s = 9
  return (
    <Scene
      caption={`Holes from ${r2(min)} to ${r2(max)} mm are ${mode === 'drill' ? 'drilled' : 'milled'} by this step (lit up); the others are left for another step.`}
    >
      <rect x={0} y={45} width={W} height={60} fill="#c47a3a" />
      {sizes.map((d, i) => {
        const x = 30 + i * 43
        const inRange = d >= min - 1e-6 && d <= max + 1e-6
        return (
          <g key={d}>
            <circle
              cx={x}
              cy={75}
              r={(d * s) / 2 + 2}
              fill={inRange ? '#0b1220' : 'none'}
              stroke={inRange ? '#38bdf8' : '#475569'}
              strokeDasharray={inRange ? undefined : '3 2'}
            >
              {inRange && (
                <animate
                  attributeName="opacity"
                  values="0;0;1;1"
                  keyTimes={`0;${(i / 8).toFixed(2)};${((i + 1) / 8).toFixed(2)};1`}
                  dur="3.5s"
                  repeatCount="indefinite"
                />
              )}
            </circle>
            <Label x={x} y={124} anchor="middle" color={inRange ? '#7dd3fc' : '#64748b'} size={10}>
              {d}
            </Label>
          </g>
        )
      })}
      <Label x={W - 10} y={140} anchor="end" color="#64748b" size={9}>
        hole Ø mm
      </Label>
    </Scene>
  )
}

/** The drill lifts to the retract height between holes. */
export function RetractFigure({ retract }: { retract: number }): ReactNode {
  const surface = 110
  const ry = surface - Math.max(10, Math.min(60, retract * 14))
  return (
    <Scene
      caption={`Between holes the drill lifts to ${r2(retract)} mm above the copper — just enough to clear the board.`}
    >
      <BoardSide y={surface} />
      <line x1={20} x2={300} y1={ry} y2={ry} stroke="#34d399" strokeDasharray="4 3" />
      <Label x={24} y={ry - 5} color="#6ee7b7" size={11}>
        retract {r2(retract)} mm
      </Label>
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values={`70 ${ry};70 ${surface + 20};70 ${ry};160 ${ry};160 ${surface + 20};160 ${ry};250 ${ry};250 ${surface + 20};250 ${ry}`}
          dur="4s"
          repeatCount="indefinite"
        />
        <Bit kind="drill" r={5} len={30} shank={7} />
      </g>
    </Scene>
  )
}

/** An oval slot drilled as a row of overlapping holes. */
export function SlotFigure({ on }: { on: boolean }): ReactNode {
  const xs = [100, 120, 140, 160, 180, 200, 220]
  return (
    <Scene
      caption={
        on
          ? 'Slots (oval holes) are drilled as a row of overlapping holes.'
          : 'Slots are skipped by this step (mill them with another step).'
      }
    >
      <rect x={0} y={40} width={W} height={70} fill="#c47a3a" />
      <rect
        x={88}
        y={63}
        width={144}
        height={24}
        rx={12}
        fill="none"
        stroke="#94a3b8"
        strokeDasharray="4 3"
      />
      {on &&
        xs.map((x, i) => (
          <circle key={x} cx={x} cy={75} r={12} fill="#0b1220" opacity={0}>
            <animate
              attributeName="opacity"
              values="0;0;1;1"
              keyTimes={`0;${(i / xs.length).toFixed(2)};${((i + 0.4) / xs.length).toFixed(2)};1`}
              dur="3.5s"
              repeatCount="indefinite"
            />
          </circle>
        ))}
    </Scene>
  )
}

/** Side view: spiralling down (helical) versus plunging straight in. */
export function HelixFigure({ helical }: { helical: boolean }): ReactNode {
  const surface = 70
  const pts: string[] = []
  for (let i = 0; i <= 60; i++) {
    const t = i / 60
    pts.push(`${160 + Math.sin(t * Math.PI * 6) * 40},${surface + t * 50}`)
  }
  const path = `M ${pts.join(' L ')}`
  return (
    <Scene
      caption={
        helical
          ? 'The bit spirals gently down into the hole — kinder to small cutters.'
          : 'The bit plunges straight down, then circles the hole.'
      }
    >
      <rect x={20} y={surface} width={280} height={56} fill="#3f5a2a" />
      <rect x={20} y={surface} width={280} height={3} fill="#d08a4a" />
      <rect x={110} y={surface} width={100} height={56} fill="#0b1220" />
      {helical && <path d={path} fill="none" stroke="#38bdf8" strokeDasharray="3 3" opacity={0.6} />}
      <g>
        {helical ? (
          <animateMotion dur="4s" repeatCount="indefinite" path={path} />
        ) : (
          <animateTransform
            attributeName="transform"
            type="translate"
            values={`160 ${surface};160 ${surface + 50};160 ${surface}`}
            dur="3s"
            repeatCount="indefinite"
          />
        )}
        <Bit r={8} len={30} />
      </g>
    </Scene>
  )
}

/** Top view of a hole being milled: the cutter circles inside it. */
export function HoleMillAnimation(): ReactNode {
  const cx = W / 2
  const cy = 75
  const R = 46
  const r = 14
  const path = `M ${cx + R - r} ${cy} A ${R - r} ${R - r} 0 1 1 ${cx + R - r - 0.01} ${cy}`
  return (
    <Scene caption="Seen from above: a hole bigger than any drill is milled by moving a smaller cutter around inside it.">
      <rect x={0} y={0} width={W} height={150} fill="#c47a3a" />
      <circle cx={cx} cy={cy} r={R} fill="#0b1220" opacity={0}>
        <animate
          attributeName="opacity"
          values="0;1;1"
          keyTimes="0;0.9;1"
          dur="4s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#94a3b8" strokeDasharray="4 3" />
      <circle r={r} fill="rgba(226,232,240,0.6)" stroke="#e2e8f0">
        <animateMotion dur="4s" repeatCount="indefinite" path={path} />
      </circle>
    </Scene>
  )
}

/** Top view: the bit follows the centre line of some text artwork. */
export function EngraveAnimation(): ReactNode {
  const path =
    'M 70 110 L 100 40 L 130 110 M 82 82 L 118 82 M 160 110 L 160 40 L 190 40 Q 210 40 210 58 Q 210 75 190 75 L 160 75 M 190 75 Q 215 75 215 93 Q 215 110 190 110 L 160 110'
  return (
    <Scene caption="The bit follows the centre of every line of the artwork (text, outlines, logos), scratching it lightly into the copper.">
      <rect x={0} y={0} width={W} height={150} fill="#c47a3a" />
      <path
        d={path}
        fill="none"
        stroke="#3f5a2a"
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="1 1"
      >
        <animate
          attributeName="stroke-dashoffset"
          values="1;0;0"
          keyTimes="0;0.85;1"
          dur="4s"
          repeatCount="indefinite"
        />
      </path>
      <circle r={5} fill="#e2e8f0">
        <animateMotion
          dur="4s"
          keyPoints="0;1;1"
          keyTimes="0;0.85;1"
          calcMode="linear"
          repeatCount="indefinite"
          path={path}
        />
      </circle>
    </Scene>
  )
}

/** Two pin holes drilled beside the board, then the board flips over them. */
export function PinsAnimation(): ReactNode {
  return (
    <Scene caption="Two holes are drilled outside the board and into the spoilboard. After flipping, pins in these holes put the board back exactly in place.">
      <rect x={20} y={20} width={280} height={110} fill="#c47a3a" opacity={0.35} />
      <g>
        <animateTransform
          attributeName="transform"
          type="matrix"
          values="1 0 0 1 0 0;1 0 0 1 0 0;1 0 0 -1 0 150;1 0 0 -1 0 150;1 0 0 1 0 0"
          keyTimes="0;0.45;0.6;0.9;1"
          dur="5s"
          repeatCount="indefinite"
        />
        <rect x={90} y={40} width={140} height={70} rx={4} fill="#c47a3a" stroke="#fde68a" />
        <rect x={110} y={60} width={40} height={10} fill="#3f5a2a" />
      </g>
      {[60, 260].map((x) => (
        <g key={x}>
          <circle cx={x} cy={75} r={8} fill="#0b1220" stroke="#e2e8f0" opacity={0}>
            <animate
              attributeName="opacity"
              values="0;1;1"
              keyTimes="0;0.3;1"
              dur="5s"
              repeatCount="indefinite"
            />
          </circle>
        </g>
      ))}
      <line x1={20} x2={300} y1={75} y2={75} stroke="#c4b5fd" strokeDasharray="4 3" />
      <Label x={W / 2} y={145} anchor="middle" color="#c4b5fd" size={10}>
        flip line
      </Label>
    </Scene>
  )
}
