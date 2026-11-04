/**
 * 2D affine transforms used by the simulator to map WORK coordinates (what the G-code moves are in)
 * to STOCK coordinates of one face, and to map one face's stock coordinates to the other face.
 *
 * Layout `[a, b, c, d, e, f]`:
 *   x' = a·x + b·y + c
 *   y' = d·x + e·y + f
 *
 * The simulator assumes the transforms are rigid (rotation / translation / mirror, |det| = 1):
 * tool radii are not scaled.
 */
export type Affine = [number, number, number, number, number, number]

export const IDENTITY_AFFINE: Affine = [1, 0, 0, 0, 1, 0]

export function applyAffineX(m: Affine, x: number, y: number): number {
  return m[0] * x + m[1] * y + m[2]
}

export function applyAffineY(m: Affine, x: number, y: number): number {
  return m[3] * x + m[4] * y + m[5]
}

export function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]]
}

/** Inverse transform. Throws on a singular matrix. */
export function invertAffine(m: Affine): Affine {
  const [a, b, c, d, e, f] = m
  const det = a * e - b * d
  if (Math.abs(det) < 1e-12) throw new Error('invertAffine: singular transform')
  const ia = e / det
  const ib = -b / det
  const id = -d / det
  const ie = a / det
  return [ia, ib, -(ia * c + ib * f), id, ie, -(id * c + ie * f)]
}

/** `outer ∘ inner`: first apply `inner`, then `outer`. */
export function composeAffine(outer: Affine, inner: Affine): Affine {
  const [a1, b1, c1, d1, e1, f1] = outer
  const [a2, b2, c2, d2, e2, f2] = inner
  return [
    a1 * a2 + b1 * d2,
    a1 * b2 + b1 * e2,
    a1 * c2 + b1 * f2 + c1,
    d1 * a2 + e1 * d2,
    d1 * b2 + e1 * e2,
    d1 * c2 + e1 * f2 + f1
  ]
}

/**
 * Maps stock coordinates of one face to stock coordinates of the opposite face of the same physical
 * board, for a board of `width × height` flipped over. `mirror` names the stock coordinate that is
 * negated by the flip: 'x' → (x, y) ↦ (width − x, y) (board flipped around a vertical line),
 * 'y' → (x, y) ↦ (x, height − y). The mapping is its own inverse.
 */
export function faceMirrorAffine(width: number, height: number, mirror: 'x' | 'y'): Affine {
  return mirror === 'x' ? [-1, 0, width, 0, 1, 0] : [1, 0, 0, 0, -1, height]
}
