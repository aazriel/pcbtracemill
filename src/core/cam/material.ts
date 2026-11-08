/**
 * Material (stock) helpers: defaults derived from the board size, and validation.
 *
 * Board placement model (matches types.ts): the board's bbox AFTER rotation is placed with its min corner at
 * (offsetX, offsetY) relative to the stock's min corner. Alignment pins sit outside the board along
 * `alignment.axis` at the board's centre line: for axis 'x' one pin left and one right of the board,
 * each `margin` mm (centre distance) from the board edge.
 */
import type { BBox, Material, ValidationLevel } from '../model/types'
import { DEFAULT_STOCK_MARGIN } from '../model/types'
import { bboxSize } from '../model/board'

/** Stock size used when no board has been imported yet. */
const EMPTY_BOARD_STOCK = { width: 100, height: 80 }
/** Minimum material wanted between an alignment pin hole and the stock edge. */
const PIN_EDGE_CLEARANCE = 1

export interface MaterialIssue {
  field: string
  level: ValidationLevel
  message: string
}

const r2 = (v: number): number => Math.round(v * 1000) / 1000

/** Size of the board's bounding box after rotating it by `deg` degrees. */
export function rotatedBoardSize(bbox: BBox, deg: number): { width: number; height: number } {
  const { width, height } = bboxSize(bbox)
  const a = (((deg % 360) + 360) % 360) * (Math.PI / 180)
  const c = Math.abs(Math.cos(a))
  const s = Math.abs(Math.sin(a))
  return { width: r2(width * c + height * s), height: r2(width * s + height * c) }
}

/** Extra stock needed on each side of the pin axis so alignment pins fit. */
function pinAllowance(m: Pick<Material, 'doubleSided' | 'alignment'>): number {
  if (!m.doubleSided || !m.alignment.enabled) return 0
  return m.alignment.margin + m.alignment.pinDiameter / 2 + PIN_EDGE_CLEARANCE
}

/** Computes width/height/offset so the board is centred with the default margin (plus room for pins). */
function fitStock(m: Material, bbox: BBox): Pick<Material, 'width' | 'height' | 'offsetX' | 'offsetY'> {
  const { width: bw, height: bh } = rotatedBoardSize(bbox, m.rotation)
  if (bw <= 0 && bh <= 0) return { ...EMPTY_BOARD_STOCK, offsetX: 0, offsetY: 0 }
  const half = DEFAULT_STOCK_MARGIN / 2
  const pin = pinAllowance(m)
  const sideX = m.alignment.axis === 'x' ? Math.max(half, pin) : half
  const sideY = m.alignment.axis === 'y' ? Math.max(half, pin) : half
  return { width: r2(bw + 2 * sideX), height: r2(bh + 2 * sideY), offsetX: r2(sideX), offsetY: r2(sideY) }
}

/**
 * Default stock: board + 5 mm total per axis, board centred, 1.6 mm FR4 with 35 µm copper,
 * origin bottom-left, single-sided, alignment along X with 3 mm pins 3 mm from the board.
 */
export function defaultMaterial(boardBBox: BBox): Material {
  const m: Material = {
    width: 0,
    height: 0,
    thickness: 1.6,
    copperThickness: 0.035,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    origin: 'bottom-left',
    doubleSided: false,
    alignment: { enabled: false, axis: 'x', pinDiameter: 3.0, margin: 3 },
    useDefaults: true
  }
  return { ...m, ...fitStock(m, boardBBox) }
}

/**
 * Resets the stock SIZE and PLACEMENT (width, height, offsets; the rotation is kept) to the defaults for the board
 * and turns `useDefaults` back on. Thickness, copper, origin, double-sided and alignment settings are kept,
 * and when alignment pins are enabled the stock is enlarged along the pin axis so they fit.
 */
export function resetMaterialToDefault(m: Material, bbox: BBox): Material {
  const base: Material = { ...m, alignment: { ...m.alignment }, useDefaults: true }
  return { ...base, ...fitStock(base, bbox) }
}

/**
 * The material after the user typed a new stock size: on each axis where the board was centred
 * before, it stays centred in the new size (D-036 - the middle of a copper sheet is the flattest
 * and stays put best). An axis the user placed elsewhere keeps its offset.
 */
export function resizeKeepingCentre(prev: Material, next: Material, bbox: BBox): Material {
  const board = rotatedBoardSize(bbox, finite(next.rotation) ? next.rotation : 0)
  if (board.width <= 0 && board.height <= 0) return next
  const centred = (size: number, b: number, off: number): boolean =>
    finite(size) && finite(off) && Math.abs(off - (size - b) / 2) < 0.01
  const out = { ...next }
  if (next.width !== prev.width && centred(prev.width, board.width, prev.offsetX) && finite(next.width))
    out.offsetX = r2((next.width - board.width) / 2)
  if (next.height !== prev.height && centred(prev.height, board.height, prev.offsetY) && finite(next.height))
    out.offsetY = r2((next.height - board.height) / 2)
  return out
}

/** Is the board in the middle of the material (both axes, within 0.01 mm)? */
export function boardCentred(m: Material, bbox: BBox): boolean {
  const b = rotatedBoardSize(bbox, finite(m.rotation) ? m.rotation : 0)
  return (
    Math.abs(m.offsetX - (m.width - b.width) / 2) < 0.01 &&
    Math.abs(m.offsetY - (m.height - b.height) / 2) < 0.01
  )
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const fmt = (v: number): string => String(Math.round(v * 100) / 100)

/** Validates the material against the board. Returns an empty list when everything is fine. */
/** Largest copper-clad sheet PCB TraceMill works with (mm, each side). */
export const MAX_STOCK_SIZE = 300

export function validateMaterial(m: Material, bbox: BBox): MaterialIssue[] {
  const out: MaterialIssue[] = []
  const add = (field: string, level: ValidationLevel, message: string): void => {
    out.push({ field, level, message })
  }

  // Thickness / copper sanity
  if (!finite(m.thickness) || m.thickness <= 0)
    add('thickness', 'error', 'Board thickness must be greater than 0 mm.')
  else if (m.thickness < 0.4 || m.thickness > 3.2)
    add(
      'thickness',
      'warning',
      `A ${fmt(m.thickness)} mm board is unusual — most copper-clad boards are 0.8–1.6 mm thick. Please double-check with calipers.`
    )
  if (!finite(m.copperThickness) || m.copperThickness <= 0)
    add('copperThickness', 'error', 'Copper thickness must be greater than 0 mm (typically 0.035 mm).')
  else if (finite(m.thickness) && m.copperThickness >= m.thickness)
    add('copperThickness', 'error', 'Copper cannot be thicker than the whole board.')
  else if (m.copperThickness > 0.2)
    add(
      'copperThickness',
      'warning',
      `${fmt(m.copperThickness)} mm of copper is very thick — normal boards have 0.035 mm (1 oz) or 0.07 mm (2 oz). Did you enter micrometres instead of millimetres?`
    )

  // Stock size
  const sizeOk = { w: true, h: true }
  if (!finite(m.width) || m.width <= 0) {
    add('width', 'error', 'Stock width must be greater than 0 mm.')
    sizeOk.w = false
  }
  if (!finite(m.height) || m.height <= 0) {
    add('height', 'error', 'Stock height must be greater than 0 mm.')
    sizeOk.h = false
  }
  if (finite(m.width) && m.width > MAX_STOCK_SIZE)
    add('width', 'error', `The material can be at most ${MAX_STOCK_SIZE} mm wide.`)
  if (finite(m.height) && m.height > MAX_STOCK_SIZE)
    add('height', 'error', `The material can be at most ${MAX_STOCK_SIZE} mm high.`)
  if (finite(m.rotation) && Math.abs(m.rotation % 90) > 1e-6)
    add(
      'rotation',
      'warning',
      'Rotations other than 0°, 90°, 180° or 270° make the board hard to line up with the stock.'
    )

  const { width: bw, height: bh } = rotatedBoardSize(bbox, finite(m.rotation) ? m.rotation : 0)
  const hasBoard = bw > 0 || bh > 0
  if (hasBoard && sizeOk.w && sizeOk.h) {
    const ox = finite(m.offsetX) ? m.offsetX : 0
    const oy = finite(m.offsetY) ? m.offsetY : 0
    // X
    if (bw > m.width + 1e-9) {
      add(
        'width',
        'error',
        `The stock is ${fmt(bw - m.width)} mm too narrow: the board is ${fmt(bw)} mm wide but the stock only ${fmt(m.width)} mm.`
      )
    } else {
      if (ox < -1e-9)
        add(
          'offsetX',
          'error',
          `The board sticks out ${fmt(-ox)} mm past the LEFT edge of the stock. Increase the X offset.`
        )
      if (ox + bw > m.width + 1e-9)
        add(
          'offsetX',
          'error',
          `The board sticks out ${fmt(ox + bw - m.width)} mm past the RIGHT edge of the stock. Decrease the X offset or use wider stock.`
        )
    }
    // Y
    if (bh > m.height + 1e-9) {
      add(
        'height',
        'error',
        `The stock is ${fmt(bh - m.height)} mm too short: the board is ${fmt(bh)} mm tall but the stock only ${fmt(m.height)} mm.`
      )
    } else {
      if (oy < -1e-9)
        add(
          'offsetY',
          'error',
          `The board sticks out ${fmt(-oy)} mm past the BOTTOM edge of the stock. Increase the Y offset.`
        )
      if (oy + bh > m.height + 1e-9)
        add(
          'offsetY',
          'error',
          `The board sticks out ${fmt(oy + bh - m.height)} mm past the TOP edge of the stock. Decrease the Y offset or use taller stock.`
        )
    }

    // Alignment pins
    if (m.doubleSided && m.alignment.enabled) validatePins(m, ox, oy, bw, bh, add)
  }

  if (m.doubleSided && !m.alignment.enabled)
    add(
      'alignment.enabled',
      'warning',
      'Double-sided boards need a way to line up the second side after flipping. Turn on alignment pins unless you have your own method.'
    )
  if (m.doubleSided && m.alignment.enabled) {
    if (!finite(m.alignment.pinDiameter) || m.alignment.pinDiameter <= 0)
      add('alignment.pinDiameter', 'error', 'Alignment pin diameter must be greater than 0 mm.')
    if (!finite(m.alignment.margin) || m.alignment.margin <= m.alignment.pinDiameter / 2)
      add(
        'alignment.margin',
        'error',
        'The alignment pin holes would cut into the board. Make the pin distance larger than half the pin diameter.'
      )
  }
  return out
}

function validatePins(
  m: Material,
  ox: number,
  oy: number,
  bw: number,
  bh: number,
  add: (field: string, level: ValidationLevel, message: string) => void
): void {
  const { pinDiameter: pd, margin, axis } = m.alignment
  if (!finite(pd) || pd <= 0 || !finite(margin)) return
  const r = pd / 2
  // Distance from the pin hole edge to the stock edge on each side along the pin axis.
  const [lowSpace, highSpace, lowName, highName] =
    axis === 'x'
      ? [ox - margin - r, m.width - (ox + bw + margin + r), 'left', 'right']
      : [oy - margin - r, m.height - (oy + bh + margin + r), 'bottom', 'top']
  for (const [space, name] of [
    [lowSpace, lowName],
    [highSpace, highName]
  ] as const) {
    if (space < 0)
      add(
        'alignment',
        'error',
        `The ${name} alignment pin does not fit: it needs ${fmt(-space)} mm more stock on the ${name} side. Enlarge the stock, move the board or reduce the pin distance.`
      )
    else if (space < PIN_EDGE_CLEARANCE)
      add(
        'alignment',
        'warning',
        `The ${name} alignment pin hole is only ${fmt(space)} mm from the edge of the stock and may break out.`
      )
  }
}
