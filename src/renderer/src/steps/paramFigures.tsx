/**
 * One animated illustration per isolation / copper clearing / cutout setting, each showing what
 * that one value changes (overlap, extra clearance, islands, margin, cut side, tabs).
 */
import type { ReactNode } from 'react'
import { Label, Scene, W } from '@renderer/components/illustrations/kit'

const r2 = (v: number): string => String(Math.round(v * 100) / 100)
const COPPER = '#c47a3a'
const TRACE = '#e09a5a'
const FR4 = '#3f5a2a'
const BOARD = '#4d6b32'
const SHEET = '#6b4f35'
const YELLOW = '#facc15'
const kt = (v: number): string => Math.min(1, Math.max(0, v)).toFixed(3)

/** Sequential left-to-right passes: band i is cut during [i/n, (i+0.9)/n] of the loop. */
function PassBands({
  ys,
  h,
  x0,
  x1,
  dur
}: {
  ys: number[]
  h: number
  x0: number
  x1: number
  dur: number
}): ReactNode {
  const n = ys.length
  const values: string[] = []
  const times: string[] = []
  ys.forEach((y, i) => {
    values.push(`${x0} ${y + h / 2}`, `${x1} ${y + h / 2}`)
    times.push(kt(i / n), kt((i + 0.9) / n))
  })
  values.push(`${x1} ${ys[n - 1] + h / 2}`)
  times.push('1')
  return (
    <>
      {ys.map((y, i) => (
        <rect key={i} x={x0} y={y} width={0} height={h} fill={FR4}>
          <animate
            attributeName="width"
            values={`0;0;${x1 - x0};${x1 - x0}`}
            keyTimes={`0;${kt(i / n)};${kt((i + 0.9) / n)};1`}
            dur={`${dur}s`}
            repeatCount="indefinite"
          />
        </rect>
      ))}
      <circle r={h / 2} fill="rgba(226,232,240,0.25)" stroke="#e2e8f0" strokeWidth={1.2}>
        <animateTransform
          attributeName="transform"
          type="translate"
          values={values.join(';')}
          keyTimes={times.join(';')}
          dur={`${dur}s`}
          repeatCount="indefinite"
        />
      </circle>
    </>
  )
}

/**
 * Top view of side-by-side passes. The strip that two neighbouring passes both cut (the overlap) is
 * marked in yellow, sized from the real overlap value.
 */
export function OverlapFigure({ overlap, passes = 2 }: { overlap: number; passes?: number }): ReactNode {
  const ov = Math.max(0, Math.min(0.9, overlap))
  const n = Math.max(2, Math.min(4, passes))
  const h = n > 2 ? 24 : 36
  const step = h * (1 - ov)
  const y0 = 38
  const ys = Array.from({ length: n }, (_, i) => y0 + i * step)
  const x0 = 24
  const x1 = 236
  const dur = n * 1.6
  const pct = Math.round(ov * 100)
  return (
    <Scene
      caption={
        n > 2
          ? `Clearing cuts pass after pass across the copper. Each pass re-cuts ${pct}% of the one before (yellow), so no thin copper strips are left between them.`
          : `The second pass re-cuts ${pct}% of the first one's width (yellow). Too little overlap can leave a thin copper sliver between the grooves.`
      }
    >
      <rect x={0} y={0} width={W} height={150} fill={COPPER} />
      {n === 2 && (
        <>
          <rect x={0} y={12} width={W} height={y0 - 12} fill={TRACE} />
          <Label x={8} y={28} color="#3b2410" size={10}>
            trace
          </Label>
        </>
      )}
      <PassBands ys={ys} h={h} x0={x0} x1={x1} dur={dur} />
      {ov > 0 &&
        ys.slice(1).map((y, i) => (
          <rect key={i} x={x0} y={y} width={x1 - x0} height={h - step} fill={YELLOW} opacity={0}>
            <animate
              attributeName="opacity"
              values="0;0;0.5;0.5"
              keyTimes={`0;${kt((i + 1.85) / n)};${kt((i + 1.95) / n)};1`}
              dur={`${dur}s`}
              repeatCount="indefinite"
            />
          </rect>
        ))}
      {ys.map((y, i) => (
        <Label key={i} x={x1 + 6} y={y + h / 2 + 4} color="#1e293b" size={9}>
          pass {i + 1}
        </Label>
      ))}
      {ov > 0 && (
        <g stroke={YELLOW}>
          <line x1={x1 + 46} x2={x1 + 46} y1={ys[1]} y2={ys[0] + h} strokeWidth={3} />
          <Label x={x1 + 52} y={(ys[1] + ys[0] + h) / 2 + 4} color="#fde047" size={12}>
            {pct}%
          </Label>
        </g>
      )}
    </Scene>
  )
}

/**
 * Top view: extra clearance pushes the first groove away from the trace; the copper left in between
 * (yellow) makes the trace wider. Animates between 0 and the value (or an example when it is 0).
 */
export function ExtraClearanceFigure({ extra }: { extra: number }): ReactNode {
  const edge = 56
  const shown = extra > 0 ? extra : 0.2
  const e = Math.max(8, Math.min(40, shown * 80))
  const h = 30
  const dur = '3.5s'
  const kts = '0;0.15;0.5;0.85;1'
  return (
    <Scene
      caption={
        extra > 0
          ? `The groove starts ${r2(extra)} mm away from the trace, so that much extra copper (yellow) stays along each edge and the trace comes out wider.`
          : 'Now 0: the first groove runs right along the trace edge. Shown with 0.2 mm: the groove moves away and the trace keeps a wider strip of copper. Raise it if the bit eats into your traces.'
      }
    >
      <rect x={0} y={0} width={W} height={150} fill={COPPER} />
      <rect x={0} y={12} width={W} height={edge - 12} fill={TRACE} />
      <Label x={8} y={32} color="#3b2410" size={10}>
        trace (as designed)
      </Label>
      <rect x={0} y={edge} width={W} height={0} fill={YELLOW} opacity={0.55}>
        <animate
          attributeName="height"
          values={`0;0;${e};${e};0`}
          keyTimes={kts}
          dur={dur}
          repeatCount="indefinite"
        />
      </rect>
      <line x1={0} x2={W} y1={edge} y2={edge} stroke="#f8fafc" strokeDasharray="4 3" opacity={0.7} />
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values={`0 0;0 0;0 ${e};0 ${e};0 0`}
          keyTimes={kts}
          dur={dur}
          repeatCount="indefinite"
        />
        <rect x={0} y={edge} width={W} height={h} fill={FR4} />
        <Label x={8} y={edge + h / 2 + 4} color="#d9f99d" size={10}>
          first groove
        </Label>
      </g>
      <g stroke={YELLOW}>
        <line x1={292} x2={292} y1={edge} y2={edge} strokeWidth={3}>
          <animate
            attributeName="y2"
            values={`${edge};${edge};${edge + e};${edge + e};${edge}`}
            keyTimes={kts}
            dur={dur}
            repeatCount="indefinite"
          />
        </line>
        <Label x={286} y={edge - 6} anchor="end" color="#fde047" size={11}>
          {extra > 0 ? `+${r2(extra)} mm` : 'e.g. +0.2 mm'}
        </Label>
      </g>
    </Scene>
  )
}

/**
 * Top view of copper clearing over islands of several sizes: islands below the limit are cleared
 * away with the rest; bigger ones are kept and milled around.
 */
export function IslandFigure({ minArea }: { minArea: number }): ReactNode {
  // Island sizes around the current limit, so some are always below it and some above.
  const rel = [0.3, 0.7, 1.5, 3, 6]
  const base = minArea > 0 ? minArea : 0.25
  const areas = rel.map((f) => Number((f * base).toPrecision(2)))
  const x0 = 16
  const x1 = 304
  const dur = 5
  const end = 0.75
  const xs = [44, 96, 152, 214, 272]
  const at = (x: number): string => kt(((x - x0) / (x1 - x0)) * end)
  const zig: string[] = []
  const zt: string[] = []
  for (let i = 0; i <= 8; i++) {
    zig.push(`${x0 + ((x1 - x0) * i) / 8} ${i % 2 ? 104 : 36}`)
    zt.push(kt((end * i) / 8))
  }
  zig.push(`${x1} 104`)
  zt.push('1')
  return (
    <Scene
      caption={
        minArea > 0
          ? `Copper islands smaller than ${r2(minArea)} mm² are simply cleared away; bigger ones are kept and milled around (blue).`
          : 'At 0 every island is kept and milled around, however tiny.'
      }
    >
      <rect x={0} y={0} width={W} height={150} fill={COPPER} />
      <rect x={x0} y={30} width={0} height={80} fill={FR4}>
        <animate
          attributeName="width"
          values={`0;${x1 - x0};${x1 - x0}`}
          keyTimes={`0;${end};1`}
          dur={`${dur}s`}
          repeatCount="indefinite"
        />
      </rect>
      {areas.map((a, i) => {
        const s = Math.sqrt(rel[i]) * 12
        const keep = a >= minArea
        const x = xs[i]
        const color = keep ? '#7dd3fc' : '#fda4af'
        return (
          <g key={a}>
            {keep && (
              <rect
                x={x - s / 2 - 3}
                y={70 - s / 2 - 3}
                width={s + 6}
                height={s + 6}
                fill="none"
                stroke="#7dd3fc"
                strokeDasharray="2 2"
              />
            )}
            <rect x={x - s / 2} y={70 - s / 2} width={s} height={s} fill={TRACE}>
              {!keep && (
                <animate
                  attributeName="opacity"
                  values="1;1;0;0"
                  keyTimes={`0;${at(x - 6)};${at(x + 6)};1`}
                  dur={`${dur}s`}
                  repeatCount="indefinite"
                />
              )}
            </rect>
            <Label x={x} y={126} anchor="middle" color={color} size={9}>
              {a} mm²
            </Label>
            <Label x={x} y={139} anchor="middle" color={color} size={9}>
              {keep ? 'kept' : 'cleared'}
            </Label>
          </g>
        )
      })}
      <circle r={6} fill="rgba(226,232,240,0.4)" stroke="#e2e8f0">
        <animateTransform
          attributeName="transform"
          type="translate"
          values={zig.join(';')}
          keyTimes={zt.join(';')}
          dur={`${dur}s`}
          repeatCount="indefinite"
        />
      </circle>
      <Label x={8} y={20} color="#3b2410" size={10}>
        copper islands, smallest to largest
      </Label>
    </Scene>
  )
}

/** Top view: with a margin, only a band of that width along the traces is cleared. */
export function ClearMarginFigure({ margin }: { margin: number }): ReactNode {
  const t1 = 34
  const t2 = 112
  const m = margin > 0 ? Math.max(8, Math.min(34, margin * 12)) : (t2 - t1) / 2
  const dur = '3.5s'
  return (
    <Scene
      caption={
        margin > 0
          ? `Only copper within ${r2(margin)} mm of the traces is removed (much faster); copper further away stays.`
          : 'At 0 all unused copper between the traces is removed.'
      }
    >
      <rect x={0} y={0} width={W} height={150} fill={COPPER} />
      <rect x={0} y={t1 - 18} width={W} height={18} fill={TRACE} />
      <rect x={0} y={t2} width={W} height={18} fill={TRACE} />
      <Label x={8} y={t1 - 5} color="#3b2410" size={10}>
        trace
      </Label>
      <Label x={8} y={t2 + 13} color="#3b2410" size={10}>
        trace
      </Label>
      <rect x={0} y={t1} width={W} height={0} fill={FR4}>
        <animate
          attributeName="height"
          values={`0;${m};${m}`}
          keyTimes="0;0.7;1"
          dur={dur}
          repeatCount="indefinite"
        />
      </rect>
      <rect x={0} y={t2} width={W} height={0} fill={FR4}>
        <animate
          attributeName="height"
          values={`0;${m};${m}`}
          keyTimes="0;0.7;1"
          dur={dur}
          repeatCount="indefinite"
        />
        <animate
          attributeName="y"
          values={`${t2};${t2 - m};${t2 - m}`}
          keyTimes="0;0.7;1"
          dur={dur}
          repeatCount="indefinite"
        />
      </rect>
      {margin > 0 && (
        <>
          <Label x={W / 2} y={(t1 + t2) / 2 + 4} anchor="middle" color="#3b2410" size={10}>
            left as copper
          </Label>
          <g stroke={YELLOW}>
            <line x1={296} x2={296} y1={t1} y2={t1 + m} strokeWidth={3} />
            <Label x={288} y={t1 + m / 2 + 4} anchor="end" color="#fde047" size={11}>
              {r2(margin)} mm
            </Label>
          </g>
        </>
      )}
    </Scene>
  )
}

/** Top view of a board edge with both options side by side; the chosen one is highlighted. */
export function CutSideFigure({ outside }: { outside: boolean }): ReactNode {
  const panel = (px: number, out: boolean): ReactNode => {
    const on = out === outside
    const edge = px + 74
    const g = 26
    const gx = out ? edge : edge - g
    return (
      <g opacity={on ? 1 : 0.4}>
        <rect x={px} y={24} width={148} height={98} fill={SHEET} />
        <rect x={px} y={24} width={edge - px} height={98} fill={BOARD} />
        <Label x={px + 6} y={40} color="#d9f99d" size={9}>
          board
        </Label>
        <Label x={px + 142} y={40} anchor="end" color="#e7d5bd" size={9}>
          sheet
        </Label>
        <rect x={gx} y={24} width={g} height={98} fill="#0b1220" />
        <line x1={edge} x2={edge} y1={20} y2={126} stroke={YELLOW} strokeWidth={1.5} strokeDasharray="4 3" />
        {on && (
          <circle cx={gx + g / 2} cy={24} r={g / 2} fill="rgba(226,232,240,0.35)" stroke="#e2e8f0">
            <animate attributeName="cy" values="24;122;24" dur="3s" repeatCount="indefinite" />
          </circle>
        )}
        <rect
          x={px - 2}
          y={4}
          width={152}
          height={136}
          rx={5}
          fill="none"
          stroke={on ? '#38bdf8' : '#334155'}
        />
        <Label x={px + 74} y={17} anchor="middle" color={on ? '#e0f2fe' : '#94a3b8'} size={11}>
          {out ? 'Outside' : 'Inside'}
        </Label>
        <Label x={px + 74} y={135} anchor="middle" color={on ? '#bae6fd' : '#64748b'} size={9}>
          {out ? 'board keeps its exact size' : 'board ends up smaller'}
        </Label>
      </g>
    )
  }
  return (
    <Scene caption="Seen from above at the board edge. The dashed yellow line is the outline from your design; the dark groove is what the bit cuts.">
      {panel(8, true)}
      {panel(164, false)}
    </Scene>
  )
}

/** What a tab is: the cut-out from above with its tabs, plus a close-up of one tab from the side. */
export function TabsFigure({ tabs }: { tabs: number }): ReactNode {
  const n = Math.max(0, Math.min(8, Math.round(tabs) || 0))
  const bx = 34
  const by = 38
  const bw = 112
  const bh = 70
  const g = 8
  const x0 = bx - g / 2
  const y0 = by - g / 2
  const w = bw + g
  const h = bh + g
  const per = 2 * (w + h)
  const at = (d: number): { x: number; y: number; horiz: boolean } => {
    let t = ((d % per) + per) % per
    if (t < w) return { x: x0 + t, y: y0, horiz: true }
    t -= w
    if (t < h) return { x: x0 + w, y: y0 + t, horiz: false }
    t -= h
    if (t < w) return { x: x0 + w - t, y: y0 + h, horiz: true }
    t -= w
    return { x: x0, y: y0 + h - t, horiz: false }
  }
  const pts = Array.from({ length: n }, (_, i) => at(w / 2 + (i * per) / n))
  const path = `M${x0},${y0} L${x0 + w},${y0} L${x0 + w},${y0 + h} L${x0},${y0 + h} Z`
  const first = pts[0]
  return (
    <Scene
      caption={
        n > 0
          ? `A tab is a short piece of the outline the bit does not cut through. The ${n} tab${n === 1 ? '' : 's'} keep the board attached to the sheet; snap them afterwards and sand the edge.`
          : 'No tabs: the board is cut completely free, and may shift or be hit by the bit at the end.'
      }
    >
      <rect x={4} y={14} width={176} height={120} fill={SHEET} />
      <rect x={bx} y={by} width={bw} height={bh} fill={BOARD} />
      <Label x={bx + bw / 2} y={by + bh / 2 + 4} anchor="middle" color="#d9f99d" size={10}>
        board
      </Label>
      <Label x={8} y={128} color="#e7d5bd" size={9}>
        sheet
      </Label>
      <path d={path} fill="none" stroke="#0b1220" strokeWidth={g} />
      {pts.map((p, i) => (
        <rect
          key={i}
          x={p.horiz ? p.x - 7 : p.x - g / 2}
          y={p.horiz ? p.y - g / 2 : p.y - 7}
          width={p.horiz ? 14 : g}
          height={p.horiz ? g : 14}
          fill={YELLOW}
        >
          <animate attributeName="opacity" values="1;0.45;1" dur="1.6s" repeatCount="indefinite" />
        </rect>
      ))}
      <circle r={g / 2 + 1} fill="#e2e8f0">
        <animateMotion dur="6s" repeatCount="indefinite" path={path} />
      </circle>
      {first && (
        <g stroke={YELLOW}>
          <line x1={first.x} y1={first.y - 5} x2={first.x + 40} y2={14} strokeWidth={1} />
          <Label x={first.x + 44} y={16} color="#fde047" size={11}>
            tab
          </Label>
        </g>
      )}
      <Label x={250} y={34} anchor="middle" color="#94a3b8" size={9}>
        one tab, seen from the side
      </Label>
      <rect x={190} y={56} width={48} height={34} fill={BOARD} />
      <rect x={262} y={56} width={48} height={34} fill={SHEET} />
      <rect x={238} y={56} width={24} height={34} fill="#0b1220" />
      <rect x={238} y={74} width={24} height={16} fill={YELLOW} opacity={0.85} />
      <rect x={190} y={90} width={120} height={8} fill="#334155" />
      <Label x={214} y={50} anchor="middle" color="#d9f99d" size={9}>
        board
      </Label>
      <Label x={286} y={50} anchor="middle" color="#e7d5bd" size={9}>
        sheet
      </Label>
      <line x1={250} x2={250} y1={92} y2={110} stroke={YELLOW} strokeWidth={0.8} />
      <Label x={250} y={120} anchor="middle" color="#fde047" size={10}>
        uncut bridge
      </Label>
    </Scene>
  )
}
