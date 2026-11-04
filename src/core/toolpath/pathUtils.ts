/** Small polyline helpers used by toolpath generation (pure, allocation-light). */
import type { BBox, Path, Vec2 } from '../model/types'

/** Output simplification tolerance, mm. */
export const OUTPUT_TOLERANCE = 0.002

function segDist2(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const ex = a.x + t * dx - p.x
  const ey = a.y + t * dy - p.y
  return ex * ex + ey * ey
}

function rdp(pts: Path, tol2: number): Path {
  const n = pts.length
  if (n <= 2) return pts.slice()
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    let best = -1
    let bi = -1
    for (let k = i + 1; k < j; k++) {
      const d = segDist2(pts[k], pts[i], pts[j])
      if (d > best) {
        best = d
        bi = k
      }
    }
    if (bi >= 0 && best > tol2) {
      keep[bi] = 1
      stack.push([i, bi], [bi, j])
    }
  }
  const out: Path = []
  for (let k = 0; k < n; k++) if (keep[k]) out.push(pts[k])
  return out
}

/**
 * Ramer–Douglas–Peucker simplification preserving direction. For closed paths the input must not
 * repeat the first point; the result does not either.
 */
export function simplifyPath(p: Path, tol = OUTPUT_TOLERANCE, closed = false): Path {
  if (p.length < 3) return p.slice()
  const tol2 = tol * tol
  if (!closed) return rdp(p, tol2)
  // split the ring at vertex 0 and its farthest vertex so both halves are simplified as open chains
  let far = 0
  let fd = -1
  for (let i = 1; i < p.length; i++) {
    const d = (p[i].x - p[0].x) ** 2 + (p[i].y - p[0].y) ** 2
    if (d > fd) {
      fd = d
      far = i
    }
  }
  const a = rdp(p.slice(0, far + 1), tol2)
  const b = rdp([...p.slice(far), p[0]], tol2)
  const out = a.concat(b.slice(1, -1))
  return out.length >= 3 ? out : p.slice()
}

/** Index of the vertex of `p` nearest to `q`. */
export function nearestVertexIndex(p: Path, q: Vec2): number {
  let best = Infinity
  let bi = 0
  for (let i = 0; i < p.length; i++) {
    const d = (p[i].x - q.x) ** 2 + (p[i].y - q.y) ** 2
    if (d < best) {
      best = d
      bi = i
    }
  }
  return bi
}

/** Rotate a closed ring so it starts at index `i` (no duplicated closing point). */
export function rotateRing(p: Path, i: number): Path {
  if (i <= 0 || i >= p.length) return p.slice()
  return p.slice(i).concat(p.slice(0, i))
}

/** Signed area (positive = counter-clockwise). */
export function signedArea(p: Path): number {
  let a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j].x + p[i].x) * (p[j].y - p[i].y)
  return -a / 2
}

/** Drop a duplicated closing vertex if present. */
export function openRing(p: Path): Path {
  if (p.length > 1) {
    const a = p[0]
    const b = p[p.length - 1]
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) return p.slice(0, -1)
  }
  return p
}

export function bboxOfPath(p: Path): BBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const v of p) {
    if (v.x < minX) minX = v.x
    if (v.y < minY) minY = v.y
    if (v.x > maxX) maxX = v.x
    if (v.y > maxY) maxY = v.y
  }
  return { minX, minY, maxX, maxY }
}

export function bboxInside(inner: BBox, outer: BBox): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.minY >= outer.minY &&
    inner.maxX <= outer.maxX &&
    inner.maxY <= outer.maxY
  )
}

export function bboxOverlap(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
}

/**
 * Clip a polyline to an axis-aligned rectangle (Liang–Barsky per segment). Direction is preserved;
 * consecutive inside segments are merged into one polyline.
 */
export function clipPolylineToRect(p: Path, r: BBox): Path[] {
  const out: Path[] = []
  let cur: Path | null = null
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]
    const b = p[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    let t0 = 0
    let t1 = 1
    const pq: [number, number][] = [
      [-dx, a.x - r.minX],
      [dx, r.maxX - a.x],
      [-dy, a.y - r.minY],
      [dy, r.maxY - a.y]
    ]
    let reject = false
    for (const [pp, qq] of pq) {
      if (pp === 0) {
        if (qq < 0) {
          reject = true
          break
        }
      } else {
        const t = qq / pp
        if (pp < 0) {
          if (t > t1) {
            reject = true
            break
          }
          if (t > t0) t0 = t
        } else {
          if (t < t0) {
            reject = true
            break
          }
          if (t < t1) t1 = t
        }
      }
    }
    if (reject) {
      cur = null
      continue
    }
    const s = t0 === 0 ? a : { x: a.x + t0 * dx, y: a.y + t0 * dy }
    const e = t1 === 1 ? b : { x: a.x + t1 * dx, y: a.y + t1 * dy }
    if (cur && t0 === 0) cur.push(e)
    else {
      cur = [s, e]
      out.push(cur)
    }
    if (t1 !== 1) cur = null
  }
  return out.filter((q) => q.length >= 2 && pathLen(q) > 1e-6)
}

export function pathLen(p: Path, closed = false): number {
  let len = 0
  for (let i = 1; i < p.length; i++) len += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)
  if (closed && p.length > 1) len += Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y)
  return len
}

/**
 * Chain loose polyline pieces end-to-end (either direction) within `tol`. Returns closed loops
 * (without duplicated closing point) and the remaining open chains.
 */
export function chainPolylines(pieces: Path[], tol = 0.01): { closed: Path[]; open: Path[] } {
  const items = pieces.filter((p) => p.length >= 2).map((p) => p.slice())
  const used = new Uint8Array(items.length)
  const key = (v: Vec2): string => `${Math.round(v.x / tol)},${Math.round(v.y / tol)}`
  const ends = new Map<string, number[]>()
  const addEnd = (v: Vec2, i: number): void => {
    // register in the cell and its neighbours so near-boundary points still match
    const cx = Math.round(v.x / tol)
    const cy = Math.round(v.y / tol)
    for (let ox = -1; ox <= 1; ox++)
      for (let oy = -1; oy <= 1; oy++) {
        const k = `${cx + ox},${cy + oy}`
        const l = ends.get(k)
        if (l) l.push(i)
        else ends.set(k, [i])
      }
  }
  items.forEach((p, i) => {
    addEnd(p[0], i)
    addEnd(p[p.length - 1], i)
  })
  const near = (a: Vec2, b: Vec2): boolean => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol
  const findNext = (v: Vec2): number => {
    const l = ends.get(key(v))
    if (!l) return -1
    for (const i of l)
      if (!used[i] && (near(items[i][0], v) || near(items[i][items[i].length - 1], v))) return i
    return -1
  }
  const closed: Path[] = []
  const open: Path[] = []
  for (let s = 0; s < items.length; s++) {
    if (used[s]) continue
    used[s] = 1
    let chain = items[s]
    // extend forward
    for (;;) {
      const end = chain[chain.length - 1]
      if (chain.length > 2 && near(end, chain[0])) break
      const n = findNext(end)
      if (n < 0) break
      used[n] = 1
      const q = near(items[n][0], end) ? items[n] : items[n].slice().reverse()
      chain = chain.concat(q.slice(1))
    }
    // extend backward
    if (!(chain.length > 2 && near(chain[chain.length - 1], chain[0]))) {
      for (;;) {
        const st = chain[0]
        const n = findNext(st)
        if (n < 0) break
        used[n] = 1
        const q = near(items[n][items[n].length - 1], st) ? items[n] : items[n].slice().reverse()
        chain = q.slice(0, -1).concat(chain)
        if (chain.length > 2 && near(chain[chain.length - 1], chain[0])) break
      }
    }
    if (chain.length > 3 && near(chain[chain.length - 1], chain[0])) closed.push(chain.slice(0, -1))
    else open.push(chain)
  }
  return { closed, open }
}
