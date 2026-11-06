import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  applyHeightMap,
  buildHeightMap,
  defaultProbeGrid,
  generateProbeProgram,
  heightMapStats,
  parseProbeResults,
  probePoints,
  sampleHeight
} from '@core/heightmap'
import { interpretGcode } from '@core/gcode'
import type { HeightMap, MachineProfile, PostProcessorId, ProbeGridConfig } from '@core/model/types'
import { machine } from '../post/sample'

const GOLDEN_DIR = resolve(__dirname, '../../../fixtures/heightmap')
const UPDATE = process.env.UPDATE_GOLDEN === '1'

const plane = (x: number, y: number): number => 0.01 * x - 0.02 * y

function planeMap(): HeightMap {
  const cfg: ProbeGridConfig = { ...defaultProbeGrid({ minX: 0, minY: 0, maxX: 40, maxY: 30 }, 10) }
  const pts = probePoints(cfg).map((p) => ({ x: p.x, y: p.y, z: plane(p.x, p.y) }))
  return buildHeightMap(pts, cfg)
}

describe('probe grid', () => {
  it('defaultProbeGrid', () => {
    const g = defaultProbeGrid({ minX: 0, minY: 0, maxX: 45, maxY: 30 })
    expect(g).toMatchObject({ countX: 6, countY: 4, probeFeed: 50, probeDepth: -2, clearanceZ: 2 })
    const tiny = defaultProbeGrid({ minX: 0, minY: 0, maxX: 3, maxY: 0 })
    expect(tiny.countX).toBe(2)
    expect(tiny.countY).toBe(2)
  })

  it('serpentine order', () => {
    const pts = probePoints({ ...defaultProbeGrid({ minX: 0, minY: 0, maxX: 20, maxY: 10 }) })
    expect(pts.map((p) => `${p.x},${p.y}`)).toEqual(['0,0', '10,0', '20,0', '20,10', '10,10', '0,10'])
  })
})

describe('probe programs (golden)', () => {
  const cfg = defaultProbeGrid({ minX: 0, minY: 0, maxX: 20, maxY: 10 })
  const dialects: PostProcessorId[] = ['grbl', 'linuxcnc', 'mach3', 'generic']
  for (const d of dialects) {
    it(d, () => {
      const m: MachineProfile = machine({ postProcessor: d, probeCommand: d === 'generic' ? 'G31' : 'G38.2' })
      const text = generateProbeProgram(cfg, m)
      const path = resolve(GOLDEN_DIR, `probe-${d}.golden.nc`)
      if (UPDATE) {
        if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true })
        writeFileSync(path, text)
      }
      expect(text).toBe(readFileSync(path, 'utf8'))
      const sim = interpretGcode(text)
      expect(sim.warnings).toEqual([])
      // never moves XY below the clearance height
      for (const mv of sim.moves) {
        if (Math.hypot(mv.to[0] - mv.from[0], mv.to[1] - mv.from[1]) > 1e-9)
          expect(mv.from[2]).toBeGreaterThanOrEqual(2)
      }
      const probes = text.split('\n').filter((l) => /^G(38\.2|31) /.test(l))
      expect(probes.length).toBe(6)
      expect(text).not.toMatch(/G92|G10/)
    })
  }
  it('dialect specifics', () => {
    expect(generateProbeProgram(cfg, machine({ postProcessor: 'linuxcnc' }))).toMatch(
      /\(PROBEOPEN probe-results.txt\)[\s\S]*\(PROBECLOSE\)/
    )
    expect(generateProbeProgram(cfg, machine({ postProcessor: 'mach3' }))).toMatch(
      /^M40 [\s\S]*^G31 Z-2 F50$[\s\S]*^M41 /m
    )
    expect(generateProbeProgram(cfg, machine({ postProcessor: 'grbl' }))).toMatch(/^G38.2 Z-2 F50$/m)
  })
})

describe('parseProbeResults', () => {
  it('GRBL PRB lines', () => {
    const log = 'ok\n[PRB:1.000,2.000,-0.123:1]\nok\n[PRB:11.000,2.000,-0.200:1]\n[PRB:5,5,-2:0]\n'
    const r = parseProbeResults(log)
    expect(r.format).toBe('grbl')
    expect(r.points).toEqual([
      { x: 1, y: 2, z: -0.123 },
      { x: 11, y: 2, z: -0.2 }
    ])
    expect(r.warnings.some((w) => w.includes('did not make contact'))).toBe(true)
    // grblHAL with 4+ axes
    expect(parseProbeResults('[PRB:1,2,3,0.000:1]').points).toEqual([{ x: 1, y: 2, z: 3 }])
  })

  it('LinuxCNC probe-results.txt', () => {
    const r = parseProbeResults(
      '0.000000 0.000000 -0.010000 0 0 0 0 0 0\n10.000000 0.000000 0.020000 0 0 0 0 0 0\n'
    )
    expect(r.format).toBe('linuxcnc')
    expect(r.points[1]).toEqual({ x: 10, y: 0, z: 0.02 })
  })

  it('Mach3 digitize file', () => {
    const r = parseProbeResults('0.0000,0.0000,-0.0100\r\n10.0000,0.0000,0.0200,0.0000,0.0000,0.0000\r\n')
    expect(r.format).toBe('mach3')
    expect(r.points.length).toBe(2)
  })

  it('CSV with header in any column order', () => {
    const r = parseProbeResults('id;Z;X;Y\n1;-0.1;0;0\n2;0.2;10;0\n')
    expect(r.format).toBe('csv')
    expect(r.points).toEqual([
      { x: 0, y: 0, z: -0.1 },
      { x: 10, y: 0, z: 0.2 }
    ])
    const r2 = parseProbeResults('x,y,z\n# comment\n0,0,1\n')
    expect(r2.format).toBe('csv')
    expect(r2.points).toEqual([{ x: 0, y: 0, z: 1 }])
  })

  it('unknown', () => {
    const r = parseProbeResults('hello world\n')
    expect(r.format).toBe('unknown')
    expect(r.points).toEqual([])
  })
})

describe('buildHeightMap / sampleHeight', () => {
  it('bilinear sampling is exact on a plane and clamps outside', () => {
    const map = planeMap()
    for (const [x, y] of [
      [0, 0],
      [3.3, 7.7],
      [25, 12.5],
      [40, 30],
      [17.1, 29.9]
    ])
      expect(sampleHeight(map, x, y)).toBeCloseTo(plane(x, y), 10)
    expect(sampleHeight(map, -10, -10)).toBeCloseTo(plane(0, 0), 10)
    expect(sampleHeight(map, 100, 100)).toBeCloseTo(plane(40, 30), 10)
    const st = heightMapStats(map)
    expect(st.min).toBeCloseTo(-0.6)
    expect(st.max).toBeCloseTo(0.4)
    expect(st.range).toBeCloseTo(1)
  })

  it('normalises to the first point, infers the grid and fills holes', () => {
    const cfg = defaultProbeGrid({ minX: 0, minY: 0, maxX: 20, maxY: 20 })
    const pts = probePoints(cfg)
      .map((p) => ({ x: p.x, y: p.y, z: plane(p.x, p.y) - 1.5 }))
      .filter((p) => !(p.x === 10 && p.y === 10))
    const map = buildHeightMap(pts)
    expect(map.config.countX).toBe(3)
    expect(map.config.countY).toBe(3)
    expect(map.z[0]).toBe(0)
    // centre cell filled by IDW of a plane: symmetric neighbours → exact plane value
    expect(map.z[4]).toBeCloseTo(plane(10, 10), 6)
  })

  it('realigns machine-coordinate (GRBL) points to the grid using the first point', () => {
    const cfg = defaultProbeGrid({ minX: 0, minY: 0, maxX: 20, maxY: 10 })
    const pts = probePoints(cfg).map((p) => ({ x: p.x - 150, y: p.y - 100, z: plane(p.x, p.y) - 30 }))
    const map = buildHeightMap(pts, cfg)
    expect(sampleHeight(map, 20, 10)).toBeCloseTo(plane(20, 10), 10)
  })

  it('throws on unusable data', () => {
    expect(() => buildHeightMap([])).toThrow()
    expect(() => buildHeightMap([{ x: 0, y: 0, z: 0 }])).toThrow(/2 x 2/)
  })
})

describe('applyHeightMap', () => {
  it('shifts Z by the tilted plane and subdivides long cuts', () => {
    const map = planeMap()
    const prog = [
      '%',
      'G21 G90',
      'G0 Z5',
      'G0 X0 Y10',
      'G1 Z-0.1 F100 (plunge)',
      'G1 X10 Y10',
      'G0 Z5',
      'M30',
      '%'
    ].join('\n')
    const out = applyHeightMap(prog, map, { maxSegmentLength: 1 })
    const lines = out.split('\n')
    expect(lines[0]).toBe('%')
    expect(lines[1]).toMatch(/^\(TraceMill: auto-levelled with 5x4 height map/)
    expect(lines).toContain('G0 Z5')
    expect(lines).toContain('G0 X0 Y10')
    expect(lines).toContain('G1 X0 Y10 Z-0.3 F100 (plunge)')
    const sim = interpretGcode(out)
    const cut = sim.moves.filter((m) => m.kind === 'feed' && m.to[2] < 0)
    // 10 mm at ≤1 mm pieces + plunge
    expect(cut.length).toBe(11)
    for (const m of cut) {
      expect(Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1])).toBeLessThanOrEqual(1 + 1e-9)
      expect(m.to[2]).toBeCloseTo(-0.1 + plane(m.to[0], m.to[1]), 4)
    }
    // rapid back up is untouched
    expect(sim.moves[sim.moves.length - 1].to[2]).toBe(5)
    expect(lines[lines.length - 1]).toBe('%')
  })

  it('linearises arcs, handles inches and relative mode', () => {
    const map = planeMap()
    const arc = applyHeightMap('G90 G0 X20 Y15\nG1 Z-0.1 F100\nG2 X30 Y15 I5 J0\nG0 Z5', map, {
      maxSegmentLength: 0.5
    })
    expect(arc).not.toMatch(/G2/)
    const sim = interpretGcode(arc)
    for (const m of sim.moves.filter((x) => x.to[2] < 0))
      expect(m.to[2]).toBeCloseTo(-0.1 + plane(m.to[0], m.to[1]), 3)

    const inch = applyHeightMap('G20 G90\nG0 X0 Y0 Z0.2\nG1 Z-0.004 F4\nG1 X1.0', map, {
      maxSegmentLength: 5
    })
    const si = interpretGcode(inch)
    const last = si.moves[si.moves.length - 1]
    expect(last.to[0]).toBeCloseTo(25.4, 3)
    expect(last.to[2]).toBeCloseTo(-0.1016 + plane(25.4, 0), 3)
    expect(si.moves.filter((m) => m.kind === 'feed').length).toBe(1 + 6)

    const rel = applyHeightMap('G90 G0 X0 Y10 Z1\nG91\nG1 Z-1.1 F100\nG1 X10\nG0 Z5\nG90 G0 X0', map, {
      maxSegmentLength: 2
    })
    const sr = interpretGcode(rel)
    const cut = sr.moves.filter((m) => m.kind === 'feed')
    for (const m of cut) expect(m.to[2]).toBeCloseTo(-0.1 + plane(m.to[0], m.to[1]), 4)
    // after the relative rapid up we are back at nominal +5 above the cut depth
    const up = sr.moves.find((m) => m.kind === 'rapid' && m.to[2] > 1)
    expect(up!.to[2]).toBeCloseTo(4.9, 6)
  })

  it('re-inserts the motion mode after rewritten arcs and offsets canned drill depths', () => {
    const map = planeMap()
    const out = applyHeightMap('G0 X20 Y15 Z1\nG1 Z-0.1 F100\nG2 X30 Y15 I5 J0\nZ2\nX40 Y15 I5 J0', map)
    expect(out.split('\n').pop()).toBe('G2 X40 Y15 I5 J0')
    const drill = applyHeightMap('G0 Z5\nG98 G81 X10 Y10 Z-1.8 R1 F60\nX20\nG80', map)
    expect(drill).toContain(`G98 G81 X10 Y10 Z${(-1.8 + plane(10, 10)).toFixed(1)} R1 F60`)
    expect(drill).toContain(`X20 Z${(-1.8 + plane(20, 10)).toFixed(1)}`)
  })
})
