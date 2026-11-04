import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseGerber } from '@core/gerber'
import { countPoints, polygonSetArea } from '@core/geometry'
import type { ParsedLayer } from '@core/model/types'
import { FIXTURES, fixture } from './helpers'

/**
 * Golden snapshots: a compact JSON summary per fixture. Regenerate with
 *   UPDATE_GOLDEN=1 npx vitest run tests/unit/gerber
 */
const r3 = (v: number): number => Math.round(v * 1000) / 1000

function summarize(l: ParsedLayer): Record<string, unknown> {
  const kinds: Record<string, number> = {}
  for (const o of l.objects) kinds[`${o.kind}/${o.polarity}`] = (kinds[`${o.kind}/${o.polarity}`] ?? 0) + 1
  return {
    sourceUnits: l.sourceUnits,
    objects: l.objects.length,
    kinds,
    strokes: l.strokes.length,
    polygons: l.geometry.length,
    holes: l.geometry.reduce((n, p) => n + p.holes.length, 0),
    area: r3(polygonSetArea(l.geometry)),
    objectAreas: l.objects.map((o) => r3(polygonSetArea(o.shape))),
    bbox: { minX: r3(l.bbox.minX), minY: r3(l.bbox.minY), maxX: r3(l.bbox.maxX), maxY: r3(l.bbox.maxY) },
    pointsApprox: Math.round(countPoints(l.geometry) / 10) * 10,
    fileAttributes: l.fileAttributes,
    warnings: l.warnings
  }
}

function compare(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (path.endsWith('pointsApprox')) {
      expect(Math.abs(actual - expected), path).toBeLessThanOrEqual(Math.max(20, expected * 0.05))
    } else expect(Math.abs(actual - expected), path).toBeLessThanOrEqual(2e-3)
    return
  }
  if (expected && typeof expected === 'object') {
    expect(typeof actual, path).toBe('object')
    const e = expected as Record<string, unknown>
    const a = actual as Record<string, unknown>
    expect(Object.keys(a).sort(), path).toEqual(Object.keys(e).sort())
    for (const k of Object.keys(e)) compare(a[k], e[k], `${path}.${k}`)
    return
  }
  expect(actual, path).toEqual(expected)
}

const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.gbr'))

describe('gerber golden snapshots', () => {
  for (const f of files) {
    it(f, () => {
      const summary = summarize(parseGerber(fixture(f), { fileName: f }))
      const goldenPath = resolve(FIXTURES, f.replace(/\.gbr$/, '.golden.json'))
      if (process.env.UPDATE_GOLDEN || !existsSync(goldenPath)) {
        writeFileSync(goldenPath, `${JSON.stringify(summary, null, 2)}\n`)
      }
      const golden: unknown = JSON.parse(readFileSync(goldenPath, 'utf8'))
      compare(summary, golden, f)
    })
  }
})
