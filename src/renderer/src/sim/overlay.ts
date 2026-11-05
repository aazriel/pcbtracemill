/**
 * 2D overlay drawn above the WebGL board: the spinning tool (top view only — the 3D view ray-traces
 * the cutter in the shader) and the trailing path. All inputs are in stock millimetres; `view` maps
 * them to CSS pixels (orthographic top view, or a perspective projection in 3D).
 */
import type { Tool } from '@core/model/types'
import { toolRadiusAtHeight } from '@core/tools/geometry'
import type { SimViewTransform } from './SimGL'
import type { SimData, ToolState } from './engine'
import { withAlpha } from './colors'

export interface OverlayView extends SimViewTransform {
  width: number
  height: number
  /** 3D view: perspective projection of a stock point (null = behind the camera). */
  project?: (x: number, y: number, z: number) => [number, number] | null
}

export function toScreen(v: OverlayView, x: number, y: number, z = 0): [number, number] {
  if (v.project) return v.project(x, y, z) ?? [NaN, NaN]
  return [(x - v.cx) * v.zoom + v.width / 2, v.height / 2 - (y - v.cy) * v.zoom]
}

export function toStock(v: OverlayView, sx: number, sy: number): [number, number] {
  return [v.cx + (sx - v.width / 2) / v.zoom, v.cy - (sy - v.height / 2) / v.zoom]
}

const MAX_TRAIL_MOVES = 12000
const BUCKETS = 14

/**
 * Trailing path of the current step: newest segments are bright, older ones fade out.
 * Rapids (fast moves in the air) are drawn dashed only when `showRapids` is on.
 */
export function drawTrail(
  ctx: CanvasRenderingContext2D,
  v: OverlayView,
  d: SimData,
  ts: ToolState,
  color: string,
  showRapids: boolean
): void {
  const m = d.moves
  const step = m.step[ts.index]
  let first = ts.index
  while (first > 0 && ts.index - first < MAX_TRAIL_MOVES && m.step[first - 1] === step) first--
  const span = Math.max(1, ts.index - first + 1)
  const feed: Path2D[] = Array.from({ length: BUCKETS }, () => new Path2D())
  const air = new Path2D()
  let hasAir = false
  for (let i = first; i <= ts.index; i++) {
    const o = i * 6
    const [ax, ay] = toScreen(v, m.xyz[o], m.xyz[o + 1], m.xyz[o + 2])
    const [bx, by] =
      i === ts.index ? toScreen(v, ts.x, ts.y, ts.z) : toScreen(v, m.xyz[o + 3], m.xyz[o + 4], m.xyz[o + 5])
    if (!Number.isFinite(ax + ay + bx + by)) continue
    if (Math.abs(ax - bx) < 0.05 && Math.abs(ay - by) < 0.05) continue
    const inAir = m.kind[i] === 0 || Math.min(m.xyz[o + 2], m.xyz[o + 5]) > 0
    if (inAir) {
      if (!showRapids) continue
      air.moveTo(ax, ay)
      air.lineTo(bx, by)
      hasAir = true
      continue
    }
    const age = (ts.index - i) / span
    const b = Math.min(BUCKETS - 1, Math.floor((1 - age) * BUCKETS))
    feed[b].moveTo(ax, ay)
    feed[b].lineTo(bx, by)
  }
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (hasAir) {
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 0.8
    ctx.strokeStyle = 'rgba(248,250,252,0.55)'
    ctx.stroke(air)
    ctx.setLineDash([])
  }
  // A hairline that marks the tool centre, never the width of the cut: about 0.03 mm wide in screen
  // pixels, so zoomed out it stays far thinner than the milled grooves instead of covering them.
  const ppm = pixelsPerMm(v, ts.x, ts.y, ts.z)
  const w = Math.max(0.35, Math.min(1.1, ppm * 0.03))
  const outline = ppm > 25
  for (let b = 0; b < BUCKETS; b++) {
    const a = (0.3 + 0.7 * Math.pow((b + 1) / BUCKETS, 2)) * (outline ? 1 : 0.85)
    // dark under-stroke keeps the line readable on bright copper (only when zoomed in)
    if (outline) {
      ctx.lineWidth = w + 0.8
      ctx.strokeStyle = `rgba(2,6,23,${a * 0.45})`
      ctx.stroke(feed[b])
    }
    ctx.lineWidth = w
    ctx.strokeStyle = withAlpha(color, a)
    ctx.stroke(feed[b])
  }
  ctx.restore()
}

/** Screen pixels per millimetre around a point (works for the top view and the 3D camera). */
function pixelsPerMm(v: Parameters<typeof toScreen>[0], x: number, y: number, z: number): number {
  const [ax, ay] = toScreen(v, x, y, z)
  const [bx, by] = toScreen(v, x + 1, y, z)
  const [cx, cy] = toScreen(v, x, y + 1, z)
  const d = Math.max(Math.hypot(bx - ax, by - ay), Math.hypot(cx - ax, cy - ay))
  return Number.isFinite(d) && d > 0 ? d : 10
}

function tipRadius(tool: Tool): number {
  if (tool.type === 'vbit') return Math.max(0.01, (tool.geometry.tipDiameter ?? 0) / 2)
  if (tool.type === 'drill') return 0.05
  return tool.geometry.diameter / 2
}

/**
 * Top view of the spinning cutter at the current position: soft drop shadow (longer when the tool
 * is high above the board), translucent steel body with rotating flutes, and a glowing ring
 * where the cutter meets the material when it is cutting.
 */
export function drawTool(
  ctx: CanvasRenderingContext2D,
  v: OverlayView,
  ts: ToolState,
  tool: Tool | null,
  spin: number,
  copperThickness: number
): void {
  const [px, py] = toScreen(v, ts.x, ts.y)
  const R = (tool?.geometry.diameter ?? 1) / 2
  const Rpx = Math.max(7, R * v.zoom)
  const cutting = ts.z < -1e-4 && ts.kind === 'feed'
  const rCut = tool ? (ts.z < 0 ? toolRadiusAtHeight(tool, -ts.z) : tipRadius(tool)) : R
  const rCutPx = Math.max(2, rCut * v.zoom)
  const lift = Math.max(0, ts.z)
  const off = Math.min(60, 3 + lift * v.zoom * 0.55 + Math.min(lift, 5) * 2)

  ctx.save()
  // drop shadow
  ctx.filter = `blur(${Math.min(12, 2 + off * 0.25)}px)`
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0.18, 0.5 - lift * 0.03)})`
  ctx.beginPath()
  ctx.arc(px + off * 0.55, py + off * 0.65, Rpx, 0, Math.PI * 2)
  ctx.fill()
  ctx.filter = 'none'

  // cutting glow below the body
  if (cutting) {
    ctx.globalCompositeOperation = 'lighter'
    const deep = -ts.z > copperThickness + 1e-4
    const g = ctx.createRadialGradient(px, py, rCutPx * 0.4, px, py, rCutPx * 2.6 + 6)
    g.addColorStop(0, deep ? 'rgba(255,236,170,0.55)' : 'rgba(255,190,120,0.6)')
    g.addColorStop(1, 'rgba(255,140,60,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(px, py, rCutPx * 2.6 + 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
  }

  // body (steel / carbide), translucent so the cut stays visible
  const body = ctx.createLinearGradient(px - Rpx, py - Rpx, px + Rpx, py + Rpx)
  body.addColorStop(0, 'rgba(241,245,249,0.5)')
  body.addColorStop(0.35, 'rgba(148,163,184,0.36)')
  body.addColorStop(0.65, 'rgba(71,85,105,0.34)')
  body.addColorStop(1, 'rgba(203,213,225,0.42)')
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.arc(px, py, Rpx, 0, Math.PI * 2)
  ctx.fill()
  if (tool?.type === 'vbit' || tool?.type === 'drill') {
    // conical point: bright toward the tip
    const cone = ctx.createRadialGradient(px - Rpx * 0.15, py - Rpx * 0.15, 0, px, py, Rpx)
    cone.addColorStop(0, 'rgba(255,255,255,0.35)')
    cone.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = cone
    ctx.fill()
  }
  ctx.lineWidth = 1.2
  ctx.strokeStyle = 'rgba(226,232,240,0.85)'
  ctx.stroke()

  // flutes
  const flutes = Math.max(1, Math.min(6, tool?.geometry.flutes ?? 2))
  ctx.lineWidth = Math.max(1, Math.min(2.2, Rpx * 0.06))
  ctx.strokeStyle = 'rgba(15,23,42,0.55)'
  const spiral = tool?.type === 'vbit' ? 0 : 0.9
  for (let k = 0; k < flutes; k++) {
    const a = spin + (k * Math.PI * 2) / flutes
    ctx.beginPath()
    ctx.moveTo(px + Math.cos(a) * Rpx * 0.08, py + Math.sin(a) * Rpx * 0.08)
    const cA = a + spiral * 0.6
    ctx.quadraticCurveTo(
      px + Math.cos(cA) * Rpx * 0.6,
      py + Math.sin(cA) * Rpx * 0.6,
      px + Math.cos(a + spiral) * Rpx * 0.97,
      py + Math.sin(a + spiral) * Rpx * 0.97
    )
    ctx.stroke()
  }

  // cutting circle (actual cut width at the board surface)
  ctx.beginPath()
  ctx.arc(px, py, rCutPx, 0, Math.PI * 2)
  ctx.lineWidth = cutting ? 2 : 1.2
  ctx.strokeStyle = cutting ? 'rgba(253,186,116,0.95)' : 'rgba(255,255,255,0.7)'
  if (!cutting) ctx.setLineDash([3, 3])
  ctx.stroke()
  ctx.setLineDash([])

  // centre mark
  ctx.strokeStyle = 'rgba(15,23,42,0.9)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(px - 4, py)
  ctx.lineTo(px + 4, py)
  ctx.moveTo(px, py - 4)
  ctx.lineTo(px, py + 4)
  ctx.stroke()
  ctx.restore()
}
