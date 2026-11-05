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
import { BitDimensionFigure } from './BitDimensions'
import { fmtMm, TOOL_TYPES } from './toolMeta'

const bitKind = (t: Tool): 'flat' | 'vbit' | 'ball' | 'drill' =>
  t.type === 'vbit' ? 'vbit' : t.type === 'ball' ? 'ball' : t.type === 'drill' ? 'drill' : 'flat'

/**
 * Flutes: the bit from the side (spiral grooves turning) and from the tip, where every flute's
 * cutting edge is drawn in yellow and numbered, so the count is easy to see.
 */
function flutes(t: Tool): ReactNode {
  const n = Math.max(1, Math.min(8, Math.round(t.geometry.flutes) || 1))
  // side view
  const sx = 46
  const sw = 44
  const top = 22
  const len = 104
  const pitch = 64
  const gapY = pitch / n
  const bands: ReactNode[] = []
  for (let k = -n - 2; k <= Math.ceil(len / gapY) + n + 2; k++) {
    const y = top + k * gapY
    bands.push(
      <path
        key={k}
        d={`M ${sx} ${y + 22} L ${sx + sw} ${y} L ${sx + sw} ${y + gapY * 0.45} L ${sx} ${y + 22 + gapY * 0.45} Z`}
        fill="#475569"
      />
    )
  }
  // tip view: n teeth, each a radial cutting face (yellow) with the flute gash behind it
  const cx = 222
  const cy = 72
  const R = 50
  const core = R * 0.36
  const step = (Math.PI * 2) / n
  const pt = (a: number, r: number): string => `${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r}`
  let body = ''
  const faces: ReactNode[] = []
  const tips: ReactNode[] = []
  for (let i = 0; i < n; i++) {
    const a = i * step
    const land = a + step * (n === 1 ? 0.62 : 0.5)
    const gash = a + step * 0.8
    const next = a + step
    body +=
      (i === 0 ? `M ${pt(a, R)} ` : '') +
      `A ${R} ${R} 0 ${land - a > Math.PI ? 1 : 0} 1 ${pt(land, R)} ` +
      `Q ${pt(gash, R * 0.62)} ${pt(next, core)} ` +
      `L ${pt(next, R)} `
    faces.push(
      <line
        key={i}
        x1={cx + Math.cos(next) * core}
        y1={cy + Math.sin(next) * core}
        x2={cx + Math.cos(next) * R}
        y2={cy + Math.sin(next) * R}
        stroke="#facc15"
        strokeWidth={3}
        strokeLinecap="round"
      />
    )
    tips.push(
      <text
        key={i}
        x={cx + Math.cos(next + Math.min(0.45, step * 0.12)) * (R - 9)}
        y={cy + Math.sin(next + Math.min(0.45, step * 0.12)) * (R - 9) + 4}
        fontSize={10}
        fontWeight={700}
        fill="#0b1220"
        textAnchor="middle"
      >
        {i + 1}
      </text>
    )
  }
  body += 'Z'
  return (
    <Scene
      caption={`${n} flute${n === 1 ? '' : 's'} = ${n} cutting edge${n === 1 ? '' : 's'} (yellow). Each turn every edge takes one bite: more edges cut smoother, fewer edges clear chips better (best for soft or sticky material).`}
    >
      <defs>
        <clipPath id="flute-side-clip">
          <rect x={sx} y={top} width={sw} height={len} />
        </clipPath>
      </defs>
      <rect x={sx} y={top} width={sw} height={len} fill="#cbd5e1" />
      <g clipPath="url(#flute-side-clip)">
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values={`0 0;0 ${-gapY}`}
            dur="0.9s"
            repeatCount="indefinite"
          />
          {bands}
        </g>
      </g>
      <rect x={sx} y={top} width={sw} height={len} fill="none" stroke="#1e293b" />
      <Label x={sx + sw / 2} y={top + len + 14} anchor="middle" color="#94a3b8" size={10}>
        from the side
      </Label>
      <g>
        <animateTransform
          attributeName="transform"
          type="rotate"
          values={`0 ${cx} ${cy};-360 ${cx} ${cy}`}
          dur="6s"
          repeatCount="indefinite"
        />
        <path d={body} fill="#cbd5e1" stroke="#1e293b" strokeWidth={1} />
        {faces}
        {tips}
      </g>
      <circle cx={cx} cy={cy} r={3} fill="#1e293b" />
      <Label x={cx} y={top + len + 14} anchor="middle" color="#94a3b8" size={10}>
        from the tip
      </Label>
      <Label x={W - 8} y={16} anchor="end" color="#fcd34d" size={12}>
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

/**
 * Depth per pass: the bit plunges to the next level first, then cuts along at that depth; the
 * material is removed only where it has passed. Drills peck instead.
 */
function stepDown(t: Tool): ReactNode {
  const drill = t.type === 'drill'
  const surface = 110
  const lvl = 9
  const levels = [surface + lvl, surface + 2 * lvl, surface + 3 * lvl]
  const x0 = 60
  const x1 = 260
  const dur = '6s'
  // per pass: plunge [s, s+0.05], cut [s+0.05, s+0.3]; passes at 0, 0.3, 0.6; hold to 1
  const starts = [0, 0.3, 0.6]
  const toolValues: string[] = []
  const toolTimes: string[] = []
  starts.forEach((s, i) => {
    const from = i % 2 === 0 ? x0 : x1
    const to = i % 2 === 0 ? x1 : x0
    toolValues.push(
      `${from} ${i === 0 ? surface - 16 : levels[i - 1]}`,
      `${from} ${levels[i]}`,
      `${to} ${levels[i]}`
    )
    toolTimes.push(s.toFixed(2), (s + 0.05).toFixed(2), (s + 0.3).toFixed(2))
  })
  toolValues.push(`${x0} ${levels[2]}`)
  toolTimes.push('1')
  // the hold at the end keeps the tool where it finished
  toolValues[toolValues.length - 1] = `${x1} ${levels[2]}`
  return (
    <Scene
      caption={
        drill
          ? `Pecking: the drill goes ${fmtMm(t.feeds.stepDown)} mm deeper each time, then pulls out to clear the chips.`
          : `Deep cuts are made in steps: the bit goes down ${fmtMm(t.feeds.stepDown)} mm, cuts the whole length at that depth, then goes down one more step and cuts again.`
      }
    >
      <BoardSide y={surface} thick={32} />
      {levels.map((y, i) => (
        <g key={y}>
          <line x1={30} x2={290} y1={y} y2={y} stroke="#a78bfa" strokeDasharray="3 3" opacity={0.55} />
          <Label x={292} y={y + 3} color="#c4b5fd" size={8}>
            {i + 1}
          </Label>
        </g>
      ))}
      {drill ? (
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values={`160 80;160 ${levels[0]};160 80;160 ${levels[1]};160 80;160 ${levels[2]};160 80`}
            dur="4s"
            repeatCount="indefinite"
          />
          <Bit kind="drill" />
        </g>
      ) : (
        <>
          {starts.map((s, i) => {
            const ltr = i % 2 === 0
            const y = surface + i * lvl
            const a = (s + 0.05).toFixed(2)
            const b = (s + 0.3).toFixed(2)
            return (
              <rect key={i} x={ltr ? x0 : x1} y={y} width={0} height={lvl} fill="#0b1220">
                <animate
                  attributeName="width"
                  values={`0;0;${x1 - x0};${x1 - x0}`}
                  keyTimes={`0;${a};${b};1`}
                  dur={dur}
                  repeatCount="indefinite"
                />
                {!ltr && (
                  <animate
                    attributeName="x"
                    values={`${x1};${x1};${x0};${x0}`}
                    keyTimes={`0;${a};${b};1`}
                    dur={dur}
                    repeatCount="indefinite"
                  />
                )}
              </rect>
            )
          })}
          <g>
            <animateTransform
              attributeName="transform"
              type="translate"
              values={toolValues.join(';')}
              keyTimes={toolTimes.join(';')}
              dur={dur}
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

export function toolFigure(key: ToolFieldKey, t: Tool): ReactNode | null {
  switch (key) {
    case 'type':
      return kinds(t)
    case 'number':
      return number(t)
    case 'geometry.diameter':
      return <BitDimensionFigure tool={t} dim="diameter" />
    case 'geometry.tipAngle':
      return <BitDimensionFigure tool={t} dim="tipAngle" />
    case 'geometry.tipDiameter':
      return <BitDimensionFigure tool={t} dim="tipDiameter" />
    case 'geometry.pointAngle':
      return <BitDimensionFigure tool={t} dim="pointAngle" />
    case 'geometry.fluteLength':
      return <BitDimensionFigure tool={t} dim="fluteLength" />
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
    default:
      return null
  }
}
