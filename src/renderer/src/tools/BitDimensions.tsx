/**
 * A still side drawing of a cutter with one of its sizes marked (diameter, tip angle, tip width,
 * cutting length, point angle). Used in the (?) of the tool's geometry fields.
 */
import type { ReactNode } from 'react'
import type { Tool } from '@core/model/types'
import { Label, Scene } from '@renderer/components/illustrations/kit'
import { fmtMm } from './toolMeta'

export type BitDimension = 'diameter' | 'tipAngle' | 'tipDiameter' | 'fluteLength' | 'pointAngle'

const HL = '#facc15'
const HL_TEXT = '#fde047'
const STEEL = '#cbd5e1'
const SHANK = '#94a3b8'
const EDGE = '#1e293b'

const deg = (d: number): number => (d * Math.PI) / 180

/** Small filled arrow head at (x,y) pointing towards angle `a` (radians). */
function head(x: number, y: number, a: number): string {
  const s = 5
  const l = a + Math.PI - 0.45
  const r = a + Math.PI + 0.45
  return `M ${x} ${y} L ${x + Math.cos(l) * s} ${y + Math.sin(l) * s} L ${x + Math.cos(r) * s} ${y + Math.sin(r) * s} Z`
}

function HDim({ x1, x2, y, label }: { x1: number; x2: number; y: number; label: string }): ReactNode {
  return (
    <g stroke={HL} fill={HL}>
      <line x1={x1} x2={x2} y1={y} y2={y} strokeWidth={1.2} />
      <path d={head(x1, y, Math.PI)} stroke="none" />
      <path d={head(x2, y, 0)} stroke="none" />
      <Label x={(x1 + x2) / 2} y={y - 6} anchor="middle" color={HL_TEXT} size={12}>
        {label}
      </Label>
    </g>
  )
}

function VDim({ x, y1, y2, label }: { x: number; y1: number; y2: number; label: string }): ReactNode {
  return (
    <g stroke={HL} fill={HL}>
      <line x1={x} x2={x} y1={y1} y2={y2} strokeWidth={1.2} />
      <path d={head(x, y1, -Math.PI / 2)} stroke="none" />
      <path d={head(x, y2, Math.PI / 2)} stroke="none" />
      <Label x={x + 8} y={(y1 + y2) / 2 + 4} color={HL_TEXT} size={12}>
        {label}
      </Label>
    </g>
  )
}

/** Dashed guide line from a feature out to its dimension line. */
const guide = (x1: number, y1: number, x2: number, y2: number): ReactNode => (
  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={HL} strokeWidth={0.8} strokeDasharray="3 2" opacity={0.8} />
)

export function BitDimensionFigure({ tool, dim }: { tool: Tool; dim: BitDimension }): ReactNode {
  const g = tool.geometry
  const height = 176
  const cx = 130
  const hw = 26
  const tipY = 160
  const top = 12
  const t = tool.type

  // Outline of the cutting part, and where it ends (y of its top).
  let cutTop: number
  let body: string
  let flutes: ReactNode = null
  let apexY = tipY
  let half = 0
  let tipHalf = 0
  if (t === 'vbit') {
    half = deg(Math.max(5, Math.min(170, g.tipAngle ?? 60)) / 2)
    const d = Math.max(0.01, g.diameter)
    tipHalf =
      (g.tipDiameter ?? 0) > 0 ? Math.max(1.5, Math.min(hw * 0.6, (hw * (g.tipDiameter ?? 0)) / d)) : 0
    const coneH = Math.max(14, Math.min(120, (hw - tipHalf) / Math.tan(half)))
    cutTop = tipY - coneH
    apexY = tipY + tipHalf / Math.tan(half)
    body = `M ${cx - hw} ${cutTop} L ${cx + hw} ${cutTop} L ${cx + tipHalf} ${tipY} L ${cx - tipHalf} ${tipY} Z`
    flutes = <line x1={cx} y1={cutTop} x2={cx} y2={tipY} stroke="#f8fafc" strokeWidth={0.8} opacity={0.55} />
  } else {
    cutTop = tipY - 86
    if (t === 'ball') {
      body = `M ${cx - hw} ${cutTop} L ${cx + hw} ${cutTop} L ${cx + hw} ${tipY - hw} A ${hw} ${hw} 0 0 1 ${cx - hw} ${tipY - hw} Z`
    } else if (t === 'drill') {
      half = deg(Math.max(60, Math.min(170, g.pointAngle ?? 118)) / 2)
      const ph = hw / Math.tan(half)
      apexY = tipY
      body = `M ${cx - hw} ${cutTop} L ${cx + hw} ${cutTop} L ${cx + hw} ${tipY - ph} L ${cx} ${tipY} L ${cx - hw} ${tipY - ph} Z`
    } else {
      body = `M ${cx - hw} ${cutTop} L ${cx + hw} ${cutTop} L ${cx + hw} ${tipY} L ${cx - hw} ${tipY} Z`
    }
    const lines: ReactNode[] = []
    const bottom = t === 'ball' ? tipY - hw : t === 'drill' ? tipY - hw / Math.tan(half) : tipY
    for (let y = cutTop + 4; y < bottom - 6; y += 13) {
      lines.push(<line key={y} x1={cx - hw} y1={y + 10} x2={cx + hw} y2={y} />)
      if (t === 'corn') lines.push(<line key={`c${y}`} x1={cx - hw} y1={y} x2={cx + hw} y2={y + 10} />)
    }
    flutes = (
      <g stroke="#475569" strokeWidth={1.3}>
        {lines}
      </g>
    )
  }

  let marks: ReactNode = null
  let caption = ''
  switch (dim) {
    case 'diameter': {
      const y = t === 'vbit' ? top + 20 : cutTop + 30
      marks = (
        <>
          <line x1={cx - hw} x2={cx + hw} y1={y} y2={y} stroke={EDGE} strokeWidth={3} opacity={0.5} />
          <HDim x1={cx - hw} x2={cx + hw} y={y} label="" />
          {guide(cx + hw, y, cx + hw + 14, y)}
          <Label x={cx + hw + 18} y={y + 4} color={HL_TEXT} size={12}>
            Ø {fmtMm(g.diameter)} mm
          </Label>
        </>
      )
      caption =
        t === 'vbit'
          ? `The widest part of the bit: ${fmtMm(g.diameter)} mm (the shank). The V-tip cuts narrower than this, depending on how deep it goes.`
          : `The cutting diameter: ${fmtMm(g.diameter)} mm. This is how wide the bit cuts.`
      break
    }
    case 'tipAngle':
    case 'pointAngle': {
      const value = dim === 'tipAngle' ? (g.tipAngle ?? 60) : (g.pointAngle ?? 118)
      const R = Math.min(70, Math.max(40, tipY - cutTop - 10))
      const a1 = -Math.PI / 2 - half
      const a2 = -Math.PI / 2 + half
      const p1 = { x: cx + Math.cos(a1) * R, y: apexY + Math.sin(a1) * R }
      const p2 = { x: cx + Math.cos(a2) * R, y: apexY + Math.sin(a2) * R }
      marks = (
        <>
          {guide(cx, apexY, cx + Math.cos(a1) * (R + 14), apexY + Math.sin(a1) * (R + 14))}
          {guide(cx, apexY, cx + Math.cos(a2) * (R + 14), apexY + Math.sin(a2) * (R + 14))}
          <path
            d={`M ${p1.x} ${p1.y} A ${R} ${R} 0 0 1 ${p2.x} ${p2.y}`}
            fill="none"
            stroke={HL}
            strokeWidth={1.6}
          />
          <Label x={cx + hw + 16} y={apexY - R + 10} color={HL_TEXT} size={13}>
            {Math.round(value)}°
          </Label>
        </>
      )
      caption =
        dim === 'tipAngle'
          ? `The angle of the V: ${Math.round(value)}°. A narrower V cuts a thinner line, but goes deeper for the same width.`
          : `The angle of the drill's point: ${Math.round(value)}° (118° is the common one).`
      break
    }
    case 'tipDiameter': {
      const w = Math.max(tipHalf, 1.5)
      marks = (
        <>
          {guide(cx - w, tipY, cx - w, tipY + 8)}
          {guide(cx + w, tipY, cx + w, tipY + 8)}
          <HDim x1={cx - w - 22} x2={cx - w} y={tipY + 6} label="" />
          <HDim x1={cx + w + 22} x2={cx + w} y={tipY + 6} label="" />
          <Label x={cx + w + 28} y={tipY + 10} color={HL_TEXT} size={12}>
            {(g.tipDiameter ?? 0) > 0 ? `tip ${fmtMm(g.tipDiameter)} mm` : 'sharp tip (0 mm)'}
          </Label>
        </>
      )
      caption =
        (g.tipDiameter ?? 0) > 0
          ? `The flat end of the V: ${fmtMm(g.tipDiameter)} mm wide. The thinnest line this bit can cut.`
          : 'A sharp point (0 mm flat). Enter the flat width if your bit has one (e.g. 0.1 mm).'
      break
    }
    case 'fluteLength': {
      const x = cx + hw + 22
      marks = (
        <>
          {guide(cx + hw, cutTop, x + 4, cutTop)}
          {guide(cx + (t === 'vbit' ? tipHalf : hw * 0.4), tipY, x + 4, tipY)}
          <VDim x={x} y1={cutTop} y2={tipY} label={`${fmtMm(g.fluteLength)} mm`} />
        </>
      )
      caption = `The cutting part is ${fmtMm(g.fluteLength)} mm long. The bit can't cut deeper than this.`
      break
    }
  }

  return (
    <Scene caption={caption} height={height}>
      <rect
        x={cx - hw}
        y={top}
        width={hw * 2}
        height={cutTop - top}
        fill={SHANK}
        stroke={EDGE}
        strokeWidth={0.8}
      />
      <rect x={cx - hw} y={top} width={hw * 0.5} height={cutTop - top} fill="#f8fafc" opacity={0.12} />
      <Label x={cx - hw - 8} y={(top + cutTop) / 2 + 4} anchor="end" color="#64748b" size={10}>
        shank
      </Label>
      <path d={body} fill={STEEL} stroke={EDGE} strokeWidth={0.8} />
      {flutes}
      {marks}
    </Scene>
  )
}
