/**
 * One animated illustration per tool setting, shown in the setting's (?) tooltip.
 * Name and notes have none.
 */
import type { ReactNode } from 'react'
import type { Tool } from '@core/model/types'
import { createTool, TOOL_TYPE_INFO, type ToolFieldKey } from '@core/tools'
import { Bit, BoardSide, Code, Label, Scene, W } from '@renderer/components/illustrations/kit'
import { cn } from '@renderer/lib/utils'
import { ToolPreview } from './ToolPreview'
import { CutDepthDiagram, StepoverDiagram } from './ToolDiagrams'
import { cutWidthAt, fmtMm, TOOL_TYPES } from './toolMeta'

const bitKind = (t: Tool): 'flat' | 'vbit' | 'ball' | 'drill' =>
  t.type === 'vbit' ? 'vbit' : t.type === 'ball' ? 'ball' : t.type === 'drill' ? 'drill' : 'flat'

const box = (node: ReactNode): ReactNode => (
  <div className="overflow-hidden rounded-md bg-slate-950/70">{node}</div>
)

/** Top view: the cutter travels along and leaves a groove as wide as it cuts. */
function grooveTopView(t: Tool, depth: number): ReactNode {
  const w = cutWidthAt(t, depth)
  const px = 46
  return (
    <Scene
      caption={
        t.type === 'drill'
          ? `Makes round holes ${fmtMm(w)} mm wide.`
          : `Seen from above: the groove it leaves is ${fmtMm(w)} mm wide${t.type === 'vbit' || t.type === 'ball' ? ` at ${fmtMm(depth)} mm deep` : ''}.`
      }
    >
      <rect x={0} y={40} width={W} height={70} fill="#c47a3a" />
      {t.type === 'drill' ? (
        [80, 160, 240].map((x, i) => (
          <circle key={x} cx={x} cy={75} r={px / 2} fill="#3f5a2a" opacity={0}>
            <animate
              attributeName="opacity"
              values="0;0;1;1"
              keyTimes={`0;${(i / 3).toFixed(2)};${((i + 0.3) / 3).toFixed(2)};1`}
              dur="3s"
              repeatCount="indefinite"
            />
          </circle>
        ))
      ) : (
        <>
          <rect x={30} y={75 - px / 2} height={px} fill="#3f5a2a">
            <animate
              attributeName="width"
              values="0;260;260"
              keyTimes="0;0.8;1"
              dur="3s"
              repeatCount="indefinite"
            />
          </rect>
          <circle cy={75} r={px / 2} fill="none" stroke="#e2e8f0" strokeWidth={1.5}>
            <animate
              attributeName="cx"
              values="30;290;290"
              keyTimes="0;0.8;1"
              dur="3s"
              repeatCount="indefinite"
            />
          </circle>
        </>
      )}
      <g stroke="#38bdf8" fill="#38bdf8">
        <line x1={300} x2={300} y1={75 - px / 2} y2={75 + px / 2} />
        <Label x={296} y={30} anchor="end" color="#7dd3fc" size={11}>
          {fmtMm(w)} mm
        </Label>
      </g>
    </Scene>
  )
}

function fluteLength(t: Tool): ReactNode {
  return (
    <Scene
      caption={`The cutting part is ${fmtMm(t.geometry.fluteLength)} mm long: it can cut at most this deep.`}
    >
      <BoardSide y={100} thick={40} />
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="160 60;160 134;160 134;160 60"
          keyTimes="0;0.5;0.7;1"
          dur="3s"
          repeatCount="indefinite"
        />
        <Bit kind={bitKind(t)} r={8} len={40} />
        <rect x={-10} y={-40} width={20} height={40} fill="none" stroke="#a78bfa" strokeDasharray="3 2" />
      </g>
      <Label x={14} y={22} color="#c4b5fd" size={11}>
        cutting length {fmtMm(t.geometry.fluteLength)} mm
      </Label>
    </Scene>
  )
}

function flutes(t: Tool): ReactNode {
  const n = Math.max(1, Math.min(8, Math.round(t.geometry.flutes) || 1))
  const R = 46
  const cx = W / 2
  const cy = 75
  return (
    <Scene
      caption={`Seen from the tip: ${n} cutting edge${n === 1 ? '' : 's'}. More edges = more bites per turn (smoother, but clogs easier).`}
    >
      <g>
        <animateTransform
          attributeName="transform"
          type="rotate"
          values={`0 ${cx} ${cy};360 ${cx} ${cy}`}
          dur="2.4s"
          repeatCount="indefinite"
        />
        <circle cx={cx} cy={cy} r={R} fill="#cbd5e1" stroke="#1e293b" />
        {Array.from({ length: n }).map((_, i) => {
          const a = (i / n) * Math.PI * 2
          const x = cx + Math.cos(a) * R * 0.55
          const y = cy + Math.sin(a) * R * 0.55
          return <circle key={i} cx={x} cy={y} r={R * 0.32} fill="#0b1220" />
        })}
        {Array.from({ length: n }).map((_, i) => {
          const a = (i / n) * Math.PI * 2 + 0.5
          return (
            <line
              key={`e${i}`}
              x1={cx}
              y1={cy}
              x2={cx + Math.cos(a) * R}
              y2={cy + Math.sin(a) * R}
              stroke="#fbbf24"
              strokeWidth={2}
            />
          )
        })}
      </g>
      <Label x={14} y={22} color="#fcd34d" size={11}>
        {n} flute{n === 1 ? '' : 's'}
      </Label>
    </Scene>
  )
}

function rpm(t: Tool): ReactNode {
  return (
    <div className="flex items-center gap-3 rounded-md bg-slate-950/70 p-2">
      <ToolPreview tool={t} width={90} height={150} compact />
      <span className="text-[11px] text-slate-400">
        Spins at {Math.round(t.feeds.spindleRpm).toLocaleString('en-US')} RPM — the drawing turns faster or
        slower as you change it (slowed down so you can see it).
      </span>
    </div>
  )
}

function feedXY(t: Tool): ReactNode {
  const dur = Math.max(0.8, Math.min(6, 1200 / Math.max(10, t.feeds.feedXY)))
  return (
    <Scene caption={`Moves sideways through the material at ${t.feeds.feedXY} mm/min while cutting.`}>
      <BoardSide y={100} thick={30} />
      <rect x={40} y={100} height={8} fill="#0b1220">
        <animate
          attributeName="width"
          values="0;240;240"
          keyTimes="0;0.85;1"
          dur={`${dur * 2}s`}
          repeatCount="indefinite"
        />
      </rect>
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="40 108;280 108;280 108"
          keyTimes="0;0.85;1"
          dur={`${dur * 2}s`}
          repeatCount="indefinite"
        />
        <Bit kind={bitKind(t)} />
      </g>
      <Label x={W - 12} y={22} anchor="end" color="#7dd3fc" size={12}>
        {t.feeds.feedXY} mm/min →
      </Label>
    </Scene>
  )
}

function feedZ(t: Tool): ReactNode {
  const dur = Math.max(0.8, Math.min(6, 400 / Math.max(5, t.feeds.feedZ)))
  return (
    <Scene caption={`Goes down into the material (plunges) at ${t.feeds.feedZ} mm/min.`}>
      <BoardSide y={100} thick={30} />
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="160 60;160 126;160 126;160 60"
          keyTimes="0;0.55;0.7;1"
          dur={`${dur * 2}s`}
          repeatCount="indefinite"
        />
        <Bit kind={bitKind(t)} />
      </g>
      <Label x={W - 12} y={22} anchor="end" color="#c4b5fd" size={12}>
        ↓ {t.feeds.feedZ} mm/min
      </Label>
    </Scene>
  )
}

function stepDown(t: Tool): ReactNode {
  const drill = t.type === 'drill'
  const levels = [118, 126, 134]
  return (
    <Scene
      caption={
        drill
          ? `Pecking: the drill goes ${fmtMm(t.feeds.stepDown)} mm deeper each time, then pulls out to clear the chips.`
          : `Deep cuts are split into passes of at most ${fmtMm(t.feeds.stepDown)} mm.`
      }
    >
      <BoardSide y={110} thick={30} />
      {levels.map((y) => (
        <line key={y} x1={40} x2={280} y1={y} y2={y} stroke="#a78bfa" strokeDasharray="3 3" opacity={0.6} />
      ))}
      {drill ? (
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values="160 80;160 118;160 80;160 126;160 80;160 134;160 80"
            dur="4s"
            repeatCount="indefinite"
          />
          <Bit kind="drill" />
        </g>
      ) : (
        <>
          <rect x={60} y={110} width={200} fill="#0b1220">
            <animate
              attributeName="height"
              values="0;8;8;16;16;24;24"
              keyTimes="0;0.15;0.33;0.48;0.66;0.81;1"
              dur="4.5s"
              repeatCount="indefinite"
            />
          </rect>
          <g>
            <animateTransform
              attributeName="transform"
              type="translate"
              values="60 118;260 118;60 126;260 126;60 134;260 134"
              keyTimes="0;0.3;0.33;0.63;0.66;1"
              dur="4.5s"
              repeatCount="indefinite"
            />
            <Bit kind={bitKind(t)} />
          </g>
        </>
      )}
      <Label x={14} y={22} color="#c4b5fd" size={11}>
        {fmtMm(t.feeds.stepDown)} mm per {drill ? 'peck' : 'pass'}
      </Label>
    </Scene>
  )
}

function number(t: Tool): ReactNode {
  return (
    <Scene caption={`The machine knows this bit as tool ${t.number} (T${t.number}).`} height={110}>
      <Code lines={[`T${t.number} M6`, `(Tool change: ${t.name || 'this tool'})`]} hl={[0]} />
      {Array.from({ length: 6 }).map((_, i) => {
        const n = Math.max(1, t.number) + i - 2
        return (
          <g key={i}>
            <rect
              x={30 + i * 45}
              y={60}
              width={36}
              height={36}
              rx={6}
              fill={i === 2 ? '#0ea5e9' : '#1e293b'}
              opacity={i === 2 ? 0.35 : 1}
            />
            <Label x={48 + i * 45} y={83} anchor="middle" color={i === 2 ? '#e0f2fe' : '#64748b'} size={12}>
              {n > 0 ? `T${n}` : ''}
            </Label>
          </g>
        )
      })}
    </Scene>
  )
}

function kinds(t: Tool): ReactNode {
  return (
    <div className="flex items-end justify-between gap-1 rounded-md bg-slate-950/70 p-2">
      {TOOL_TYPES.map((k) => (
        <div
          key={k}
          className={cn(
            'flex flex-col items-center gap-1 rounded px-1 pb-1 text-[10px]',
            k === t.type ? 'bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/50' : 'text-slate-500'
          )}
        >
          <ToolPreview tool={createTool(k)} width={36} height={72} compact spinning={k === t.type} />
          {TOOL_TYPE_INFO[k].label.split(' ')[0]}
        </div>
      ))}
    </div>
  )
}

/** Typical cut depth used by the illustrations. */
export function figureDepth(t: Tool, preview = 0.1): number {
  if (t.type === 'vbit' || t.type === 'ball') return preview
  return t.type === 'drill' ? 1.7 : Math.max(0.1, Math.min(t.geometry.fluteLength, 0.4))
}

export function toolFigure(key: ToolFieldKey, t: Tool, depth = 0.1): ReactNode | null {
  const d = figureDepth(t, depth)
  switch (key) {
    case 'type':
      return kinds(t)
    case 'number':
      return number(t)
    case 'geometry.diameter':
      return grooveTopView(t, d)
    case 'geometry.tipAngle':
    case 'geometry.tipDiameter':
    case 'geometry.pointAngle':
      return box(<CutDepthDiagram tool={t} depth={d} width={340} height={150} animate />)
    case 'geometry.fluteLength':
      return fluteLength(t)
    case 'geometry.flutes':
      return flutes(t)
    case 'feeds.spindleRpm':
      return rpm(t)
    case 'feeds.feedXY':
      return feedXY(t)
    case 'feeds.feedZ':
      return feedZ(t)
    case 'feeds.stepDown':
      return stepDown(t)
    case 'feeds.stepOver':
      return box(<StepoverDiagram stepOver={t.feeds.stepOver} width={340} height={124} />)
    default:
      return null
  }
}
