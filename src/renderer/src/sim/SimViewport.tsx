/**
 * The simulation viewport: WebGL board (SimGL) + 2D overlay (tool path trail, and the tool in the
 * top view). Two cameras:
 *  - 3D (default): orbit camera. Left-drag rotates, right-drag (or Shift+drag) pans, the wheel
 *    zooms towards the cursor. The cutter is drawn in 3D by the shader.
 *  - Top view: straight down like a real 3-axis machine bed. Drag pans, the wheel zooms.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Crosshair, Maximize, Minus, Plus } from 'lucide-react'
import type { Tool } from '@core/model/types'
import { lengthValue, unitLabel, useUnits } from '@renderer/lib/units'
import { Button } from '@renderer/components/ui/button'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { SimGL, sunDirection, type SimToolShape } from './SimGL'
import { simEngine, toolStateAt, useSim, type ToolState } from './engine'
import { drawTool, drawTrail, toStock, type OverlayView } from './overlay'
import {
  MAX_PITCH,
  MIN_PITCH,
  basis,
  fitOrbit,
  pickPlane,
  project,
  type CamBasis,
  type Orbit
} from './camera3d'

interface View {
  cx: number
  cy: number
  zoom: number
}

declare global {
  interface Window {
    /** Automation hook (smoke tests / screenshots). */
    __tmSim?: {
      engine: typeof simEngine
      state: typeof useSim
      /** Centre the view on a stock point (mm) with a zoom in px/mm (top view). */
      setView(cx: number, cy: number, zoom: number): void
      /** Sets the 3D orbit camera (angles in degrees). */
      setOrbit(o: Partial<{ tx: number; ty: number; yaw: number; pitch: number; dist: number }>): void
      fit(): void
      zoomToTool(zoom?: number): void
      /** Converts a viewport CSS pixel position to stock millimetres (on the copper plane in 3D). */
      screenToStock(sx: number, sy: number): [number, number] | null
    }
  }
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 600
const MIN_DIST = 2
const MAX_DIST = 3000

function toolShape(tool: Tool | null, ts: ToolState, spin: number): SimToolShape | null {
  if (!tool) return null
  const g = tool.geometry
  const R = Math.max(0.02, g.diameter / 2)
  const base = {
    x: ts.x,
    y: ts.y,
    z: ts.z,
    radius: R,
    fluteLength: Math.max(0.5, g.fluteLength || R * 4),
    flutes: Math.max(1, Math.min(6, g.flutes || 2)),
    spin,
    cutting: ts.z < -1e-4 && ts.kind === 'feed'
  }
  switch (tool.type) {
    case 'vbit':
      return {
        ...base,
        shape: 'cone',
        tipRadius: Math.max(0.005, (g.tipDiameter ?? 0) / 2),
        slope: Math.tan(((g.tipAngle ?? 60) * Math.PI) / 360)
      }
    case 'drill':
      return {
        ...base,
        shape: 'cone',
        tipRadius: 0.005,
        slope: Math.tan(((g.pointAngle ?? 118) * Math.PI) / 360)
      }
    case 'ball':
      return { ...base, shape: 'ball', tipRadius: R, slope: 0 }
    default:
      return { ...base, shape: 'straight', tipRadius: R, slope: 0 }
  }
}

export function SimViewport(): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const glCanvas = useRef<HTMLCanvasElement>(null)
  const ovCanvas = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<SimGL | null>(null)
  const viewRef = useRef<View>({ cx: 50, cy: 40, zoom: 8 })
  const orbitRef = useRef<Orbit>(fitOrbit(100, 80, 1.6, 800, 600))
  const sizeRef = useRef({ w: 1, h: 1 })
  const userMoved = useRef(false)
  const dirty = useRef({ gl: true, ov: true })
  const [glError, setGlError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  const status = useSim((s) => s.status)
  const data = useSim((s) => s.data)
  const view3d = useSim((s) => s.view3d)
  const units = useUnits()

  const markDirty = useCallback(() => {
    dirty.current.gl = true
    dirty.current.ov = true
  }, [])

  const cam = (): CamBasis => basis(orbitRef.current)

  /** Screen → stock mm (copper plane in 3D). */
  const screenToStock = useCallback((sx: number, sy: number): [number, number] | null => {
    const { w, h } = sizeRef.current
    if (useSim.getState().view3d) return pickPlane(basis(orbitRef.current), w, h, sx, sy, 0)
    return toStock({ ...viewRef.current, width: w, height: h }, sx, sy)
  }, [])

  const fit = useCallback(() => {
    const d = useSim.getState().data
    const { w, h } = sizeRef.current
    if (!d || w < 2 || h < 2) return
    const margin = 6
    const zoom = Math.min(w / (d.stock.width + margin * 2), h / (d.stock.height + margin * 2))
    viewRef.current = { cx: d.stock.width / 2, cy: d.stock.height / 2, zoom: Math.max(MIN_ZOOM, zoom) }
    orbitRef.current = fitOrbit(d.stock.width, d.stock.height, d.stock.thickness, w, h)
    userMoved.current = false
    markDirty()
  }, [markDirty])

  const zoomToTool = useCallback(
    (zoom = 40) => {
      const s = useSim.getState()
      if (!s.data) return
      const ts = toolStateAt(s.data, s.time)
      if (!ts) return
      viewRef.current = { cx: ts.x, cy: ts.y, zoom }
      const o = orbitRef.current
      orbitRef.current = { ...o, tx: ts.x, ty: ts.y, tz: 0, dist: Math.max(MIN_DIST, 600 / zoom) }
      userMoved.current = true
      markDirty()
    },
    [markDirty]
  )

  const zoomBy = useCallback(
    (f: number) => {
      const v = viewRef.current
      v.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * f))
      const o = orbitRef.current
      o.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, o.dist / f))
      userMoved.current = true
      markDirty()
    },
    [markDirty]
  )

  // WebGL lifetime
  useEffect(() => {
    const c = glCanvas.current
    if (!c) return
    let gl: SimGL
    try {
      gl = new SimGL(c)
    } catch (e) {
      setGlError(e instanceof Error ? e.message : String(e))
      return
    }
    glRef.current = gl
    void simEngine.attach(gl)
    dirty.current.gl = true
    return () => {
      simEngine.detach(gl)
      gl.dispose()
      glRef.current = null
    }
  }, [])

  // Size tracking
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      sizeRef.current = { w: el.clientWidth, h: el.clientHeight }
      if (!userMoved.current) fit()
      markDirty()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit, markDirty])

  // Fit when a new program is loaded
  useEffect(() => {
    if (data) fit()
  }, [data, fit])

  // Redraw when display options change
  useEffect(
    () =>
      useSim.subscribe((s, p) => {
        if (
          s.side !== p.side ||
          s.showDesign !== p.showDesign ||
          s.data !== p.data ||
          s.view3d !== p.view3d ||
          s.lightAz !== p.lightAz ||
          s.lightEl !== p.lightEl ||
          (s.view3d && (s.time !== p.time || s.showTool !== p.showTool))
        )
          dirty.current.gl = true
        if (
          s.time !== p.time ||
          s.side !== p.side ||
          s.showTool !== p.showTool ||
          s.showTrail !== p.showTrail ||
          s.showRapids !== p.showRapids ||
          s.data !== p.data ||
          s.view3d !== p.view3d
        )
          dirty.current.ov = true
      }),
    []
  )

  // Render loop
  useEffect(() => {
    let raf = 0
    let spin = 0
    let last = performance.now()
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame)
      const dt = (now - last) / 1000
      last = now
      const s = useSim.getState()
      const { w, h } = sizeRef.current
      const dpr = window.devicePixelRatio || 1
      const v = viewRef.current
      const o = orbitRef.current
      const gl = glRef.current
      const ts = s.data ? toolStateAt(s.data, s.time) : null
      // Zoomed in while playing with "Follow" on: keep the tool in view by re-centring on it.
      if (s.playing && s.follow && userMoved.current && ts && ts.side === s.side) {
        if (s.view3d) {
          const p = project(basis(o), w, h, ts.x, ts.y, 0)
          if (!p || Math.abs(p[0] - w / 2) > w * 0.38 || Math.abs(p[1] - h / 2) > h * 0.38) {
            o.tx = ts.x
            o.ty = ts.y
            o.tz = 0
            markDirty()
          }
        } else {
          const sx = (ts.x - v.cx) * v.zoom
          const sy = (ts.y - v.cy) * v.zoom
          if (Math.abs(sx) > w * 0.38 || Math.abs(sy) > h * 0.38) {
            v.cx = ts.x
            v.cy = ts.y
            markDirty()
          }
        }
      }
      const spinning = s.playing && !!ts && ts.toolId !== null
      if (spinning) {
        spin += dt * 9
        dirty.current.ov = true
        if (s.view3d) dirty.current.gl = true
      }
      const camB = s.view3d ? basis(o) : null
      if (gl && (dirty.current.gl || simEngine.glDirty)) {
        dirty.current.gl = false
        simEngine.glDirty = false
        const tool =
          camB && s.showTool && ts && ts.side === s.side && ts.toolId && s.data
            ? toolShape(s.data.tools.get(ts.toolId)?.tool ?? null, ts, spin)
            : null
        gl.draw(v, w, h, dpr, {
          side: s.side,
          showDesign: s.showDesign,
          camera: camB,
          tool,
          light: sunDirection(s.lightAz, s.lightEl)
        })
      }
      const oc = ovCanvas.current
      if (!oc || !dirty.current.ov) return
      dirty.current.ov = false
      const W = Math.max(1, Math.floor(w * dpr))
      const H = Math.max(1, Math.floor(h * dpr))
      if (oc.width !== W) oc.width = W
      if (oc.height !== H) oc.height = H
      const ctx = oc.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (!s.data || !ts || ts.side !== s.side) return
      const ov: OverlayView = {
        ...v,
        width: w,
        height: h,
        project: camB ? (x, y, z) => project(camB, w, h, x, y, z) : undefined
      }
      const step = ts.stepId ? s.data.stepById.get(ts.stepId) : undefined
      if (s.showTrail) drawTrail(ctx, ov, s.data, ts, step?.color ?? '#38bdf8', s.showRapids)
      if (s.showTool && !camB) {
        const tool = ts.toolId ? (s.data.tools.get(ts.toolId)?.tool ?? null) : null
        drawTool(ctx, ov, ts, tool, spin, s.data.stock.copperThickness)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [markDirty])

  // Automation hook
  useEffect(() => {
    window.__tmSim = {
      engine: simEngine,
      state: useSim,
      setView: (cx, cy, zoom) => {
        viewRef.current = { cx, cy, zoom }
        userMoved.current = true
        markDirty()
      },
      setOrbit: (p) => {
        const o = orbitRef.current
        if (p.tx !== undefined) o.tx = p.tx
        if (p.ty !== undefined) o.ty = p.ty
        if (p.yaw !== undefined) o.yaw = (p.yaw * Math.PI) / 180
        if (p.pitch !== undefined)
          o.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, (p.pitch * Math.PI) / 180))
        if (p.dist !== undefined) o.dist = p.dist
        userMoved.current = true
        markDirty()
      },
      fit,
      zoomToTool,
      screenToStock
    }
    return () => {
      delete window.__tmSim
    }
  }, [fit, zoomToTool, markDirty, screenToStock])

  // Pointer interaction
  const drag = useRef<{ x: number; y: number; mode: 'pan' | 'orbit' | 'light' } | null>(null)
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const orbit = useSim.getState().view3d && e.button === 0 && !e.shiftKey
    // Alt+drag moves the sun around the board
    const mode = e.button === 0 && e.altKey ? 'light' : orbit ? 'orbit' : 'pan'
    drag.current = { x: e.clientX, y: e.clientY, mode }
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (r) {
      const p = screenToStock(e.clientX - r.left, e.clientY - r.top)
      setCursor(p ? { x: p[0], y: p[1] } : null)
    }
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    d.x = e.clientX
    d.y = e.clientY
    if (d.mode === 'light') {
      const st = useSim.getState()
      st.set({
        lightAz: (((st.lightAz - dx * 0.5) % 360) + 360) % 360,
        lightEl: Math.max(5, Math.min(88, st.lightEl - dy * 0.3))
      })
      return
    }
    if (useSim.getState().view3d) {
      const o = orbitRef.current
      if (d.mode === 'orbit') {
        o.yaw -= dx * 0.006
        o.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, o.pitch + dy * 0.006))
      } else {
        const b = cam()
        const scale = (o.dist * b.tanHalf) / (sizeRef.current.h / 2)
        const fx = -Math.sin(o.yaw)
        const fy = Math.cos(o.yaw)
        const k = scale / Math.max(0.35, Math.sin(o.pitch))
        o.tx += -b.r[0] * dx * scale + fx * dy * k
        o.ty += -b.r[1] * dx * scale + fy * dy * k
      }
    } else {
      const v = viewRef.current
      v.cx -= dx / v.zoom
      v.cy += dy / v.zoom
    }
    userMoved.current = true
    markDirty()
  }
  const onPointerUp = (): void => {
    drag.current = null
  }
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const sx = e.clientX - r.left
      const sy = e.clientY - r.top
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015))
      if (useSim.getState().view3d) {
        const o = orbitRef.current
        const p = pickPlane(basis(o), r.width, r.height, sx, sy, o.tz)
        const nd = Math.max(MIN_DIST, Math.min(MAX_DIST, o.dist / f))
        const k = 1 - nd / o.dist
        if (p) {
          // move the orbit centre towards the point under the cursor so it stays put
          o.tx += (p[0] - o.tx) * k
          o.ty += (p[1] - o.ty) * k
        }
        o.dist = nd
      } else {
        const v = viewRef.current
        const ov: OverlayView = { ...v, width: r.width, height: r.height }
        const [wx, wy] = toStock(ov, sx, sy)
        const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * f))
        // keep the point under the cursor fixed
        v.cx = wx - (sx - r.width / 2) / z
        v.cy = wy + (sy - r.height / 2) / z
        v.zoom = z
      }
      userMoved.current = true
      markDirty()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [markDirty])

  const origin = data?.origin
  const setMode = (v3: boolean): void => useSim.getState().set({ view3d: v3 })
  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 cursor-grab touch-none select-none overflow-hidden bg-slate-950 active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setCursor(null)}
      onDoubleClick={fit}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={glCanvas} className="absolute inset-0 h-full w-full" data-testid="sim-canvas" />
      <canvas ref={ovCanvas} className="pointer-events-none absolute inset-0 h-full w-full" />
      {glError && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-rose-300">
          The 3D preview could not start: {glError}
        </div>
      )}
      <div
        className="absolute bottom-3 right-3 flex flex-col gap-1 rounded-lg border border-slate-700/80 bg-slate-900/95 p-1 shadow-lg"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex flex-col gap-0.5 rounded-md bg-slate-950/70 p-0.5"
          role="radiogroup"
          aria-label="View"
          data-testid="sim-view-mode"
        >
          {(
            [
              {
                v3: true,
                label: '3D',
                help: '3D view: drag to rotate, right-drag (or Shift+drag) to pan, scroll to zoom'
              },
              {
                v3: false,
                label: '2D',
                help: 'Flat top view, looking straight down at the machine bed: drag to pan, scroll to zoom'
              }
            ] as const
          ).map((m) => (
            <Tooltip key={m.label} content={m.help} side="left">
              <button
                type="button"
                role="radio"
                aria-checked={view3d === m.v3}
                onClick={() => setMode(m.v3)}
                data-testid={`sim-view-${m.label.toLowerCase()}`}
                className={cn(
                  'h-7 w-9 rounded text-[11px] font-semibold tracking-wide transition-colors',
                  view3d === m.v3 ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-100'
                )}
              >
                {m.label}
              </button>
            </Tooltip>
          ))}
        </div>
        <div className="mx-1 my-0.5 h-px bg-slate-700/80" />
        <Tooltip content="Zoom in (or scroll the mouse wheel over the board)" side="left">
          <Button size="icon" variant="ghost" onClick={() => zoomBy(1.5)} aria-label="Zoom in">
            <Plus />
          </Button>
        </Tooltip>
        <Tooltip content="Zoom out" side="left">
          <Button size="icon" variant="ghost" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out">
            <Minus />
          </Button>
        </Tooltip>
        <Tooltip content="Fit the whole material in the view (or double-click the board)" side="left">
          <Button size="icon" variant="ghost" onClick={fit} aria-label="Fit to view" data-testid="sim-fit">
            <Maximize />
          </Button>
        </Tooltip>
        <Tooltip content="Zoom in close to the cutting tool to watch it remove material" side="left">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => zoomToTool()}
            aria-label="Zoom to tool"
            data-testid="sim-zoom-tool"
          >
            <Crosshair />
          </Button>
        </Tooltip>
      </div>
      {view3d && status === 'ready' && (
        <div className="pointer-events-none absolute right-16 bottom-3 rounded bg-slate-900/70 px-2 py-1 text-[11px] text-slate-400">
          Drag: rotate · Right-drag: pan · Scroll: zoom · Alt+drag: move the sun
        </div>
      )}
      {cursor && origin && status === 'ready' && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-slate-900/80 px-2 py-1 font-mono text-[11px] text-slate-300">
          cursor X {lengthValue(cursor.x - origin.x, units, 2)} Y {lengthValue(cursor.y - origin.y, units, 2)}{' '}
          {unitLabel(units)}
        </div>
      )}
    </div>
  )
}
