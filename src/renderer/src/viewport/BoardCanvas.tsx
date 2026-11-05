import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Maximize, Ruler, ZoomIn, ZoomOut } from 'lucide-react'
import type { BBox, GerberObject, ImportedLayer } from '@core/model/types'
import { Button } from '@renderer/components/ui/button'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { fmtLength, lengthValue, unitLabel, useUnits } from '@renderer/lib/units'
import {
  ObjectIndex,
  REAL,
  applyView,
  drillPath,
  fitView,
  netObjects,
  polygonSetPath,
  screenToWorld,
  slotPath,
  strokesPath,
  worldToScreen,
  type ViewTransform
} from './boardRender'

export type OverlayDraw = (ctx: CanvasRenderingContext2D, view: ViewTransform, pxPerMm: number) => void

export interface BoardCanvasProps {
  layers: ImportedLayer[]
  /** Board side to show; 'both' shows every layer as seen from the top. */
  side: 'top' | 'bottom' | 'both'
  realistic: boolean
  highlight: boolean
  /** Extents used for "fit"; usually stock ∪ board. */
  fitBox: BBox | null
  /** When set (or changed), the view zooms to this box, e.g. a place that needs attention. */
  focusBox?: BBox | null
  /** Drawn under the layers in world coords (e.g. stock material). */
  underlay?: OverlayDraw
  /** Drawn above the layers in world coords (e.g. toolpaths, origin marker). */
  overlay?: OverlayDraw
  /** Extra toolbar controls rendered top-left. */
  toolbar?: ReactNode
  className?: string
  /** Changing this value forces a redraw (e.g. when overlay data changes). */
  redrawKey?: unknown
  /** Click (without dragging) on the board: board coordinates and the current zoom (px per mm). */
  onPick?: (x: number, y: number, pxPerMm: number) => void
}

interface Hit {
  layerId: string
  obj: GerberObject
}

export function BoardCanvas(props: BoardCanvasProps): React.JSX.Element {
  const {
    layers,
    side,
    realistic,
    highlight,
    fitBox,
    focusBox,
    underlay,
    overlay,
    toolbar,
    className,
    redrawKey,
    onPick
  } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<ViewTransform>({ cx: 0, cy: 0, zoom: 5, mirror: side === 'bottom' })
  const [hover, setHover] = useState<Hit | null>(null)
  const [frozen, setFrozen] = useState<Hit | null>(null)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const units = useUnits()
  const [measure, setMeasure] = useState<{ a: [number, number]; b: [number, number] | null } | null>(null)
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null)
  const fittedRef = useRef(false)

  const visibleLayers = useMemo(
    () => layers.filter((l) => l.visible && l.parsed).sort((a, b) => a.order - b.order),
    [layers]
  )
  const index = useMemo(() => new ObjectIndex(layers.filter((l) => l.type === 'copper')), [layers])

  // Resize observer
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const doFit = useCallback(() => {
    if (fitBox && fitBox.minX <= fitBox.maxX) setView(fitView(fitBox, size.w, size.h, side === 'bottom'))
  }, [fitBox, size.w, size.h, side])

  // Fit once when geometry first appears
  useEffect(() => {
    if (!fittedRef.current && fitBox && fitBox.minX <= fitBox.maxX && size.w > 10) {
      fittedRef.current = true
      doFit()
    }
  }, [fitBox, size.w, doFit])

  // Zoom to a requested box (keeps the user's view otherwise).
  useEffect(() => {
    if (focusBox && focusBox.minX <= focusBox.maxX && size.w > 10)
      setView(fitView(focusBox, size.w, size.h, side === 'bottom'))
    // only when the requested box changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBox])

  useEffect(() => setView((v) => ({ ...v, mirror: side === 'bottom' })), [side])

  // ───────────── draw
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(size.w * dpr))
    canvas.height = Math.max(1, Math.floor(size.h * dpr))
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = REAL.background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    drawGrid(ctx, view, size.w, size.h, dpr)
    applyView(ctx, view, size.w, size.h, dpr)
    const px = 1 / view.zoom
    underlay?.(ctx, view, view.zoom)

    if (realistic) {
      drawRealistic(ctx, visibleLayers, side === 'both' ? 'top' : side, px)
      if (side === 'both') drawSeenThrough(ctx, visibleLayers, px)
    } else {
      // In the bottom view, draw bottom layers last so they are on top.
      const ordered =
        side === 'bottom'
          ? [...visibleLayers].sort(
              (a, b) => sideRank(a, 'bottom') - sideRank(b, 'bottom') || a.order - b.order
            )
          : visibleLayers
      for (const l of ordered) drawLayerFlat(ctx, l, px)
    }

    // Highlight hover / frozen (whole net when known)
    const sel = frozen ?? (highlight ? hover : null)
    if (sel) {
      const layer = layers.find((l) => l.id === sel.layerId)
      if (layer) {
        const objs = netObjects(layer, sel.obj)
        ctx.save()
        ctx.fillStyle = frozen ? 'rgba(56,189,248,0.75)' : 'rgba(250,250,250,0.55)'
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 1.5 * px
        for (const o of objs) {
          const p = polygonSetPath(o.shape)
          ctx.fill(p, 'nonzero')
          ctx.stroke(p)
        }
        ctx.restore()
      }
    }

    overlay?.(ctx, view, view.zoom)

    // Measurement
    if (measure) {
      const b = measure.b ?? cursor
      ctx.save()
      ctx.strokeStyle = '#facc15'
      ctx.fillStyle = '#facc15'
      ctx.lineWidth = 1.5 * px
      ctx.setLineDash([6 * px, 4 * px])
      if (b) {
        ctx.beginPath()
        ctx.moveTo(measure.a[0], measure.a[1])
        ctx.lineTo(b[0], b[1])
        ctx.stroke()
      }
      ctx.setLineDash([])
      for (const p of [measure.a, b]) {
        if (!p) continue
        ctx.beginPath()
        ctx.arc(p[0], p[1], 3 * px, 0, Math.PI * 2)
        ctx.fill()
      }
      // distance label next to the middle of the line, drawn in screen pixels
      if (b) {
        const t = ctx.getTransform()
        const mx = (measure.a[0] + b[0]) / 2
        const my = (measure.a[1] + b[1]) / 2
        const sx = t.a * mx + t.c * my + t.e
        const sy = t.b * mx + t.d * my + t.f
        const dpr = window.devicePixelRatio || 1
        const lines = [
          fmtLength(dist(measure.a, b), units),
          `ΔX ${fmtLength(Math.abs(b[0] - measure.a[0]), units)}  ΔY ${fmtLength(Math.abs(b[1] - measure.a[1]), units)}`
        ]
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.font = `600 ${13 * dpr}px ui-sans-serif, system-ui`
        const w1 = ctx.measureText(lines[0]).width
        ctx.font = `${11 * dpr}px ui-monospace, monospace`
        const w2 = ctx.measureText(lines[1]).width
        const w = Math.max(w1, w2) + 16 * dpr
        const h = 40 * dpr
        const x = sx + 10 * dpr
        const y = sy - h - 8 * dpr
        ctx.fillStyle = 'rgba(15,23,42,0.92)'
        ctx.strokeStyle = '#facc15'
        ctx.lineWidth = 1 * dpr
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, 6 * dpr)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#fde047'
        ctx.font = `600 ${13 * dpr}px ui-sans-serif, system-ui`
        ctx.fillText(lines[0], x + 8 * dpr, y + 17 * dpr)
        ctx.fillStyle = '#cbd5e1'
        ctx.font = `${11 * dpr}px ui-monospace, monospace`
        ctx.fillText(lines[1], x + 8 * dpr, y + 33 * dpr)
      }
      ctx.restore()
    }
  }, [
    size,
    view,
    visibleLayers,
    realistic,
    side,
    hover,
    frozen,
    highlight,
    layers,
    underlay,
    overlay,
    measure,
    units,
    cursor,
    redrawKey
  ])

  // ───────────── interaction
  const toWorld = (e: React.MouseEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect()
    return screenToWorld(view, size.w, size.h, e.clientX - r.left, e.clientY - r.top)
  }

  const onWheel = (e: React.WheelEvent): void => {
    const r = canvasRef.current!.getBoundingClientRect()
    const sx = e.clientX - r.left
    const sy = e.clientY - r.top
    const [wx, wy] = screenToWorld(view, size.w, size.h, sx, sy)
    const factor = Math.exp(-e.deltaY * 0.0015)
    const zoom = Math.min(2000, Math.max(0.2, view.zoom * factor))
    // keep the point under the cursor fixed
    const nv = { ...view, zoom }
    const [nx, ny] = screenToWorld(nv, size.w, size.h, sx, sy)
    setView({ ...nv, cx: nv.cx + (wx - nx), cy: nv.cy + (wy - ny) })
  }

  const onMouseDown = (e: React.MouseEvent): void => {
    dragRef.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false }
  }

  const onMouseMove = (e: React.MouseEvent): void => {
    const d = dragRef.current
    const w = toWorld(e)
    setCursor(w)
    if (d && e.buttons) {
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
      if (d.moved) {
        setView((v) => ({ ...v, cx: d.cx - (dx / v.zoom) * (v.mirror ? -1 : 1), cy: d.cy + dy / v.zoom }))
        return
      }
    }
    if (highlight && !measuring) {
      const ctx = canvasRef.current!.getContext('2d')!
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const ids = visibleLayers
        .filter((l) => l.type === 'copper')
        .sort(
          (a, b) => sideRank(a, side === 'both' ? 'top' : side) - sideRank(b, side === 'both' ? 'top' : side)
        )
        .reverse()
        .map((l) => l.id)
      const hit = index.hit(w[0], w[1], ids, ctx)
      setHover((h) => (h?.obj === hit?.obj ? h : hit))
    }
  }

  const onMouseUp = (e: React.MouseEvent): void => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.moved) return
    const w = toWorld(e)
    if (measuring) {
      if (!measure || measure.b) setMeasure({ a: w, b: null })
      else setMeasure({ ...measure, b: w })
      return
    }
    if (onPick) {
      onPick(w[0], w[1], view.zoom)
      return
    }
    if (!highlight) return
    // click toggles a frozen highlight
    if (hover && (!frozen || frozen.obj !== hover.obj)) setFrozen(hover)
    else setFrozen(null)
  }

  const zoomBy = (f: number): void =>
    setView((v) => ({ ...v, zoom: Math.min(2000, Math.max(0.2, v.zoom * f)) }))

  const info = frozen ?? (highlight ? hover : null)
  const measureLen = measure && (measure.b ?? cursor) ? dist(measure.a, (measure.b ?? cursor)!) : null

  return (
    <div ref={wrapRef} className={cn('relative h-full w-full overflow-hidden', className)}>
      <canvas
        ref={canvasRef}
        style={{
          width: size.w,
          height: size.h,
          cursor: measuring || onPick ? 'crosshair' : dragRef.current ? 'grabbing' : 'grab'
        }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          setHover(null)
          setCursor(null)
          dragRef.current = null
        }}
        onDoubleClick={doFit}
        data-testid="board-canvas"
      />
      <div className="absolute left-3 top-3 flex items-center gap-2">{toolbar}</div>
      {measuring && (!measure || !measure.b) && (
        <div className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 rounded-full border border-yellow-400/50 bg-slate-900/90 px-3 py-1 text-xs text-yellow-100 shadow-lg">
          {measure ? 'Click the second point' : 'Measure: click the first point'}
        </div>
      )}
      <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg border border-slate-700 bg-slate-900/90 p-1 shadow-lg">
        <Tooltip content="Zoom in (or scroll the mouse wheel)" side="left">
          <Button size="icon" variant="ghost" onClick={() => zoomBy(1.3)} aria-label="Zoom in">
            <ZoomIn />
          </Button>
        </Tooltip>
        <Tooltip content="Zoom out" side="left">
          <Button size="icon" variant="ghost" onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out">
            <ZoomOut />
          </Button>
        </Tooltip>
        <Tooltip content="Fit everything in view (or double-click the board)" side="left">
          <Button size="icon" variant="ghost" onClick={doFit} aria-label="Fit to view">
            <Maximize />
          </Button>
        </Tooltip>
        <Tooltip
          content="Measure: click two points to see the distance between them. Click the button again to stop."
          side="left"
        >
          <Button
            size="icon"
            variant={measuring ? 'default' : 'ghost'}
            onClick={() => {
              setMeasuring(!measuring)
              setMeasure(null)
            }}
            aria-label="Measure"
          >
            <Ruler />
          </Button>
        </Tooltip>
      </div>
      <div className="pointer-events-none absolute bottom-2 left-3 flex gap-3 rounded bg-slate-950/80 px-2 py-1 font-mono text-[11px] text-slate-400">
        <span>
          {side === 'top'
            ? 'TOP view'
            : side === 'bottom'
              ? 'BOTTOM view (mirrored)'
              : 'BOTH sides (seen from the top)'}
        </span>
        {cursor && (
          <span>
            X {lengthValue(cursor[0], units)} Y {lengthValue(cursor[1], units)} {unitLabel(units)}
          </span>
        )}
        {measureLen !== null && <span className="text-yellow-300">Δ {fmtLength(measureLen, units)}</span>}
        <span>{(view.zoom * 25.4).toFixed(0)} px/in</span>
      </div>
      {info && (
        <div className="pointer-events-none absolute bottom-9 left-3 max-w-sm rounded-md border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs text-slate-300 shadow-xl">
          <div className="font-semibold text-slate-100">
            {frozen ? 'Selected' : 'Hover'}:{' '}
            {info.obj.kind === 'flash' ? 'Pad' : info.obj.kind === 'region' ? 'Copper area' : 'Trace'}
            {info.obj.attributes?.['.N'] && (
              <span className="ml-1 text-sky-300">net {info.obj.attributes['.N']}</span>
            )}
          </div>
          <div className="mt-0.5 text-slate-400">
            Layer: {layers.find((l) => l.id === info.layerId)?.fileName}
            {info.obj.width ? ` · width ${info.obj.width.toFixed(3)} mm` : ''}
            {info.obj.attributes?.['.C'] ? ` · component ${info.obj.attributes['.C']}` : ''}
          </div>
          {frozen && (
            <div className="mt-1 text-[10px] text-slate-500">
              Click again (or click empty space) to release.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function sideRank(l: ImportedLayer, viewSide: 'top' | 'bottom'): number {
  if (l.side === viewSide) return 2
  if (l.side === 'all' || l.side === 'none') return 1
  return 0
}

function drawLayerFlat(ctx: CanvasRenderingContext2D, l: ImportedLayer, px: number): void {
  ctx.save()
  const translucent = l.type === 'soldermask' || l.type === 'paste' || l.type === 'fab'
  ctx.globalAlpha = translucent ? 0.45 : 0.85
  ctx.fillStyle = l.color
  ctx.strokeStyle = l.color
  if (l.type === 'drill') {
    const p = drillPath(l)
    ctx.globalAlpha = 1
    ctx.fillStyle = '#0b0f14'
    if (p) ctx.fill(p)
    ctx.lineWidth = 1.2 * px
    if (p) ctx.stroke(p)
    for (const s of slotPath(l)) {
      ctx.lineWidth = s.width
      ctx.lineCap = 'round'
      ctx.strokeStyle = '#0b0f14'
      ctx.stroke(s.path)
    }
  } else if (l.type === 'outline') {
    const s = strokesPath(l)
    ctx.globalAlpha = 1
    ctx.lineWidth = Math.max(1.5 * px, 0.1)
    if (s) ctx.stroke(s)
    else ctx.fill(polygonSetPath(l.parsed!.geometry))
  } else {
    ctx.fill(polygonSetPath(l.parsed!.geometry), 'nonzero')
  }
  ctx.restore()
}

/** "Both" in realistic colours: the bottom copper shows faintly through the board. */
function drawSeenThrough(ctx: CanvasRenderingContext2D, layers: ImportedLayer[], _px: number): void {
  const bottom = layers.filter((l) => l.type === 'copper' && l.side === 'bottom' && l.parsed)
  if (!bottom.length) return
  ctx.save()
  ctx.globalAlpha = 0.4
  ctx.fillStyle = '#7dd3fc'
  for (const l of bottom) ctx.fill(polygonSetPath(l.parsed!.geometry), 'nonzero')
  ctx.restore()
}

/** Realistic rendering of the visible side: FR4, green mask, gold pads, white silkscreen, holes. */
function drawRealistic(
  ctx: CanvasRenderingContext2D,
  layers: ImportedLayer[],
  side: 'top' | 'bottom',
  px: number
): void {
  const onSide = (l: ImportedLayer): boolean => l.side === side || l.side === 'all'
  const outline = layers.find((l) => l.type === 'outline')
  const copper = layers.filter((l) => l.type === 'copper' && onSide(l))
  const mask = layers.filter((l) => l.type === 'soldermask' && onSide(l))
  const silk = layers.filter((l) => l.type === 'silkscreen' && onSide(l))
  const drills = layers.filter((l) => l.type === 'drill')

  // Board body
  const bodyBox = outline?.parsed?.bbox ?? copper[0]?.parsed?.bbox
  if (bodyBox) {
    ctx.save()
    ctx.fillStyle = mask.length ? REAL.substrateUnderMask : REAL.fr4
    const outlinePoly = outline?.parsed?.geometry
    // Outline layers are usually thin lines; fill their bbox for the body.
    if (outlinePoly && outlinePoly.some((p) => p.holes.length > 0)) {
      // closed outline drawn as a filled band: fill the interior of the outer ring
      const inner = new Path2D()
      for (const p of outlinePoly) {
        for (const h of p.holes) {
          inner.moveTo(h[0].x, h[0].y)
          for (const v of h) inner.lineTo(v.x, v.y)
          inner.closePath()
        }
      }
      ctx.fill(inner)
    } else ctx.fillRect(bodyBox.minX, bodyBox.minY, bodyBox.maxX - bodyBox.minX, bodyBox.maxY - bodyBox.minY)
    ctx.restore()
  }

  // Copper: under mask it looks lighter green; without mask it is bare copper.
  for (const c of copper) {
    ctx.save()
    ctx.fillStyle = mask.length ? REAL.copperUnderMask : REAL.bareCopper
    ctx.fill(polygonSetPath(c.parsed!.geometry), 'nonzero')
    ctx.restore()
  }
  // Mask openings expose gold-plated copper.
  if (mask.length) {
    ctx.save()
    for (const m of mask) ctx.clip(polygonSetPath(m.parsed!.geometry), 'nonzero')
    ctx.fillStyle = REAL.exposedCopper
    for (const c of copper) ctx.fill(polygonSetPath(c.parsed!.geometry), 'nonzero')
    ctx.restore()
  }
  for (const s of silk) {
    ctx.save()
    ctx.fillStyle = REAL.silk
    ctx.fill(polygonSetPath(s.parsed!.geometry), 'nonzero')
    ctx.restore()
  }
  for (const d of drills) {
    const p = drillPath(d)
    ctx.save()
    ctx.fillStyle = REAL.hole
    if (p) ctx.fill(p)
    for (const s of slotPath(d)) {
      ctx.lineWidth = s.width
      ctx.lineCap = 'round'
      ctx.strokeStyle = REAL.hole
      ctx.stroke(s.path)
    }
    ctx.restore()
  }
  if (outline) {
    const s = strokesPath(outline)
    ctx.save()
    ctx.strokeStyle = '#d4d4aa'
    ctx.lineWidth = Math.max(px, 0.05)
    if (s) ctx.stroke(s)
    ctx.restore()
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, v: ViewTransform, w: number, h: number, dpr: number): void {
  // choose grid step so lines are 25..120 px apart
  const steps = [0.1, 0.5, 1, 5, 10, 50, 100]
  const step = steps.find((s) => s * v.zoom >= 25) ?? 100
  const [x0w, y1w] = screenToWorld(v, w, h, 0, 0)
  const [x1w, y0w] = screenToWorld(v, w, h, w, h)
  const minX = Math.min(x0w, x1w)
  const maxX = Math.max(x0w, x1w)
  ctx.save()
  ctx.lineWidth = 1
  for (let x = Math.floor(minX / step) * step; x <= maxX; x += step) {
    const [sx] = worldToScreen(v, w, h, x, 0)
    ctx.strokeStyle = Math.abs(x) < 1e-9 ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.07)'
    ctx.beginPath()
    ctx.moveTo(Math.round(sx * dpr) + 0.5, 0)
    ctx.lineTo(Math.round(sx * dpr) + 0.5, h * dpr)
    ctx.stroke()
  }
  for (let y = Math.floor(y0w / step) * step; y <= y1w; y += step) {
    const [, sy] = worldToScreen(v, w, h, 0, y)
    ctx.strokeStyle = Math.abs(y) < 1e-9 ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.07)'
    ctx.beginPath()
    ctx.moveTo(0, Math.round(sy * dpr) + 0.5)
    ctx.lineTo(w * dpr, Math.round(sy * dpr) + 0.5)
    ctx.stroke()
  }
  ctx.restore()
}
