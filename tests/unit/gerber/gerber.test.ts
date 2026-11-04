import { describe, expect, it } from 'vitest'
import { isGerber, parseGerber } from '@core/gerber'
import { polygonSetArea, polygonSetBBox } from '@core/geometry'
import { fixture, MM_HEADER } from './helpers'

const area = (text: string): number => polygonSetArea(parseGerber(text).geometry)
const circleArea = (d: number): number => (Math.PI * d * d) / 4

describe('isGerber', () => {
  it('recognises Gerber files', () => {
    expect(isGerber(fixture('kicad_x2_copper.gbr'))).toBe(true)
    expect(isGerber(fixture('altium_x1_inch.gbr'))).toBe(true)
    expect(isGerber('G04 legacy*\nX100Y100D03*\nM02*')).toBe(true)
  })
  it('rejects Excellon and junk', () => {
    const excellon = 'M48\n;DRILL file\nMETRIC,TZ\nT1C0.800\n%\nG90\nT1\nX10.0Y10.0\nM30\n'
    expect(isGerber(excellon)).toBe(false)
    expect(isGerber('hello world')).toBe(false)
    expect(() => parseGerber('hello world', { fileName: 'x.txt' })).toThrow(/not a Gerber/)
  })
})

describe('KiCad X2 copper', () => {
  const layer = parseGerber(fixture('kicad_x2_copper.gbr'))

  it('reads file attributes and units', () => {
    expect(layer.format).toBe('gerber')
    expect(layer.sourceUnits).toBe('mm')
    expect(layer.fileAttributes['.FileFunction']).toBe('Copper,L1,Top')
    expect(layer.fileAttributes['.FilePolarity']).toBe('Positive')
    expect(layer.warnings).toEqual([])
  })

  it('counts objects by kind', () => {
    const kinds = layer.objects.map((o) => o.kind)
    expect(kinds.filter((k) => k === 'flash')).toHaveLength(5)
    expect(kinds.filter((k) => k === 'draw')).toHaveLength(4)
    expect(kinds.filter((k) => k === 'arc')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'region')).toHaveLength(2)
    expect(layer.strokes).toHaveLength(5)
    expect(layer.objects.map((o) => o.id)).toEqual(layer.objects.map((_, i) => i))
  })

  it('attaches aperture and object attributes', () => {
    const r1 = layer.objects[0]
    expect(r1.attributes).toMatchObject({
      '.AperFunction': 'SMDPad,CuDef',
      '.N': 'GND',
      '.P': 'R1,1',
      '.C': 'R1'
    })
    expect(layer.objects[1].attributes?.['.N']).toBe('VCC')
    const via = layer.objects.find((o) => o.aperture === 12)!
    expect(via.attributes).toEqual({ '.AperFunction': 'ViaPad', '.N': 'GND' })
    const track = layer.objects.find((o) => o.kind === 'draw')!
    expect(track.attributes).toEqual({ '.AperFunction': 'Conductor', '.N': 'GND' })
    const region = layer.objects.find((o) => o.kind === 'region')!
    expect(region.aperture).toBe(-1)
    expect(region.attributes).toEqual({ '.AperFunction': 'Conductor', '.N': 'GND' })
  })

  it('builds correct pad, macro and region shapes', () => {
    expect(polygonSetArea(layer.objects[0].shape)).toBeCloseTo(1.5, 6)
    // RoundRect 1.4 x 1.2 with r = 0.25 corners
    expect(polygonSetArea(layer.objects[2].shape)).toBeCloseTo(1.68 - (4 - Math.PI) * 0.0625, 2)
    const regions = layer.objects.filter((o) => o.kind === 'region')
    expect(polygonSetArea(regions[0].shape)).toBeCloseTo(100, 6)
    expect(polygonSetArea(regions[1].shape)).toBeCloseTo((Math.PI * 25) / 2, 1)
  })

  it('records track centre-lines with width', () => {
    expect(layer.strokes[0]).toEqual({
      path: [
        { x: 10, y: 10 },
        { x: 10, y: 15 }
      ],
      width: 0.25
    })
    const arc = layer.objects.find((o) => o.kind === 'arc')!
    const p = arc.path!
    expect(p[0]).toEqual({ x: 20, y: 15 })
    expect(p[p.length - 1]).toEqual({ x: 25, y: 20 })
    for (const v of p) expect(Math.hypot(v.x - 20, v.y - 20)).toBeCloseTo(5, 6)
    // CCW quarter arc from -90° to 0° stays in the lower-right quadrant of its centre
    for (const v of p) expect(v.x).toBeGreaterThanOrEqual(20 - 1e-9)
  })

  it('unions geometry and computes bbox', () => {
    const a = polygonSetArea(layer.geometry)
    const sum = layer.objects.reduce((s, o) => s + polygonSetArea(o.shape), 0)
    expect(a).toBeLessThan(sum)
    expect(a).toBeGreaterThan(139)
    expect(layer.bbox.minX).toBeCloseTo(9.25, 6)
    expect(layer.bbox.minY).toBeCloseTo(0, 6)
    expect(layer.bbox.maxX).toBeCloseTo(55, 6)
    expect(layer.bbox.maxY).toBeCloseTo(20.125, 2)
  })
})

describe('Altium X1 inch file', () => {
  const layer = parseGerber(fixture('altium_x1_inch.gbr'))

  it('converts inches to mm', () => {
    expect(layer.sourceUnits).toBe('inch')
    const flashes = layer.objects.filter((o) => o.kind === 'flash')
    expect(flashes).toHaveLength(4)
    expect(flashes[0].center!.x).toBeCloseTo(2.54, 9)
    expect(flashes[0].center!.y).toBeCloseTo(2.54, 9)
    expect(polygonSetArea(flashes[0].shape)).toBeCloseTo(0.06 * 0.08 * 25.4 * 25.4, 6)
    const ob = flashes[2]
    const obArea = (0.06 * 0.04 + circleArea(0.06)) * 645.16
    expect(polygonSetArea(ob.shape)).toBeCloseTo(obArea, 1)
    const b = polygonSetBBox(ob.shape)
    expect(b.maxY - b.minY).toBeCloseTo(2.54, 3)
    // Hexagon with circumscribed diameter 0.1"
    const r = 1.27
    expect(polygonSetArea(flashes[3].shape)).toBeCloseTo(((3 * Math.sqrt(3)) / 2) * r * r, 6)
  })

  it('handles modal coordinates, G54 selects and single-quadrant arcs', () => {
    const strokes = layer.strokes
    expect(strokes).toHaveLength(4)
    expect(strokes[0].width).toBeCloseTo(0.254, 9)
    expect(strokes[1].path[1].x).toBeCloseTo(7.62, 9)
    expect(strokes[1].path[1].y).toBeCloseTo(7.62, 9)
    const arc = layer.objects.find((o) => o.kind === 'arc')!
    for (const v of arc.path!) expect(Math.hypot(v.x - 5.08, v.y - 7.62)).toBeCloseTo(2.54, 6)
    expect(arc.path![arc.path!.length - 1].x).toBeCloseTo(5.08, 9)
    expect(arc.path![arc.path!.length - 1].y).toBeCloseTo(10.16, 9)
  })

  it('sweeps rectangular apertures', () => {
    const rectDraw = layer.objects[layer.objects.length - 1]
    expect(rectDraw.kind).toBe('draw')
    // 0.1" travel along X with a 0.06 x 0.08 rectangle: (0.1+0.06) x 0.08
    expect(polygonSetArea(rectDraw.shape)).toBeCloseTo(0.16 * 0.08 * 645.16, 6)
    expect(layer.warnings).toContain('Deprecated G70 (inch) unit command')
  })
})

describe('aperture macros', () => {
  const layer = parseGerber(fixture('macros.gbr'))
  const shapeArea = (ap: number): number =>
    polygonSetArea(layer.objects.find((o) => o.aperture === ap)!.shape)

  it('evaluates all primitives', () => {
    expect(layer.objects).toHaveLength(10)
    expect(shapeArea(11)).toBeCloseTo(4, 9) // outline square 2x2
    expect(shapeArea(12)).toBeCloseTo(2, 3) // rotated 2x1 centre line
    expect(shapeArea(13)).toBeCloseTo(circleArea(3) - circleArea(1.5), 1) // variables + exposure off
    expect(shapeArea(14)).toBeCloseTo(1.5, 9) // vector line 3 x 0.5
    expect(shapeArea(15)).toBeCloseTo(((3 * Math.sqrt(3)) / 2) * 1, 3) // hexagon d=2
    expect(shapeArea(17)).toBeCloseTo(circleArea(1.5), 1) // comment skipped
    expect(shapeArea(18)).toBeCloseTo(2 - circleArea(0.5), 1) // P with rotation and hole
    expect(shapeArea(19)).toBeCloseTo(2, 9) // lower-left line
  })

  it('builds thermal reliefs with gaps', () => {
    const th = layer.objects.find((o) => o.aperture === 10)!
    const a = polygonSetArea(th.shape)
    expect(a).toBeLessThan(circleArea(3) - circleArea(2))
    expect(a).toBeGreaterThan(circleArea(3) - circleArea(2) - 4 * 0.4 * 0.5 - 0.05)
    expect(th.shape).toHaveLength(4)
    // gaps rotated by 45°: points on the axes are copper
    const b = polygonSetBBox(th.shape)
    expect(b.maxX).toBeCloseTo(1.5, 2)
  })

  it('rotates rectangles about the macro origin', () => {
    const o = layer.objects.find((x) => x.aperture === 12)!
    const b = polygonSetBBox(o.shape)
    const c = Math.cos(Math.PI / 6)
    const s = Math.sin(Math.PI / 6)
    expect(b.maxX - b.minX).toBeCloseTo(2 * c + 1 * s, 3)
    const v = layer.objects.find((x) => x.aperture === 14)!
    const vb = polygonSetBBox(v.shape)
    expect(vb.maxY - vb.minY).toBeCloseTo(3, 9)
    expect(vb.maxX - vb.minX).toBeCloseTo(0.5, 9)
  })

  it('warns on deprecated primitives', () => {
    expect(layer.warnings.some((w) => w.includes('moiré'))).toBe(true)
    expect(layer.warnings.some((w) => w.includes('primitive 22'))).toBe(true)
  })

  it('handles macro arithmetic precedence and parentheses', () => {
    const text = `${MM_HEADER}%AMX*$3=$1+$2x2-(1-$1)/2*21,1,$3,1,0,0,0*%\n%ADD10X,1X2*%\nD10*X0Y0D03*M02*`
    // $3 = 1 + 4 - 0 = 5
    expect(area(text)).toBeCloseTo(5, 9)
    const neg = `${MM_HEADER}%AMY*21,1,-$1x-2,1,0,0,0*%\n%ADD10Y,1.5*%\nD10*X0Y0D03*M02*`
    expect(area(neg)).toBeCloseTo(3, 9)
  })
})

describe('polarity', () => {
  it('clear objects remove previously painted dark geometry', () => {
    const layer = parseGerber(fixture('clear_polarity.gbr'))
    expect(layer.objects.map((o) => o.polarity)).toEqual(['dark', 'clear', 'dark'])
    expect(polygonSetArea(layer.geometry)).toBeCloseTo(100 - circleArea(4) + circleArea(1), 0)
    expect(layer.geometry).toHaveLength(2)
    expect(layer.geometry.some((p) => p.holes.length === 1)).toBe(true)
  })

  it('clear before dark does not affect later dark', () => {
    const t = `${MM_HEADER}%ADD10C,2*%%LPC*%D10*X0Y0D03*%LPD*%X0Y0D03*M02*`
    expect(area(t)).toBeCloseTo(circleArea(2), 1)
  })

  it('aperture holes are transparent, not clearing', () => {
    const t = `${MM_HEADER}%ADD10R,4X4*%%ADD11C,3X1*%D10*X0Y0D03*D11*X0Y0D03*M02*`
    expect(area(t)).toBeCloseTo(16, 6)
    const t2 = `${MM_HEADER}%ADD11C,3X1*%D11*X0Y0D03*M02*`
    expect(area(t2)).toBeCloseTo(circleArea(3) - circleArea(1), 1)
  })
})

describe('step & repeat and aperture blocks', () => {
  const layer = parseGerber(fixture('step_repeat.gbr'))
  it('replicates objects', () => {
    expect(layer.objects).toHaveLength(10)
    const rects = layer.objects.filter((o) => o.aperture === 10)
    expect(rects.map((o) => [o.center!.x, o.center!.y])).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
      [0, 4],
      [5, 4],
      [10, 4]
    ])
    expect(layer.bbox.minX).toBeCloseTo(-0.5, 9)
    expect(layer.bbox.minY).toBeCloseTo(-1, 9)
  })
  it('flashes blocks at the flash point', () => {
    const circles = layer.objects.filter((o) => o.aperture === 21)
    expect(circles.map((o) => [o.center!.x, o.center!.y])).toEqual([
      [20, 0],
      [22, 0],
      [20, 10],
      [22, 10]
    ])
    expect(polygonSetArea(layer.geometry)).toBeCloseTo(12 + 4 * circleArea(1), 1)
  })
  it('toggles block polarity when flashed with LPC', () => {
    const t = `${MM_HEADER}%ADD10R,10X10*%%ABD20*%%ADD21C,2*%D21*X0Y0D03*%AB*%D10*X0Y0D03*%LPC*%D20*X0Y0D03*M02*`
    const l = parseGerber(t)
    expect(l.objects[1].polarity).toBe('clear')
    expect(polygonSetArea(l.geometry)).toBeCloseTo(100 - circleArea(2), 1)
  })
})

describe('outline layer', () => {
  const layer = parseGerber(fixture('outline.gbr'))
  it('keeps thin-line strokes', () => {
    expect(layer.fileAttributes['.FileFunction']).toBe('Profile,NP')
    expect(layer.strokes).toHaveLength(5)
    expect(layer.strokes.every((s) => Math.abs(s.width - 0.05) < 1e-12)).toBe(true)
    expect(layer.bbox.minX).toBeCloseTo(-0.025, 6)
    expect(layer.bbox.maxX).toBeCloseTo(50.025, 6)
    expect(layer.bbox.maxY).toBeCloseTo(30.025, 6)
  })
  it('falls back to stroke bbox for zero-width outlines', () => {
    const t = `${MM_HEADER}%ADD10C,0*%D10*X0Y0D02*X10000000Y0D01*X10000000Y5000000D01*M02*`
    const l = parseGerber(t)
    expect(l.geometry).toEqual([])
    expect(l.bbox).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 5 })
  })
})

describe('format and syntax', () => {
  it('trailing-zero omission', () => {
    const t = '%FSTAX24Y24*%%MOIN*%%ADD10C,0.1*%D10*X01Y015D03*M02*'
    const l = parseGerber(t)
    expect(l.objects[0].center!.x).toBeCloseTo(25.4, 9)
    expect(l.objects[0].center!.y).toBeCloseTo(38.1, 9)
  })

  it('negative and signed coordinates', () => {
    const l = parseGerber(`${MM_HEADER}%ADD10C,1*%D10*X-1500000Y+2000000D03*M02*`)
    expect(l.objects[0].center).toEqual({ x: -1.5, y: 2 })
  })

  it('tolerates newlines anywhere and multiple commands per extended block', () => {
    const t = '%FSLAX46Y46*MOMM*%\n%ADD1\n0C,1.0*%\nD1\n0*\nX10\n00000Y0D\n03*\nM02*'
    const l = parseGerber(t)
    expect(l.objects).toHaveLength(1)
    expect(l.objects[0].center).toEqual({ x: 1, y: 0 })
  })

  it('combined modal codes in one block and deprecated modal coordinates', () => {
    const t = `${MM_HEADER}%ADD10C,1*%G01D10*X0Y0D02*G01X1000000Y0D01*X2000000Y0*G75G02X4000000Y0I1000000J0D01*M02*`
    const l = parseGerber(t)
    expect(l.objects.map((o) => o.kind)).toEqual(['draw', 'draw', 'arc'])
    const arc = l.objects[2].path!
    // CW from 180° to 0° about (3,0): passes through y = +1
    expect(Math.max(...arc.map((v) => v.y))).toBeCloseTo(1, 6)
    expect(l.warnings.some((w) => w.includes('without D code'))).toBe(true)
  })

  it('full circle with G75 when start equals end', () => {
    const t = `${MM_HEADER}%ADD10C,0.1*%D10*G75*X1000000Y0D02*G03X1000000Y0I-1000000J0D01*M02*`
    const l = parseGerber(t)
    const a = polygonSetArea(l.geometry)
    expect(a).toBeCloseTo(2 * Math.PI * 1 * 0.1, 2)
  })

  it('region with multiple contours and arcs', () => {
    const t = `${MM_HEADER}G36*X0Y0D02*G01X2000000Y0D01*X2000000Y2000000D01*X0Y2000000D01*X0Y0D01*X5000000Y0D02*G75G03X5000000Y0I1000000J0D01*G37*M02*`
    const l = parseGerber(t)
    expect(l.objects.filter((o) => o.kind === 'region')).toHaveLength(2)
    expect(polygonSetArea(l.geometry)).toBeCloseTo(4 + Math.PI, 1)
  })

  it('region with a cut-in hole', () => {
    // outer 10x10 CCW, cut in to a 4x4 hole traversed CW
    const pts = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 3],
      [3, 3],
      [3, 7],
      [7, 7],
      [7, 3],
      [3, 3],
      [0, 3],
      [0, 0]
    ]
    const body = pts.map(([x, y], i) => `X${x * 1e6}Y${y * 1e6}D0${i === 0 ? 2 : 1}*`).join('')
    const l = parseGerber(`${MM_HEADER}G01*G36*${body}G37*M02*`)
    expect(polygonSetArea(l.geometry)).toBeCloseTo(100 - 16, 6)
    expect(l.geometry[0].holes).toHaveLength(1)
  })

  it('G70/G71 deprecated units and missing FS/MO produce warnings, not errors', () => {
    const l = parseGerber('G04 old*\n%ADD10C,0.01*%\nG71*\nD10*\nX100Y100D03*\nM02*')
    // The aperture was defined before any unit command, so it is read in (assumed) inches.
    expect(l.sourceUnits).toBe('mm')
    expect(l.warnings.some((w) => w.includes('assuming inches'))).toBe(true)
    expect(l.warnings.some((w) => w.includes('%FS'))).toBe(true)
    expect(l.warnings).toContain('Deprecated G71 (mm) unit command')
    expect(l.objects[0].center!.x).toBeCloseTo(0.0001, 9)
  })

  it('KiCad legacy attributes in G04 #@! comments', () => {
    const t = `G04 #@! TF.FileFunction,Copper,L2,Bot*\n${MM_HEADER}G04 #@! TA.AperFunction,ViaPad*\n%ADD10C,1*%\nG04 #@! TD*\nG04 #@! TO.N,Net-1*\nD10*X0Y0D03*M02*`
    const l = parseGerber(t)
    expect(l.fileAttributes['.FileFunction']).toBe('Copper,L2,Bot')
    expect(l.objects[0].attributes).toEqual({ '.AperFunction': 'ViaPad', '.N': 'Net-1' })
  })

  it('%TD with a name deletes only that attribute', () => {
    const t = `${MM_HEADER}%ADD10C,1*%%TO.N,A*%%TO.C,U1*%%TD.N*%D10*X0Y0D03*M02*`
    expect(parseGerber(t).objects[0].attributes).toEqual({ '.C': 'U1' })
  })

  it('recovers from garbage words with a warning', () => {
    const l = parseGerber(`${MM_HEADER}%ADD10C,1*%D10*X0Y0D03*Q??*X1000000Y0D03*M02*`)
    expect(l.objects).toHaveLength(2)
    expect(l.warnings.length).toBeGreaterThan(0)
  })
})

describe('load transforms', () => {
  it('%LR rotates, %LM mirrors and %LS scales flashes', () => {
    const t = `${MM_HEADER}%ADD10R,2X1*%D10*%LR90*%X0Y0D03*%LR0*%%LS2*%X10000000Y0D03*%LS1*%%LMX*%%LR30*%X20000000Y0D03*M02*`
    const l = parseGerber(t)
    const b0 = polygonSetBBox(l.objects[0].shape)
    expect(b0.maxX - b0.minX).toBeCloseTo(1, 9)
    expect(b0.maxY - b0.minY).toBeCloseTo(2, 9)
    expect(polygonSetArea(l.objects[1].shape)).toBeCloseTo(8, 9)
    expect(polygonSetArea(l.objects[2].shape)).toBeCloseTo(2, 9)
  })

  it('%LS scales circular draw width', () => {
    const t = `${MM_HEADER}%ADD10C,1*%%LS0.5*%D10*X0Y0D02*X10000000Y0D01*M02*`
    expect(parseGerber(t).strokes[0].width).toBeCloseTo(0.5, 9)
  })
})

describe('image transforms (deprecated)', () => {
  it('applies %OF offset and %MI mirror', () => {
    const t = `${MM_HEADER}%OFA1.0B2.0*%%ADD10C,1*%D10*X1000000Y1000000D03*M02*`
    expect(parseGerber(t).objects[0].center).toEqual({ x: 2, y: 3 })
    const m = parseGerber(`${MM_HEADER}%MIA1B0*%%ADD10C,1*%D10*X1000000Y1000000D03*M02*`)
    expect(m.objects[0].center).toEqual({ x: -1, y: 1 })
    expect(polygonSetArea(m.geometry)).toBeGreaterThan(0.7)
  })
})
