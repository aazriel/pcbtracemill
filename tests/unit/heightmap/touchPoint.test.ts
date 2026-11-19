import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importFiles } from '@core/pipeline/import'
import { runCam } from '@core/pipeline/cam'
import { computeBoardBBox } from '@core/model/board'
import { defaultMaterial, recipe, resetMaterialToDefault } from '@core/cam'
import { STARTER_TOOLS } from '@core/tools'
import { MACHINE_PRESETS } from '@core/machines'
import {
  addZTouchOff,
  applyHeightMap,
  buildHeightMap,
  defaultProbeGrid,
  milledArea,
  touchOffPoints,
  touchOffStepOrder
} from '@core/heightmap'
import { boardToWorkTransform, buildOutline, stockRectInWork } from '@core/toolpath'
import { pointInPolygonSet, transformPolygonSet } from '@core/geometry'
import type { HeightMap, PolygonSet } from '@core/model/types'

const dir = join(__dirname, '../../../fixtures/boards/demo-kicad')

async function job() {
  const files = readdirSync(dir).map((name) => ({ name, data: readFileSync(join(dir, name), 'utf8') }))
  const { layers } = await importFiles(files, 'kicad', 0, 'L')
  const bbox = computeBoardBBox(layers)
  const material = resetMaterialToDefault(defaultMaterial(bbox), bbox)
  const machine = MACHINE_PRESETS[0]
  let n = 0
  const steps = recipe({ layers, tools: STARTER_TOOLS, material, machine, newId: () => `s${n++}` })
  const res = runCam({
    projectName: 'demo',
    layers,
    steps,
    tools: STARTER_TOOLS,
    material,
    machine,
    grouping: 'per-step'
  })
  const outlines = layers.filter((l) => l.type === 'outline' && l.parsed)
  const shape = (side: 'top' | 'bottom'): PolygonSet =>
    transformPolygonSet(boardToWorkTransform(material, bbox, side), buildOutline(outlines, bbox).shape)
  const top = shape('top')
  const stock = stockRectInWork(material, bbox)
  return { res, material, bbox, machine, top, bottom: shape('bottom'), stock }
}

describe('Z touch-off points (D-037)', () => {
  it('isolation touches the board centre, drilling a hole it drills, the cutout its own line', async () => {
    const { res, material, bbox, top, bottom } = await job()
    const pts = touchOffPoints({
      toolpaths: res.toolpaths,
      tools: STARTER_TOOLS,
      material,
      boardBBox: bbox,
      boardShape: { top, bottom },
      grid: null
    })
    const kinds = new Map(res.toolpaths.map((t) => [t.stepId, t]))
    let milledSoFar: PolygonSet[] = []
    for (const tp of res.toolpaths) {
      const p = pts.get(tp.stepId)
      expect(p, tp.stepName).toBeTruthy()
      // never where an earlier step on the same side has already removed the copper
      for (const m of milledSoFar) expect(pointInPolygonSet(p!, m), tp.stepName).toBe(false)
      if (tp.stepKind === 'isolate') expect(p!.where).toBe('board centre')
      if (tp.stepKind === 'drill') {
        // the demo's holes are all on pads, cut off from the outer copper by the isolation:
        // the waste copper outside the board is used instead
        expect(['on a hole it drills', 'copper outside the board']).toContain(p!.where)
        if (p!.where === 'on a hole it drills')
          expect(
            tp.segments.some((s) => s.drill && Math.hypot(s.drill.x - p!.x, s.drill.y - p!.y) < 1e-6)
          ).toBe(true)
        else expect(pointInPolygonSet(p!, top)).toBe(false)
      }
      if (tp.stepKind === 'cutout')
        expect(['on the cutout line', 'copper outside the board']).toContain(p!.where)
      milledSoFar = [
        ...milledSoFar,
        milledArea(
          tp,
          STARTER_TOOLS.find((t) => t.id === tp.toolId)
        )
      ]
    }
    expect([...kinds.values()].some((t) => t.stepKind === 'drill')).toBe(true)
  })

  it('a drill hole on an isolated pad is not used: after isolation only outer copper conducts', async () => {
    const { res, material, bbox, top, bottom } = await job()
    const pts = touchOffPoints({
      toolpaths: res.toolpaths,
      tools: STARTER_TOOLS,
      material,
      boardBBox: bbox,
      boardShape: { top, bottom },
      grid: null
    })
    const iso = res.toolpaths.findIndex((t) => t.stepKind === 'isolate')
    const isoArea = milledArea(
      res.toolpaths[iso],
      STARTER_TOOLS.find((t) => t.id === res.toolpaths[iso].toolId)
    )
    for (const tp of res.toolpaths.slice(iso + 1)) {
      const p = pts.get(tp.stepId)
      if (!p) continue
      // the point is not inside an isolation groove
      expect(pointInPolygonSet(p, isoArea)).toBe(false)
    }
  })

  it("a bit's own point is used where the probe can work there, otherwise the automatic one (rejected)", async () => {
    const { res, material, bbox, top, bottom, stock } = await job()
    const req = {
      toolpaths: res.toolpaths,
      tools: STARTER_TOOLS,
      material,
      boardBBox: bbox,
      boardShape: { top, bottom },
      grid: null
    }
    const auto = touchOffPoints(req)
    const iso = res.toolpaths.find((t) => t.stepKind === 'isolate')!
    const cut = res.toolpaths.find((t) => t.stepKind === 'cutout')!
    // isolation: a corner of the sheet (all copper) is fine
    const corner = { x: stock.minX + 3, y: stock.minY + 3 }
    // cutout: the board centre (an isolated island by then) is not
    const centre = auto.get(iso.stepId)!
    const pts = touchOffPoints({ ...req, stepPoints: { [iso.stepId]: corner, [cut.stepId]: centre } })
    expect(pts.get(iso.stepId)).toMatchObject({ ...corner, own: true, stepId: iso.stepId, side: iso.side })
    const c = pts.get(cut.stepId)!
    expect(c.own).toBeFalsy()
    expect(c.rejected).toEqual({ x: centre.x, y: centre.y })
    expect({ x: c.x, y: c.y }).toEqual({ x: auto.get(cut.stepId)!.x, y: auto.get(cut.stepId)!.y })
  })

  it('no copper left → null (the file cannot find Z0 with the probe)', async () => {
    const { res, material, bbox, top, bottom, stock } = await job()
    // a fake first step that clears the whole sheet
    const wipe = {
      ...res.toolpaths[0],
      stepId: 'wipe',
      stepKind: 'clear' as const,
      segments: [
        {
          moves: Array.from({ length: Math.ceil((stock.maxY - stock.minY) / 0.5) + 1 }, (_, i) => [
            { kind: 'feed' as const, x: stock.minX - 1, y: stock.minY + i * 0.5, z: -0.1 },
            { kind: 'feed' as const, x: stock.maxX + 1, y: stock.minY + i * 0.5, z: -0.1 }
          ]).flat()
        }
      ]
    }
    const pts = touchOffPoints({
      toolpaths: [wipe, ...res.toolpaths.filter((t) => t.side === 'top')],
      tools: STARTER_TOOLS,
      material,
      boardBBox: bbox,
      boardShape: { top, bottom },
      grid: null
    })
    expect(pts.get('wipe')).toBeTruthy()
    for (const tp of res.toolpaths.filter((t) => t.side === 'top')) expect(pts.get(tp.stepId)).toBeNull()
  })

  it('touch-offs follow the file: one per bit, each with the step that comes after it', async () => {
    const { res, machine } = await job()
    for (const f of res.files) {
      const ids: (string | null)[] = []
      for (const m of f.lineMeta) ids[m.line] = m.stepId
      const order = touchOffStepOrder(f.text, ids)
      expect(order.length).toBeGreaterThan(0)
      expect(order.every((id) => id && f.stepIds.includes(id))).toBe(true)
      const pts = order.map((_, i) => ({ x: 10 + i, y: 20 + i }))
      const out = addZTouchOff(f.text, {
        x: 0,
        y: 0,
        feed: 50,
        safeZ: machine.safeZ,
        dialect: machine.postProcessor,
        points: pts
      })
      expect(out).toContain('find the copper at X10 Y20')
    }
  })
})

describe('height map relative to the touch-off point', () => {
  const map: HeightMap = buildHeightMap(
    [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0.1 },
      { x: 0, y: 10, z: 0 },
      { x: 10, y: 10, z: 0.1 }
    ],
    { ...defaultProbeGrid({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 10) }
  )
  const prog = ['G21 G90', 'M3 S10000', 'G0 X10 Y5', 'G1 Z-0.1 F100', 'G0 Z2', 'M5', 'M30'].join('\n')
  const zAt = (out: string): number => Number(/G1 X10 Y5 Z(-?[\d.]+)/.exec(out)![1])

  it('point 1 by default: the far side is 0.1 mm higher', () => {
    expect(zAt(applyHeightMap(prog, map))).toBeCloseTo(0, 4)
  })
  it('touched at X10: the depth there is the nominal depth', () => {
    expect(zAt(applyHeightMap(prog, map, { refs: [{ x: 10, y: 5 }] }))).toBeCloseTo(-0.1, 4)
  })
  it('Mach3 variables: the touch point is subtracted in the formula', () => {
    const vars: HeightMap = { ...map, z: map.z.map(() => 0), mach3Vars: 500 }
    const out = applyHeightMap(prog, vars, { refs: [{ x: 10, y: 0 }] })
    expect(out).toMatch(/G1 X10 Y5 Z\[-0\.1/)
    expect(out).toMatch(/-\[0\.5\*#501\]/)
  })
})
