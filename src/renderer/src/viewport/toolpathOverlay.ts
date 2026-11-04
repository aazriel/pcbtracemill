/**
 * Toolpath overlay for the 2D board view. Toolpaths are generated in machine WORK coordinates; to show
 * them on top of the board they are mapped back to BOARD coordinates with the inverse of
 * boardToWorkTransform(material, boardBBox, side). Paths are cached as Path2D in mm.
 */
import type { BBox, Material, Toolpath } from '@core/model/types'
import type { Affine } from '@core/geometry'
import { applyAffine } from '@core/geometry'
import { boardToStockTransform, boardToWorkTransform } from '@core/toolpath'
import type { ViewTransform } from './boardRender'

export function invertAffine(m: Affine): Affine {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (Math.abs(det) < 1e-15) return [1, 0, 0, 1, 0, 0]
  const ia = d / det
  const ib = -b / det
  const ic = -c / det
  const id = a / det
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)]
}

export interface PreparedToolpath {
  stepId: string
  side: 'top' | 'bottom'
  color: string
  /** Width of the cut at the surface (mm) used for the faint "swath". */
  cutWidth: number
  feed: Path2D
  rapid: Path2D
  drills: { x: number; y: number; r: number }[]
}

const TAU = Math.PI * 2

/**
 * Converts toolpaths into board-space Path2D objects.
 * @param colorOf colour per step id
 * @param widthOf cut width (mm) and drill radius source per toolpath
 */
export function prepareToolpaths(
  toolpaths: Toolpath[],
  material: Material,
  boardBBox: BBox,
  colorOf: (stepId: string) => string,
  widthOf: (tp: Toolpath) => number
): PreparedToolpath[] {
  const inv = {
    top: invertAffine(boardToWorkTransform(material, boardBBox, 'top')),
    bottom: invertAffine(boardToWorkTransform(material, boardBBox, 'bottom'))
  }
  return toolpaths.map((tp) => {
    const m = inv[tp.side]
    const map = (x: number, y: number): [number, number] => {
      const p = applyAffine(m, { x, y })
      return [p.x, p.y]
    }
    const feed = new Path2D()
    const rapid = new Path2D()
    const drills: PreparedToolpath['drills'] = []
    const width = Math.max(0.01, widthOf(tp))
    let pos: { x: number; y: number } | null = null
    let feedOpen = false
    for (const seg of tp.segments) {
      if (seg.drill) {
        const [x, y] = map(seg.drill.x, seg.drill.y)
        drills.push({ x, y, r: width / 2 })
      }
      for (const mv of seg.moves) {
        if (!pos) {
          pos = { x: mv.x, y: mv.y }
          continue
        }
        const moved = Math.abs(mv.x - pos.x) > 1e-9 || Math.abs(mv.y - pos.y) > 1e-9
        if (mv.kind === 'rapid' || mv.kind === 'retract') {
          if (moved) {
            const [ax, ay] = map(pos.x, pos.y)
            const [bx, by] = map(mv.x, mv.y)
            rapid.moveTo(ax, ay)
            rapid.lineTo(bx, by)
          }
          feedOpen = false
        } else if (mv.kind === 'feed' || mv.kind === 'plunge') {
          if (moved) {
            if (!feedOpen) {
              const [ax, ay] = map(pos.x, pos.y)
              feed.moveTo(ax, ay)
              feedOpen = true
            }
            const [bx, by] = map(mv.x, mv.y)
            feed.lineTo(bx, by)
          }
        } else if (mv.kind === 'arc-cw' || mv.kind === 'arc-ccw') {
          const cx = mv.cx ?? pos.x
          const cy = mv.cy ?? pos.y
          const r = Math.hypot(pos.x - cx, pos.y - cy)
          const a0 = Math.atan2(pos.y - cy, pos.x - cx)
          const a1 = Math.atan2(mv.y - cy, mv.x - cx)
          let sweep = a1 - a0
          if (mv.kind === 'arc-cw') {
            if (sweep >= -1e-9) sweep -= TAU
          } else if (sweep <= 1e-9) sweep += TAU
          if (!feedOpen) {
            const [ax, ay] = map(pos.x, pos.y)
            feed.moveTo(ax, ay)
            feedOpen = true
          }
          const n = Math.max(8, Math.ceil((Math.abs(sweep) * Math.max(r, 0.05)) / 0.05))
          const steps = Math.min(n, 256)
          for (let i = 1; i <= steps; i++) {
            const a = a0 + (sweep * i) / steps
            const [x, y] = map(cx + r * Math.cos(a), cy + r * Math.sin(a))
            feed.lineTo(x, y)
          }
        }
        pos = { x: mv.x, y: mv.y }
      }
    }
    return {
      stepId: tp.stepId,
      side: tp.side,
      color: colorOf(tp.stepId),
      cutWidth: width,
      feed,
      rapid,
      drills
    }
  })
}

function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16
  )
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export interface DrawToolpathOptions {
  side: 'top' | 'bottom'
  selectedId: string | null
  showRapids: boolean
}

/** Draws prepared toolpaths of `side` (board coordinates; the canvas already has the view transform). */
export function drawToolpaths(
  ctx: CanvasRenderingContext2D,
  list: PreparedToolpath[],
  zoom: number,
  opts: DrawToolpathOptions
): void {
  const px = 1 / zoom
  const visible = list.filter((t) => t.side === opts.side)
  const sel = opts.selectedId && visible.some((t) => t.stepId === opts.selectedId) ? opts.selectedId : null
  const ordered = sel
    ? [...visible.filter((t) => t.stepId !== sel), ...visible.filter((t) => t.stepId === sel)]
    : visible
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const t of ordered) {
    const isSel = t.stepId === sel
    const dim = sel !== null && !isSel
    // faint swath = material actually removed
    ctx.strokeStyle = withAlpha(t.color, dim ? 0.06 : isSel ? 0.32 : 0.18)
    ctx.lineWidth = Math.max(t.cutWidth, px)
    ctx.stroke(t.feed)
    // centre line
    ctx.strokeStyle = withAlpha(t.color, dim ? 0.25 : 0.95)
    ctx.lineWidth = (isSel ? 1.6 : 1) * px
    ctx.stroke(t.feed)
    if (opts.showRapids && !dim) {
      ctx.save()
      ctx.setLineDash([4 * px, 3 * px])
      ctx.strokeStyle = isSel ? 'rgba(226,232,240,0.7)' : 'rgba(203,213,225,0.35)'
      ctx.lineWidth = 0.8 * px
      ctx.stroke(t.rapid)
      ctx.restore()
    }
    if (t.drills.length) {
      ctx.strokeStyle = withAlpha(t.color, dim ? 0.25 : 1)
      ctx.fillStyle = withAlpha(t.color, dim ? 0.05 : isSel ? 0.3 : 0.15)
      ctx.lineWidth = (isSel ? 1.6 : 1.1) * px
      const cross = new Path2D()
      for (const d of t.drills) {
        const r = Math.max(d.r, 2 * px)
        cross.moveTo(d.x + r, d.y)
        cross.arc(d.x, d.y, r, 0, TAU)
        const c = r * 1.5
        cross.moveTo(d.x - c, d.y)
        cross.lineTo(d.x + c, d.y)
        cross.moveTo(d.x, d.y - c)
        cross.lineTo(d.x, d.y + c)
      }
      for (const d of t.drills) {
        ctx.beginPath()
        ctx.arc(d.x, d.y, Math.max(d.r, 2 * px), 0, TAU)
        ctx.fill()
      }
      ctx.stroke(cross)
    }
  }
  ctx.restore()
}

/** Stock corners in BOARD coordinates (top view), so the material shows around the board. */
export function stockCornersInBoard(material: Material, boardBBox: BBox): [number, number][] {
  const inv = invertAffine(boardToStockTransform(material, boardBBox))
  return [
    [0, 0],
    [material.width, 0],
    [material.width, material.height],
    [0, material.height]
  ].map(([x, y]) => {
    const p = applyAffine(inv, { x, y })
    return [p.x, p.y] as [number, number]
  })
}

export function drawStock(ctx: CanvasRenderingContext2D, corners: [number, number][], zoom: number): void {
  ctx.save()
  ctx.beginPath()
  corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
  ctx.fillStyle = 'rgba(184,115,51,0.13)'
  ctx.fill()
  ctx.setLineDash([6 / zoom, 4 / zoom])
  ctx.strokeStyle = 'rgba(217,149,84,0.8)'
  ctx.lineWidth = 1.2 / zoom
  ctx.stroke()
  ctx.restore()
}

/** Draws text upright regardless of the (y-flipped, possibly mirrored) view transform. */
function uprightText(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  text: string,
  x: number,
  y: number,
  dx: number,
  dy: number
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale((view.mirror ? -1 : 1) / view.zoom, -1 / view.zoom)
  ctx.fillText(text, dx, dy)
  ctx.restore()
}

/** Work origin (X0 Y0) marker with X/Y axis arrows, for the given machining side. */
export function drawOrigin(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  material: Material,
  boardBBox: BBox,
  side: 'top' | 'bottom'
): void {
  const inv = invertAffine(boardToWorkTransform(material, boardBBox, side))
  const o = applyAffine(inv, { x: 0, y: 0 })
  const len = 28 / view.zoom
  const ax = applyAffine(inv, { x: len, y: 0 })
  const ay = applyAffine(inv, { x: 0, y: len })
  const px = 1 / view.zoom
  ctx.save()
  ctx.lineWidth = 2 * px
  for (const [p, color, label] of [
    [ax, '#f87171', 'X'],
    [ay, '#4ade80', 'Y']
  ] as const) {
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(o.x, o.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    const ang = Math.atan2(p.y - o.y, p.x - o.x)
    const h = 7 * px
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x - h * Math.cos(ang - 0.45), p.y - h * Math.sin(ang - 0.45))
    ctx.lineTo(p.x - h * Math.cos(ang + 0.45), p.y - h * Math.sin(ang + 0.45))
    ctx.closePath()
    ctx.fill()
    ctx.font = 'bold 11px system-ui, sans-serif'
    uprightText(ctx, view, label, p.x, p.y, 4, -4)
  }
  ctx.fillStyle = '#facc15'
  ctx.strokeStyle = '#0f172a'
  ctx.beginPath()
  ctx.arc(o.x, o.y, 4.5 * px, 0, TAU)
  ctx.fill()
  ctx.stroke()
  ctx.font = '600 11px system-ui, sans-serif'
  uprightText(ctx, view, 'X0 Y0', o.x, o.y, 7, 14)
  ctx.restore()
}
