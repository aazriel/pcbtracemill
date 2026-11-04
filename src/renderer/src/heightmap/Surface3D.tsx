import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { HeightMap } from '@core/model/types'
import { gridStep, sampleHeight } from '@core/heightmap'
import { mapRange, turbo, type WorkScene } from './geometry'

interface Ctx {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  content: THREE.Group
  render(): void
}

function textSprite(text: string, color: string, size: number): THREE.Sprite {
  const cv = document.createElement('canvas')
  cv.width = 128
  cv.height = 64
  const g = cv.getContext('2d')!
  g.font = 'bold 40px ui-sans-serif, system-ui'
  g.fillStyle = color
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 64, 32)
  const tex = new THREE.CanvasTexture(cv)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  sp.scale.set(size * 2, size, 1)
  return sp
}

function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh
    // Sprites share one module-level geometry inside three.js; never dispose it.
    if (!(o instanceof THREE.Sprite)) m.geometry?.dispose()
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
    for (const mat of mats) {
      ;(mat as THREE.SpriteMaterial).map?.dispose()
      mat.dispose()
    }
  })
  g.clear()
}

function lineLoop(pts: [number, number, number][], color: number, opacity = 1): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p)))
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }))
}

/** Build the surface mesh, probe-grid lines, points, base outlines and axes (Z exaggerated). */
function buildContent(group: THREE.Group, map: HeightMap, scene: WorkScene | null, exag: number): void {
  const c = map.config
  const r = mapRange(map)
  const zOf = (z: number): number => (z - r.min) * exag
  const nx = Math.max(2, Math.min(120, (c.countX - 1) * 6 + 1))
  const ny = Math.max(2, Math.min(120, (c.countY - 1) * 6 + 1))
  const pos = new Float32Array(nx * ny * 3)
  const col = new Float32Array(nx * ny * 3)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = c.minX + (i / (nx - 1)) * (c.maxX - c.minX)
      const y = c.minY + (j / (ny - 1)) * (c.maxY - c.minY)
      const z = sampleHeight(map, x, y)
      const k = (j * nx + i) * 3
      pos[k] = x
      pos[k + 1] = y
      pos[k + 2] = zOf(z)
      const [cr, cg, cb] = turbo(r.norm(z))
      col[k] = cr / 255
      col[k + 1] = cg / 255
      col[k + 2] = cb / 255
    }
  const idx: number[] = []
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      idx.push(a, a + 1, a + nx + 1, a, a + nx + 1, a + nx)
    }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  group.add(
    new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }))
  )

  // probe grid lines following the surface
  const lift = 0.02 * exag * Math.max(r.range, 0.01)
  const { dx, dy } = gridStep(c)
  const segs: number[] = []
  const sub = 12
  for (let iy = 0; iy < c.countY; iy++) {
    const y = c.minY + iy * dy
    for (let s = 0; s < (c.countX - 1) * sub; s++) {
      const x0 = c.minX + (s / sub) * dx
      const x1 = c.minX + ((s + 1) / sub) * dx
      segs.push(x0, y, zOf(sampleHeight(map, x0, y)) + lift, x1, y, zOf(sampleHeight(map, x1, y)) + lift)
    }
  }
  for (let ix = 0; ix < c.countX; ix++) {
    const x = c.minX + ix * dx
    for (let s = 0; s < (c.countY - 1) * sub; s++) {
      const y0 = c.minY + (s / sub) * dy
      const y1 = c.minY + ((s + 1) / sub) * dy
      segs.push(x, y0, zOf(sampleHeight(map, x, y0)) + lift, x, y1, zOf(sampleHeight(map, x, y1)) + lift)
    }
  }
  const lg = new THREE.BufferGeometry()
  lg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3))
  group.add(
    new THREE.LineSegments(
      lg,
      new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.55 })
    )
  )

  // measured points
  const pp: number[] = []
  for (let iy = 0; iy < c.countY; iy++)
    for (let ix = 0; ix < c.countX; ix++)
      pp.push(c.minX + ix * dx, c.minY + iy * dy, zOf(map.z[iy * c.countX + ix]) + lift)
  const pg = new THREE.BufferGeometry()
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3))
  group.add(
    new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffffff, size: 4, sizeAttenuation: false }))
  )

  // base: stock and board outline on the floor (z = 0 = lowest measured point)
  const floor = -0.05 * Math.max(c.maxX - c.minX, c.maxY - c.minY) * 0.1
  if (scene) {
    const s = scene.stock
    group.add(
      lineLoop(
        [
          [s.minX, s.minY, floor],
          [s.maxX, s.minY, floor],
          [s.maxX, s.maxY, floor],
          [s.minX, s.maxY, floor],
          [s.minX, s.minY, floor]
        ],
        0xd99554,
        0.8
      )
    )
    for (const ring of scene.outline)
      group.add(
        lineLoop(
          ring.map((q) => [q.x, q.y, floor]),
          0x34d399,
          0.9
        )
      )
  }

  // axes at the work origin
  const span = Math.max(c.maxX - c.minX, c.maxY - c.minY, 10)
  const L = span * 0.18
  group.add(
    lineLoop(
      [
        [0, 0, floor],
        [L, 0, floor]
      ],
      0xf87171
    )
  )
  group.add(
    lineLoop(
      [
        [0, 0, floor],
        [0, L, floor]
      ],
      0x4ade80
    )
  )
  group.add(
    lineLoop(
      [
        [0, 0, floor],
        [0, 0, L * 0.7]
      ],
      0x60a5fa
    )
  )
  const fs = span * 0.04
  const sx = textSprite('X', '#fca5a5', fs)
  sx.position.set(L + fs, 0, floor)
  const sy = textSprite('Y', '#86efac', fs)
  sy.position.set(0, L + fs, floor)
  const sz = textSprite(`Z ×${exag}`, '#93c5fd', fs)
  sz.position.set(0, 0, L * 0.7 + fs)
  group.add(sx, sy, sz)
}

/** three.js view of the height map; drag to orbit, wheel to zoom, right-drag to pan. */
export function Surface3D({
  map,
  scene,
  exaggeration
}: {
  map: HeightMap
  scene: WorkScene | null
  exaggeration: number
}): React.JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const ctxRef = useRef<Ctx | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      el.textContent = '3D view is not available (WebGL is disabled).'
      return
    }
    renderer.setPixelRatio(window.devicePixelRatio || 1)
    el.appendChild(renderer.domElement)
    const scene3 = new THREE.Scene()
    scene3.add(new THREE.AmbientLight(0xffffff, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(-1, -2, 3)
    scene3.add(sun)
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000)
    camera.up.set(0, 0, 1)
    const controls = new OrbitControls(camera, renderer.domElement)
    const content = new THREE.Group()
    scene3.add(content)
    const render = (): void => renderer.render(scene3, camera)
    controls.addEventListener('change', render)
    const ctx: Ctx = { renderer, scene: scene3, camera, controls, content, render }
    ctxRef.current = ctx
    const resize = (): void => {
      const w = Math.max(1, el.clientWidth)
      const h = Math.max(1, el.clientHeight)
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      render()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()
    return () => {
      ro.disconnect()
      controls.dispose()
      disposeGroup(content)
      renderer.dispose()
      renderer.domElement.remove()
      ctxRef.current = null
    }
  }, [])

  // Re-frame the camera when the map changes.
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const c = map.config
    const cx = (c.minX + c.maxX) / 2
    const cy = (c.minY + c.maxY) / 2
    const span = Math.max(c.maxX - c.minX, c.maxY - c.minY, 10)
    ctx.controls.target.set(cx, cy, 0)
    ctx.camera.position.set(cx - span * 0.6, cy - span * 1.3, span * 0.95)
    ctx.camera.near = span / 1000
    ctx.camera.far = span * 50
    ctx.camera.updateProjectionMatrix()
    ctx.controls.update()
  }, [map])

  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    disposeGroup(ctx.content)
    buildContent(ctx.content, map, scene, exaggeration)
    ctx.render()
  }, [map, scene, exaggeration])

  return (
    <div
      ref={wrap}
      data-testid="heightmap-3d"
      className="relative h-full min-h-0 w-full cursor-grab overflow-hidden rounded-lg border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 active:cursor-grabbing"
    />
  )
}
