/**
 * Centre lines of the gaps between DIFFERENT copper features (Voronoi isolation, D-034).
 *
 * The copper outlines are sampled densely and labelled with their feature (polygon index). In the
 * Voronoi diagram of those points, an edge between two points of different features is part of
 * the line that is equally far from both features – the middle of the gap. Edges are kept where
 * the gap is at most `maxGap` wide and chained into polylines.
 */
import Delaunator from 'delaunator'
import type { Path, PolygonSet, Vec2 } from '../model/types'
import { offset, pathArea, unionPaths } from '../geometry'
import { simplifyPath } from './pathUtils'

export interface CenterlineOptions {
  /** Only gaps up to this wide (mm). */
  maxGap: number
  /** Distance between samples along the copper outlines (mm). */
  spacing?: number
}

function sampleRing(ring: Path, step: number, label: number, xs: number[], labels: number[]): void {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.max(1, Math.ceil(len / step))
    for (let k = 0; k < n; k++) {
      xs.push(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n)
      labels.push(label)
    }
  }
}

/** Polylines along the middle of every gap narrower than `maxGap` between two copper features. */
export function gapCenterlines(copper: PolygonSet, o: CenterlineOptions): Path[] {
  return gapMiddles(copper, o).lines
}

/**
 * The middle lines of the narrow gaps, and the area they run through: the Delaunay triangles that
 * span a narrow gap between two different features (their corners lie on both features). A pass
 * along the copper inside that area is replaced by the middle line; slots inside ONE feature
 * (thermal reliefs) are not part of it.
 */
export function gapMiddles(copper: PolygonSet, o: CenterlineOptions): { lines: Path[]; zone: PolygonSet } {
  if (copper.length < 2) return { lines: [], zone: [] }
  const step = o.spacing && o.spacing > 0 ? o.spacing : Math.min(0.05, o.maxGap / 8)
  const xs: number[] = []
  const labels: number[] = []
  copper.forEach((poly, i) => {
    sampleRing(poly.outer, step, i, xs, labels)
    for (const h of poly.holes) sampleRing(h, step, i, xs, labels)
  })
  if (labels.length < 3) return { lines: [], zone: [] }
  const coords = Float64Array.from(xs)
  const d = new Delaunator(coords)
  const tri = d.triangles
  const nT = tri.length / 3
  // circumcentre and circumradius of every triangle
  const cx = new Float64Array(nT)
  const cy = new Float64Array(nT)
  const cr = new Float64Array(nT)
  for (let t = 0; t < nT; t++) {
    const a = tri[3 * t]
    const b = tri[3 * t + 1]
    const c = tri[3 * t + 2]
    const ax = coords[2 * a]
    const ay = coords[2 * a + 1]
    const bx = coords[2 * b] - ax
    const by = coords[2 * b + 1] - ay
    const qx = coords[2 * c] - ax
    const qy = coords[2 * c + 1] - ay
    const den = 2 * (bx * qy - by * qx)
    if (Math.abs(den) < 1e-18) {
      cr[t] = Infinity
      continue
    }
    const b2 = bx * bx + by * by
    const q2 = qx * qx + qy * qy
    const ux = (qy * b2 - by * q2) / den
    const uy = (bx * q2 - qx * b2) / den
    cx[t] = ax + ux
    cy[t] = ay + uy
    cr[t] = Math.hypot(ux, uy)
  }
  const half = o.maxGap / 2
  // zone = triangles spanning a narrow gap between different features; its outline is traced
  // from the triangle neighbours (much faster than merging the triangles with polygon booleans)
  const inZone = new Uint8Array(nT)
  for (let t = 0; t < nT; t++) {
    if (!(cr[t] <= half)) continue
    const a = tri[3 * t]
    const b = tri[3 * t + 1]
    const c = tri[3 * t + 2]
    if (labels[a] === labels[b] && labels[b] === labels[c]) continue
    inZone[t] = 1
  }
  const nextFrom = new Map<number, number[]>() // boundary half-edges by start vertex
  for (let e = 0; e < tri.length; e++) {
    if (!inZone[Math.floor(e / 3)]) continue
    const o = d.halfedges[e]
    if (o >= 0 && inZone[Math.floor(o / 3)]) continue
    const from = tri[e]
    const l = nextFrom.get(from)
    if (l) l.push(e)
    else nextFrom.set(from, [e])
  }
  const ringsOut: Path[] = []
  const usedE = new Set<number>()
  for (const list of nextFrom.values())
    for (const e0 of list) {
      if (usedE.has(e0)) continue
      const ring: Path = []
      let e = e0
      for (let guard = 0; guard < tri.length; guard++) {
        usedE.add(e)
        const v = tri[e]
        ring.push({ x: coords[2 * v], y: coords[2 * v + 1] })
        const to = tri[e % 3 === 2 ? e - 2 : e + 1]
        const cand = (nextFrom.get(to) ?? []).filter((x) => !usedE.has(x))
        if (!cand.length) break
        e = cand[0]
      }
      if (ring.length >= 3) ringsOut.push(ring)
    }
  // close the small notches and holes the triangles leave at copper corners (each would leave a
  // short piece of the pass with its own plunge)
  const close = Math.min(0.1, half / 4)
  // the outline runs through every sample point; straight runs need only their ends
  const raw = ringsOut.length ? unionPaths(ringsOut.map((r) => simplifyPath(r, 0.003, true))) : []
  const zone = raw.length
    ? offset(offset(raw, close), -close).map((poly) => ({
        outer: poly.outer,
        holes: poly.holes.filter((h) => Math.abs(pathArea(h)) > half * half)
      }))
    : []
  // Voronoi edges between different features, as pairs of triangles (= circumcentres)
  const adj = new Map<number, number[]>()
  const link = (a: number, b: number): void => {
    let l = adj.get(a)
    if (!l) adj.set(a, (l = []))
    l.push(b)
  }
  const half_ = d.halfedges
  for (let e = 0; e < tri.length; e++) {
    const o2 = half_[e]
    if (o2 < 0 || o2 < e) continue
    const p = tri[e]
    const q = tri[e % 3 === 2 ? e - 2 : e + 1]
    if (labels[p] === labels[q]) continue
    const t1 = Math.floor(e / 3)
    const t2 = Math.floor(o2 / 3)
    // the gap here is about twice the distance to the two sites
    if (Math.min(cr[t1], cr[t2]) > half || !Number.isFinite(cr[t1]) || !Number.isFinite(cr[t2])) continue
    link(t1, t2)
    link(t2, t1)
  }
  // chain the edges into polylines (walk through nodes with exactly two edges)
  const used = new Set<string>()
  const key = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`)
  const pt = (t: number): Vec2 => ({ x: cx[t], y: cy[t] })
  const out: Path[] = []
  const walk = (start: number, next: number): Path => {
    const path: Path = [pt(start)]
    let prev = start
    let cur = next
    used.add(key(prev, cur))
    for (;;) {
      path.push(pt(cur))
      const nb = adj.get(cur) ?? []
      if (nb.length !== 2) break
      const nxt = nb[0] === prev ? nb[1] : nb[0]
      if (used.has(key(cur, nxt))) break
      used.add(key(cur, nxt))
      prev = cur
      cur = nxt
    }
    return path
  }
  // start at ends and junctions first, then whatever is left (closed loops)
  for (const [t, nb] of adj)
    if (nb.length !== 2) for (const n of nb) if (!used.has(key(t, n))) out.push(walk(t, n))
  for (const [t, nb] of adj) for (const n of nb) if (!used.has(key(t, n))) out.push(walk(t, n))
  return { lines: out.filter((p) => p.length >= 2), zone }
}
