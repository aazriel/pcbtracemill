import { useEffect, useMemo, useRef, useState } from 'react'
import type { HeightMap } from '@core/model/types'
import { probePoints, sampleHeight } from '@core/heightmap'
import { mapRange, turbo, um, type WorkScene } from './geometry'

/**
 * 2D colour heat map of the measured surface in work coordinates, with the stock, the board outline,
 * the probe points and the work origin drawn on top. Hover shows the height under the cursor.
 */
export function HeatMap({ map, scene }: { map: HeightMap; scene: WorkScene | null }): React.JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 400, h: 300 })
  const [hover, setHover] = useState<{ x: number; y: number; px: number; py: number; z: number } | null>(null)
  const range = useMemo(() => mapRange(map), [map])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // World bounds and world→screen transform.
  const view = useMemo(() => {
    const c = map.config
    const b = scene
      ? {
          minX: Math.min(scene.stock.minX, c.minX),
          minY: Math.min(scene.stock.minY, c.minY),
          maxX: Math.max(scene.stock.maxX, c.maxX),
          maxY: Math.max(scene.stock.maxY, c.maxY)
        }
      : { minX: c.minX, minY: c.minY, maxX: c.maxX, maxY: c.maxY }
    const pad = 14
    const w = Math.max(1, b.maxX - b.minX)
    const h = Math.max(1, b.maxY - b.minY)
    const k = Math.min((size.w - 2 * pad) / w, (size.h - 2 * pad) / h)
    const ox = (size.w - w * k) / 2 - b.minX * k
    const oy = (size.h + h * k) / 2 + b.minY * k
    return { k, ox, oy, sx: (x: number) => ox + x * k, sy: (y: number) => oy - y * k }
  }, [map, scene, size])

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.max(1, Math.round(size.w * dpr))
    cv.height = Math.max(1, Math.round(size.h * dpr))
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    const { sx, sy, k } = view
    const c = map.config

    // stock
    if (scene) {
      const s = scene.stock
      ctx.fillStyle = 'rgba(184,115,51,0.16)'
      ctx.fillRect(sx(s.minX), sy(s.maxY), (s.maxX - s.minX) * k, (s.maxY - s.minY) * k)
      ctx.setLineDash([5, 4])
      ctx.strokeStyle = 'rgba(217,149,84,0.8)'
      ctx.strokeRect(sx(s.minX), sy(s.maxY), (s.maxX - s.minX) * k, (s.maxY - s.minY) * k)
      ctx.setLineDash([])
    }

    // raster of the interpolated surface
    const pw = Math.max(2, Math.min(512, Math.round((c.maxX - c.minX) * k)))
    const ph = Math.max(2, Math.min(512, Math.round((c.maxY - c.minY) * k)))
    const off = document.createElement('canvas')
    off.width = pw
    off.height = ph
    const octx = off.getContext('2d')
    if (octx) {
      const img = octx.createImageData(pw, ph)
      for (let j = 0; j < ph; j++) {
        const y = c.maxY - ((j + 0.5) / ph) * (c.maxY - c.minY)
        for (let i = 0; i < pw; i++) {
          const x = c.minX + ((i + 0.5) / pw) * (c.maxX - c.minX)
          const [r, g, b] = turbo(range.norm(sampleHeight(map, x, y)))
          const o = (j * pw + i) * 4
          img.data[o] = r
          img.data[o + 1] = g
          img.data[o + 2] = b
          img.data[o + 3] = 235
        }
      }
      octx.putImageData(img, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(off, sx(c.minX), sy(c.maxY), (c.maxX - c.minX) * k, (c.maxY - c.minY) * k)
    }

    // board outline
    if (scene) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (const ring of scene.outline)
        ring.forEach((q, i) => (i ? ctx.lineTo(sx(q.x), sy(q.y)) : ctx.moveTo(sx(q.x), sy(q.y))))
      ctx.stroke()
    }

    // probe points
    const pts = probePoints(c)
    const r = Math.max(
      1.5,
      Math.min(3.5, (k * Math.min(c.maxX - c.minX, c.maxY - c.minY)) / Math.max(c.countX, c.countY) / 8)
    )
    for (const p of pts) {
      ctx.beginPath()
      ctx.arc(sx(p.x), sy(p.y), r, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(15,23,42,0.85)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // origin
    const L = 28
    ctx.lineWidth = 2
    ctx.strokeStyle = '#f87171'
    ctx.beginPath()
    ctx.moveTo(sx(0), sy(0))
    ctx.lineTo(sx(0) + L, sy(0))
    ctx.stroke()
    ctx.strokeStyle = '#4ade80'
    ctx.beginPath()
    ctx.moveTo(sx(0), sy(0))
    ctx.lineTo(sx(0), sy(0) - L)
    ctx.stroke()
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '10px ui-sans-serif, system-ui'
    ctx.fillText('X0 Y0', sx(0) + 4, sy(0) + 12)
  }, [map, scene, view, size, range])

  const onMove = (e: React.MouseEvent): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const x = (px - view.ox) / view.k
    const y = (view.oy - py) / view.k
    const c = map.config
    if (x < c.minX || x > c.maxX || y < c.minY || y > c.maxY) return setHover(null)
    setHover({ x, y, px, py, z: sampleHeight(map, x, y) })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div
        ref={wrap}
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-800 bg-slate-950"
        data-testid="heightmap-heat"
      >
        <canvas
          ref={canvas}
          style={{ width: size.w, height: size.h }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          className="block cursor-crosshair"
        />
        {hover && (
          <div
            className="pointer-events-none absolute rounded bg-slate-900/95 px-2 py-1 font-mono text-[11px] text-slate-200 shadow"
            style={{ left: Math.min(hover.px + 12, size.w - 150), top: Math.max(4, hover.py - 34) }}
          >
            X{hover.x.toFixed(1)} Y{hover.y.toFixed(1)} · <b>{um(hover.z, true)}</b>
          </div>
        )}
      </div>
      <ColorLegend min={range.min} max={range.max} />
    </div>
  )
}

export function ColorLegend({ min, max }: { min: number; max: number }): React.JSX.Element {
  const stops = Array.from({ length: 11 }, (_, i) => {
    const [r, g, b] = turbo(i / 10)
    return `rgb(${r},${g},${b}) ${i * 10}%`
  }).join(', ')
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-400">
      <span className="font-mono">{um(min, true)}</span>
      <div className="h-2.5 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${stops})` }} />
      <span className="font-mono">{um(max, true)}</span>
      <span className="text-slate-500">· lower ← → higher than point 1</span>
    </div>
  )
}
