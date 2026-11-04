import { applyAffine } from '@core/geometry'
import {
  alignmentPinPositions,
  boardToWorkTransform,
  flipTransform,
  stockSideToWork,
  stockToWork,
  workOriginInStock
} from '@core/toolpath'
import { material } from './fixtures'

const board = { minX: 5, minY: 5, maxX: 35, maxY: 25 } // 30 × 20 mm

function close(p: { x: number; y: number }, x: number, y: number): void {
  expect(p.x).toBeCloseTo(x, 9)
  expect(p.y).toBeCloseTo(y, 9)
}

describe('frame transforms', () => {
  it('bottom-left origin places the board bbox min at the stock offset', () => {
    const m = boardToWorkTransform(material(), board, 'top')
    close(applyAffine(m, { x: 5, y: 5 }), 10, 10)
    close(applyAffine(m, { x: 35, y: 25 }), 40, 30)
  })

  it('centre origin shifts by half the stock', () => {
    const mat = material({ origin: 'center' })
    close(workOriginInStock(mat, board), 50, 40)
    close(applyAffine(boardToWorkTransform(mat, board, 'top'), { x: 5, y: 5 }), -40, -30)
    close(applyAffine(stockToWork(material({ origin: 'top-right' }), board), { x: 100, y: 80 }), 0, 0)
  })

  it('an origin on the board uses the corner / centre of the board as placed on the stock', () => {
    // board 30 × 20 placed at offset (10, 10) on a 100 × 80 stock
    close(workOriginInStock(material({ originOn: 'board' }), board), 10, 10)
    close(workOriginInStock(material({ originOn: 'board', origin: 'top-right' }), board), 40, 30)
    close(workOriginInStock(material({ originOn: 'board', origin: 'center' }), board), 25, 20)
    // the board's bottom-left corner is X0 Y0
    const m = boardToWorkTransform(material({ originOn: 'board' }), board, 'top')
    close(applyAffine(m, { x: 5, y: 5 }), 0, 0)
    close(applyAffine(m, { x: 35, y: 25 }), 30, 20)
    // without a board it falls back to the stock corner
    close(workOriginInStock(material({ originOn: 'board' }), { minX: 1, minY: 1, maxX: -1, maxY: -1 }), 0, 0)
  })

  it('the board origin is one fixed point on the bed for both sides (no re-zeroing after the flip)', () => {
    const mat = material({ originOn: 'board', origin: 'center' })
    const p = { x: 12, y: 7 }
    const top = applyAffine(boardToWorkTransform(mat, board, 'top'), p)
    const bot = applyAffine(boardToWorkTransform(mat, board, 'bottom'), p)
    // the origin stays at stock (25, 20); the point's stock y (top.y + 20) flips to 80 − (top.y + 20)
    close(bot, top.x, 80 - (top.y + 20) - 20)
  })

  it('rotates 90° CCW about the board centre and keeps the bbox at the offset', () => {
    const m = boardToWorkTransform(material({ rotation: 90 }), board, 'top')
    // rotated board is 20 × 30: bottom-left corner of the board becomes the bottom-right corner
    close(applyAffine(m, { x: 5, y: 5 }), 30, 10)
    close(applyAffine(m, { x: 35, y: 25 }), 10, 40)
    close(applyAffine(m, { x: 5, y: 25 }), 10, 10)
  })

  it('bottom side mirrors across the stock centre line of the flip axis', () => {
    const mx = boardToWorkTransform(material(), board, 'bottom')
    close(applyAffine(mx, { x: 5, y: 5 }), 10, 70) // axis x: y' = 80 - y
    const my = boardToWorkTransform(
      material({ alignment: { enabled: true, axis: 'y', pinDiameter: 3, margin: 3 } }),
      board,
      'bottom'
    )
    close(applyAffine(my, { x: 5, y: 5 }), 90, 10) // axis y: x' = 100 - x
  })

  it('a top feature and its bottom-side image are the same physical point after flipping the stock', () => {
    const mat = material({ origin: 'center' })
    const top = applyAffine(boardToWorkTransform(mat, board, 'top'), { x: 12, y: 7 })
    const bot = applyAffine(boardToWorkTransform(mat, board, 'bottom'), { x: 12, y: 7 })
    // flipping the stock about the X centre line (work Y = 0 for a centre origin) maps one onto the other
    close(bot, top.x, -top.y)
  })

  it('alignment pins sit on the flip line outside the board and map onto themselves', () => {
    for (const axis of ['x', 'y'] as const) {
      const mat = material({
        alignment: { enabled: true, axis, pinDiameter: 3, margin: 3 },
        origin: 'bottom-right'
      })
      const pins = alignmentPinPositions(mat, board)
      expect(pins).toHaveLength(2)
      for (const p of pins) {
        close(applyAffine(flipTransform(mat), p), p.x, p.y)
        const top = applyAffine(stockSideToWork(mat, 'top', board), p)
        const bot = applyAffine(stockSideToWork(mat, 'bottom', board), p)
        close(bot, top.x, top.y)
      }
      if (axis === 'x') {
        close(pins[0], 10 - 3, 40)
        close(pins[1], 40 + 3, 40)
      } else {
        close(pins[0], 50, 10 - 3)
        close(pins[1], 50, 30 + 3)
      }
    }
  })
})
