/**
 * Where each bit finds Z0 with the probe (D-037).
 *
 * The probe only works where the bit touches copper that is still electrically connected to the
 * probe clip, which sits on the copper OUTSIDE the board (a soldered point on a corner of the sheet).
 * After isolation every trace and pad is its own island, after a cut nothing is left on the path,
 * so each step gets its own point, chosen from what earlier steps have left:
 *  - copper steps (isolate, clear, engrave): the board centre (or point 1 / a custom point);
 *  - drill / hole milling: the centre of a hole this step makes (the dent is drilled away);
 *  - cutout: a point on the cutout path (milled away right after);
 *  - otherwise any copper still connected to the outer copper, outside the board first.
 * A step with no such point gets null: that file cannot find Z0 with the probe.
 */
import type { BBox, Material, PolygonSet, ProbeGridConfig, Tool, Toolpath, Vec2 } from '../model/types'
import {
  applyAffine,
  arcPoints,
  circlePath,
  compose,
  difference,
  offset,
  pointInPolygonSet,
  polygonSetBBox,
  strokePaths,
  translate,
  union,
  type Affine
} from '../geometry'
import { flipTransform, stockRectInWork, workOriginInStock } from '../toolpath/frame'
import { effectiveCutWidth } from '../tools/geometry'
import { tokenizeLine } from '../gcode/tokenize'
import { gridStep, probePoints } from './grid'

export type TouchPointChoice = 'center' | 'point1' | 'custom'

export interface TouchPointRequest {
  /** Toolpaths of the job in the order they are milled (work coordinates of their own side). */
  toolpaths: Toolpath[]
  tools: Tool[]
  material: Material
  boardBBox: BBox
  /** The board's shape in work coordinates, per side (outside it the copper is waste). */
  boardShape: { top: PolygonSet; bottom: PolygonSet }
  /** Probed grid (the touch must lie where the heights are known); null: anywhere on the sheet. */
  grid: ProbeGridConfig | null
  /** Where copper steps touch: board centre (default), point 1 of the grid, or `custom`. */
  choice?: TouchPointChoice
  /** Custom point, work coordinates of the side the copper step mills. */
  custom?: Vec2 | null
}

export interface TouchPoint extends Vec2 {
  /** Short reason shown to the user, e.g. "board centre", "hole 2.1 mm". */
  where: string
}

/** Keep the touch this far inside the remaining copper, mm. */
const MARGIN = 0.4
/** A copper region counts as "outer" (connected to the clip) when it reaches this close to the sheet edge, mm. */
const EDGE_REACH = 1
const THROUGH: ReadonlySet<string> = new Set(['drill', 'holeMill', 'cutout', 'alignment'])
const COPPER: ReadonlySet<string> = new Set(['isolate', 'clear', 'engrave'])

/** Area a toolpath removes at the copper surface (work coordinates of its own side). */
export function milledArea(tp: Toolpath, tool: Tool | undefined): PolygonSet {
  const shapes: PolygonSet[] = []
  const lines: { path: Vec2[]; depth: number }[] = []
  const dia = tool?.geometry.diameter ?? 1
  for (const seg of tp.segments) {
    if (seg.drill) {
      shapes.push([{ outer: circlePath(seg.drill.x, seg.drill.y, dia / 2), holes: [] }])
      continue
    }
    let cur: Vec2[] = []
    let depth = 0
    let last: Vec2 | null = null
    const flush = (): void => {
      if (cur.length) lines.push({ path: cur, depth })
      cur = []
      depth = 0
    }
    for (const m of seg.moves) {
      const p = { x: m.x, y: m.y }
      if (m.z < 0 && m.kind !== 'rapid') {
        if (!cur.length && last) cur.push(last)
        if ((m.kind === 'arc-cw' || m.kind === 'arc-ccw') && last && m.cx !== undefined && m.cy !== undefined)
          cur.push(...arcPoints(last, p, { x: m.cx, y: m.cy }, m.kind === 'arc-cw', 0.05).slice(1))
        else cur.push(p)
        depth = Math.max(depth, -m.z)
      } else flush()
      last = p
    }
    flush()
  }
  // one stroke per cut width (V-bits get wider with depth)
  const byWidth = new Map<number, Vec2[][]>()
  for (const l of lines) {
    const w = tool ? effectiveCutWidth(tool, l.depth) : dia
    const k = Math.round(w * 1000) / 1000
    const list = byWidth.get(k) ?? []
    list.push(l.path)
    byWidth.set(k, list)
  }
  for (const [w, paths] of byWidth) shapes.push(strokePaths(paths, w))
  return shapes.length ? union(...shapes) : []
}

/** Work coordinates of one side → the other (the flip about the stock centre line). */
function otherSideTransform(material: Material, boardBBox: BBox): Affine {
  const o = workOriginInStock(material, boardBBox)
  return compose(translate(-o.x, -o.y), compose(flipTransform(material), translate(o.x, o.y)))
}

function transformSet(m: Affine, set: PolygonSet): PolygonSet {
  const t = (p: Vec2[]): Vec2[] => p.map((q) => applyAffine(m, q))
  return set.map((poly) => ({ outer: t(poly.outer), holes: poly.holes.map(t) }))
}

/** Inside the probed grid (and near a probed point when only part of the grid is probed). */
function inGrid(grid: ProbeGridConfig | null, p: Vec2): boolean {
  if (!grid) return true
  const e = 1e-6
  if (p.x < grid.minX - e || p.x > grid.maxX + e || p.y < grid.minY - e || p.y > grid.maxY + e) return false
  if (!grid.cells?.length) return true
  const { dx, dy } = gridStep(grid)
  const reach = Math.max(dx, dy)
  return probePoints(grid).some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= reach + e)
}

function bboxCentre(set: PolygonSet): Vec2 | null {
  if (!set.length) return null
  const b = polygonSetBBox(set)
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
}

/** Points along the feed moves of a toolpath below Z0, about every `step` mm. */
function pathSamples(tp: Toolpath, step: number): Vec2[] {
  const out: Vec2[] = []
  for (const seg of tp.segments) {
    let last: Vec2 | null = null
    for (const m of seg.moves) {
      const p = { x: m.x, y: m.y }
      if (last && m.z < 0 && m.kind !== 'rapid') {
        const len = Math.hypot(p.x - last.x, p.y - last.y)
        const n = Math.max(1, Math.ceil(len / step))
        for (let k = 1; k <= n; k++)
          out.push({ x: last.x + ((p.x - last.x) * k) / n, y: last.y + ((p.y - last.y) * k) / n })
      }
      last = p
    }
  }
  return out
}

function holeCentres(tp: Toolpath): Vec2[] {
  const out: Vec2[] = []
  for (const seg of tp.segments) {
    if (seg.drill) out.push({ x: seg.drill.x, y: seg.drill.y })
    else if (seg.moves.length) {
      // a milled hole: the centre of its moves
      let sx = 0
      let sy = 0
      for (const m of seg.moves) {
        sx += m.x
        sy += m.y
      }
      out.push({ x: sx / seg.moves.length, y: sy / seg.moves.length })
    }
  }
  return out
}

/**
 * The Z touch-off point of every toolpath (by step id), or null where the probe cannot reach copper
 * that is still connected to the outer copper.
 */
export function touchOffPoints(req: TouchPointRequest): Map<string, TouchPoint | null> {
  const { toolpaths, tools, material, boardBBox, grid } = req
  const stock = stockRectInWork(material, boardBBox)
  const sheet: PolygonSet = [
    {
      outer: [
        { x: stock.minX, y: stock.minY },
        { x: stock.maxX, y: stock.minY },
        { x: stock.maxX, y: stock.maxY },
        { x: stock.minX, y: stock.maxY }
      ],
      holes: []
    }
  ]
  const flip = otherSideTransform(material, boardBBox)
  const milled: { top: PolygonSet; bottom: PolygonSet } = { top: [], bottom: [] }
  const out = new Map<string, TouchPoint | null>()

  for (const tp of toolpaths) {
    const side = tp.side
    const tool = tools.find((t) => t.id === tp.toolId)
    // copper still there and connected to the sheet edge, shrunk by the margin
    const left = difference(sheet, milled[side])
    const outer = left.filter((poly) => {
      const b = polygonSetBBox([poly])
      return (
        b.minX <= stock.minX + EDGE_REACH ||
        b.minY <= stock.minY + EDGE_REACH ||
        b.maxX >= stock.maxX - EDGE_REACH ||
        b.maxY >= stock.maxY - EDGE_REACH
      )
    })
    const ok = offset(outer, -MARGIN)
    const valid = (p: Vec2 | null | undefined): p is Vec2 => !!p && inGrid(grid, p) && pointInPolygonSet(p, ok)
    const shape = req.boardShape[side]
    const centre = bboxCentre(shape)

    let pick: TouchPoint | null = null
    if (COPPER.has(tp.stepKind)) {
      const want =
        req.choice === 'custom' && req.custom
          ? { ...req.custom, where: 'your point' }
          : req.choice === 'point1' && grid
            ? { ...probePoints(grid)[0], where: 'point 1' }
            : centre && { ...centre, where: 'board centre' }
      if (want && valid(want)) pick = { x: want.x, y: want.y, where: want.where }
    } else if (tp.stepKind === 'drill' || tp.stepKind === 'holeMill') {
      const near = centre ?? { x: 0, y: 0 }
      const holes = holeCentres(tp)
        .filter(valid)
        .sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y))
      if (holes[0]) pick = { ...holes[0], where: 'on a hole it drills' }
    } else if (tp.stepKind === 'cutout') {
      const on = pathSamples(tp, 1).find(valid)
      if (on) pick = { ...on, where: 'on the cutout line' }
    }
    if (!pick) pick = fallback(ok, shape, centre, grid, stock)
    out.set(tp.stepId, pick)

    // what this step removes, on its side and (through the board) on the other one
    const area = milledArea(tp, tool)
    if (area.length) {
      milled[side] = union(milled[side], area)
      if (THROUGH.has(tp.stepKind)) {
        const other = side === 'top' ? 'bottom' : 'top'
        milled[other] = union(milled[other], transformSet(flip, area))
      }
    }
  }
  return out
}

/** Any copper still connected to the outer copper: waste copper outside the board first, near the board. */
function fallback(
  ok: PolygonSet,
  shape: PolygonSet,
  centre: Vec2 | null,
  grid: ProbeGridConfig | null,
  stock: BBox
): TouchPoint | null {
  if (!ok.length) return null
  const area = grid ?? stock
  const b = polygonSetBBox(ok)
  const minX = Math.max(area.minX, b.minX)
  const maxX = Math.min(area.maxX, b.maxX)
  const minY = Math.max(area.minY, b.minY)
  const maxY = Math.min(area.maxY, b.maxY)
  if (minX > maxX || minY > maxY) return null
  const step = Math.max(0.5, Math.min(maxX - minX, maxY - minY) / 60)
  const c = centre ?? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  let best: TouchPoint | null = null
  let bestScore = Infinity
  for (let y = minY; y <= maxY + 1e-9; y += step)
    for (let x = minX; x <= maxX + 1e-9; x += step) {
      const p = { x, y }
      if (!inGrid(grid, p) || !pointInPolygonSet(p, ok)) continue
      const onBoard = shape.length > 0 && pointInPolygonSet(p, shape)
      const score = (onBoard ? 1e6 : 0) + Math.hypot(x - c.x, y - c.y)
      if (score < bestScore) {
        bestScore = score
        best = { x, y, where: onBoard ? 'copper left on the board' : 'copper outside the board' }
      }
    }
  return best
}

/**
 * Which step's cutting follows each Z touch-off that {@link addZTouchOff} inserts (one before the
 * first spindle start and one after every M0 / M1 / M6), from the file's per-line step ids.
 */
export function touchOffStepOrder(text: string, lineStepIds: (string | null)[]): (string | null)[] {
  const lines = text.split(/\r?\n/)
  const out: (string | null)[] = []
  let needed = true
  for (let i = 0; i < lines.length; i++) {
    const ms = tokenizeLine(lines[i])
      .words.filter((w) => w.letter === 'M')
      .map((w) => Math.round(w.value))
    const spindleOn = ms.some((m) => m === 3 || m === 4)
    const pause = ms.some((m) => m === 0 || m === 1 || m === 6)
    if (spindleOn && needed) {
      let id: string | null = null
      for (let j = i; j < lines.length && id === null; j++) id = lineStepIds[j] ?? null
      out.push(id)
      needed = false
    }
    if (pause && !spindleOn) needed = true
  }
  return out
}
