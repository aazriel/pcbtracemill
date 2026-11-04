/**
 * Board → stock → machine-work coordinate frames.
 *
 * Conventions (all mm, +X right, +Y away from the operator, looking DOWN at the stock on the bed):
 *
 *  - BOARD coordinates: as authored in the CAM files, looking at the TOP of the board.
 *  - STOCK coordinates: the blank spans x ∈ [0, material.width], y ∈ [0, material.height], with (0,0)
 *    at the stock's bottom-left corner as seen from above while the TOP side faces up.
 *  - WORK coordinates: stock coordinates shifted so the machine work zero (material.origin) is (0,0).
 *    The origin is a corner / the centre of the stock, or (material.originOn = 'board') of the board as
 *    placed for the top side. Either way it is one fixed point on the bed, used for both sides.
 *    Toolpath moves are emitted in work coordinates. Z0 is the copper surface.
 *
 * Placement of the board into the stock (top side):
 *  1. translate the board bbox min corner to (0,0);
 *  2. rotate by material.rotation degrees (positive = counter-clockwise, seen from above) about the
 *     board centre, then re-translate so the rotated bbox min corner is again at (0,0);
 *  3. translate by (material.offsetX, material.offsetY).
 *
 * Bottom side: the operator flips the stock around the STOCK centre line perpendicular to the
 * alignment pins' line, so the pins land in their own holes.
 *  - alignment.axis 'x': pins lie on the horizontal centre line y = height/2; the stock is flipped
 *    about that line, i.e. y' = height − y (x unchanged).
 *  - alignment.axis 'y': pins lie on the vertical centre line x = width/2; x' = width − x.
 * The mirror is applied in stock coordinates (after placement) and before the work-origin shift.
 * Mirroring reverses ring orientation; callers re-normalise orientation AFTER transforming.
 */
import type { BBox, Material, Vec2 } from '../model/types'
import { applyAffine, bboxIsEmpty, compose, rotate, translate, type Affine } from '../geometry'

function safeBBox(b: BBox): BBox {
  return bboxIsEmpty(b) ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : b
}

function transformedBBox(m: Affine, b: BBox): BBox {
  const pts = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY }
  ].map((p) => applyAffine(m, p))
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y))
  }
}

/** Board (top view) → stock coordinates, no side mirroring. */
export function boardToStockTransform(material: Material, boardBBox: BBox): Affine {
  const b = safeBBox(boardBBox)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  let m = translate(-b.minX, -b.minY)
  m = compose(translate(-w / 2, -h / 2), m)
  m = compose(rotate(material.rotation || 0), m)
  m = compose(translate(w / 2, h / 2), m)
  const rb = transformedBBox(m, b)
  m = compose(translate(-rb.minX, -rb.minY), m)
  return compose(translate(material.offsetX, material.offsetY), m)
}

/** Board bbox as placed in the stock (top side up). */
export function placedBoardBBox(material: Material, boardBBox: BBox): BBox {
  return transformedBBox(boardToStockTransform(material, boardBBox), safeBBox(boardBBox))
}

/** Stock mirror used for the bottom side (flip about the stock centre line, see module doc). */
export function flipTransform(material: Material): Affine {
  return material.alignment.axis === 'x'
    ? [1, 0, 0, -1, 0, material.height]
    : [-1, 0, 0, 1, material.width, 0]
}

/**
 * Position of the machine work zero (X0 Y0) in stock coordinates: the chosen corner (or centre) of
 * the stock, or of the board as placed for the top side when `originOn` is 'board'.
 */
export function workOriginInStock(material: Material, boardBBox: BBox): Vec2 {
  const r =
    material.originOn === 'board' && !bboxIsEmpty(boardBBox)
      ? placedBoardBBox(material, boardBBox)
      : { minX: 0, minY: 0, maxX: material.width, maxY: material.height }
  switch (material.origin) {
    case 'bottom-right':
      return { x: r.maxX, y: r.minY }
    case 'top-left':
      return { x: r.minX, y: r.maxY }
    case 'top-right':
      return { x: r.maxX, y: r.maxY }
    case 'center':
      return { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 }
    default:
      return { x: r.minX, y: r.minY }
  }
}

/** Stock → work coordinates (pure translation). */
export function stockToWork(material: Material, boardBBox: BBox): Affine {
  const o = workOriginInStock(material, boardBBox)
  return translate(-o.x, -o.y)
}

/** Stock-side transform (identity for top, flip for bottom) followed by the work-origin shift. */
export function stockSideToWork(material: Material, side: 'top' | 'bottom', boardBBox: BBox): Affine {
  const toWork = stockToWork(material, boardBBox)
  return side === 'bottom' ? compose(toWork, flipTransform(material)) : toWork
}

/** Full board → work transform for the given side. */
export function boardToWorkTransform(material: Material, boardBBox: BBox, side: 'top' | 'bottom'): Affine {
  return compose(stockSideToWork(material, side, boardBBox), boardToStockTransform(material, boardBBox))
}

/** Stock rectangle in work coordinates (identical for both sides, the flip maps the stock onto itself). */
export function stockRectInWork(material: Material, boardBBox: BBox): BBox {
  const o = workOriginInStock(material, boardBBox)
  return { minX: -o.x, minY: -o.y, maxX: material.width - o.x, maxY: material.height - o.y }
}

/**
 * Alignment pin centres in STOCK coordinates. Two pins on the flip-axis centre line, one on each
 * side of the (top-side) placed board, each with its CENTRE `alignment.margin` mm from the board
 * edge (see docs/DECISIONS.md). Because they lie on the flip line they map onto
 * themselves under {@link flipTransform}.
 */
export function alignmentPinPositions(material: Material, boardBBox: BBox): Vec2[] {
  const b = placedBoardBBox(material, boardBBox)
  const d = material.alignment.margin
  if (material.alignment.axis === 'x') {
    const y = material.height / 2
    return [
      { x: b.minX - d, y },
      { x: b.maxX + d, y }
    ]
  }
  const x = material.width / 2
  return [
    { x, y: b.minY - d },
    { x, y: b.maxY + d }
  ]
}
