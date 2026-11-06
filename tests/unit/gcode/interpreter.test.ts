import { interpretGcode, tokenizeLine, gcodeLanguageKeywords } from '@core/gcode'

const close = (a: number[], b: number[], d = 6): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d))

describe('tokenizeLine', () => {
  it('splits words, comments and line numbers, case-insensitive', () => {
    const t = tokenizeLine('n10 g1x1.5 Y-2 z.5 (cut) f100 ; tail')
    expect(t.words.map((w) => `${w.letter}${w.value}`)).toEqual(['N10', 'G1', 'X1.5', 'Y-2', 'Z0.5', 'F100'])
    expect(t.comments).toEqual(['cut', 'tail'])
    expect(tokenizeLine('G38.2 Z-2 F50').words[0].value).toBeCloseTo(38.2)
    expect(tokenizeLine('%').percent).toBe(true)
    expect(tokenizeLine('G1 X#1').errors.length).toBe(0)
    expect(tokenizeLine('G1 X#1', new Map([[1, 2.5]])).words[1].value).toBe(2.5)
    expect(tokenizeLine('G1 Z[-0.1+[0.25*#512]]', new Map([[512, 0.4]])).words[1].value).toBeCloseTo(0)
    expect(
      tokenizeLine(
        '#500=[#5213-#498]',
        new Map([
          [5213, 3],
          [498, 1]
        ])
      ).assigns
    ).toEqual([{ param: 500, value: 2 }])
    expect(tokenizeLine('G1 X[1+').errors.length).toBe(1)
  })
})

describe('interpretGcode', () => {
  it('handles rapids, feeds and time', () => {
    const r = interpretGcode('G21 G90\nG0 X10\nG1 Y60 F600\nM30', { rapidFeed: 600 })
    expect(r.moves.length).toBe(2)
    expect(r.moves[0].kind).toBe('rapid')
    expect(r.moves[1].line).toBe(2)
    // 10 mm @600 = 1 s, 60 mm @600 = 6 s
    expect(r.totalSeconds).toBeCloseTo(7, 6)
    expect(r.moves[1].tEnd).toBeCloseTo(7, 6)
    expect(r.warnings).toEqual(['Line 3: cutting move while the spindle is off'])
    close(r.bounds.max, [10, 60, 0])
  })

  it('arcs in I/J and R form end at the same place with the right path length', () => {
    const ij = interpretGcode('M3\nG1 X10 Y0 F100\nG3 X0 Y10 I-10 J0')
    const rr = interpretGcode('M3\nG1 X10 Y0 F100\nG3 X0 Y10 R10')
    for (const r of [ij, rr]) {
      const arc = r.moves.filter((m) => m.line === 2)
      expect(arc.length).toBeGreaterThan(10)
      close(arc[arc.length - 1].to, [0, 10, 0])
      // all points on the circle of radius 10 about origin
      for (const m of arc) expect(Math.hypot(m.to[0], m.to[1])).toBeCloseTo(10, 6)
      // quarter circle length 15.708 @100 mm/min ≈ 9.42 s (+6 s for the first line)
      expect(r.totalSeconds).toBeCloseTo(6 + (Math.PI * 5 * 60) / 100, 1)
      expect(r.warnings).toEqual([])
    }
    // negative R = major arc (270°), CW
    const major = interpretGcode('M3\nG1 X10 F100\nG2 X0 Y10 R-10')
    const pts = major.moves.filter((m) => m.line === 2)
    expect(Math.min(...pts.map((m) => m.to[1]))).toBeLessThan(-9.9)
    // full circle with I/J
    const full = interpretGcode('M3\nG1 X5 F100\nG2 X5 Y0 I-5 J0')
    const len = full.moves
      .filter((m) => m.line === 2)
      .reduce((s, m) => s + Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]), 0)
    expect(len).toBeCloseTo(2 * Math.PI * 5, 1)
  })

  it('helical arcs interpolate Z', () => {
    const r = interpretGcode('M3\nG1 X1 F100\nG3 X1 Y0 Z-1 I-1 J0')
    const arc = r.moves.filter((m) => m.line === 2)
    expect(arc[arc.length - 1].to[2]).toBeCloseTo(-1)
    expect(arc[Math.floor(arc.length / 2)].to[2]).toBeCloseTo(-0.5, 1)
  })

  it('inches and relative mode', () => {
    const r = interpretGcode('G20 G91\nG0 X1 Y1\nG0 X1\nG21\nG0 Y-25.4\nG90 G0 X0')
    close(r.moves[0].to, [25.4, 25.4, 0])
    close(r.moves[1].to, [50.8, 25.4, 0])
    close(r.moves[2].to, [50.8, 0, 0])
    close(r.moves[3].to, [0, 0, 0])
    // inch feeds converted
    const f = interpretGcode('G20 M3\nG1 X1 F10')
    expect(f.moves[0].feed).toBeCloseTo(254)
    expect(f.totalSeconds).toBeCloseTo(6)
  })

  it('expands G83 peck cycles with G98 / G99 and modal repeats', () => {
    const r = interpretGcode('M3\nG0 Z5\nG98 G83 X1 Y1 Z-1.5 R1 Q0.5 F60\nX2\nG80\nG0 X0', {
      rapidFeed: 6000
    })
    const l2 = r.moves.filter((m) => m.line === 2)
    const feeds = l2.filter((m) => m.kind === 'feed').map((m) => m.to[2])
    expect(feeds.map((z) => +z.toFixed(4))).toEqual([0.5, 0, -0.5, -1, -1.5])
    // pecks of 0.5 from R=1 down to -1.5 → 5 feed moves
    expect(feeds.length).toBe(5)
    // G98 returns to the initial level (Z5)
    expect(l2[l2.length - 1].to[2]).toBe(5)
    const l3 = r.moves.filter((m) => m.line === 3)
    expect(l3[0].to).toEqual([2, 1, 5])
    expect(l3.filter((m) => m.kind === 'feed').length).toBe(5)
    // G80 cancels: G0 X0 is a plain rapid
    expect(r.moves[r.moves.length - 1].to).toEqual([0, 1, 5])

    const g99 = interpretGcode('M3\nG0 Z5\nG99 G81 X1 Y1 Z-1 R1 F60\nG80')
    expect(g99.moves[g99.moves.length - 1].to[2]).toBe(1)
    // feed time: 2 mm @60 = 2 s
    expect(g99.moves.filter((m) => m.kind === 'feed').length).toBe(1)
  })

  it('G4 dwell, pauses, tool changes, G28 warning, lineMeta and program end', () => {
    const text =
      '(header)\nT2 M6\nM3 S1000\nG4 P2.5\n(Insert tool)\nM0\nM1 (optional)\nG28\nG0 X10\nM30\nG0 X99'
    const meta = text
      .split('\n')
      .map((_, i) => ({ line: i, stepId: i === 8 ? 's1' : null, toolId: i === 8 ? 't1' : null }))
    const r = interpretGcode(text, { lineMeta: meta, rapidFeed: 600 })
    expect(r.toolChanges).toEqual([{ line: 1, tool: 2 }])
    expect(r.pauses).toEqual([
      { line: 5, comment: 'Insert tool' },
      { line: 6, comment: 'optional' }
    ])
    expect(r.totalSeconds).toBeCloseTo(3.5)
    expect(r.moves.length).toBe(1)
    expect(r.moves[0].stepId).toBe('s1')
    expect(r.moves[0].toolId).toBe('t1')
    expect(r.warnings.some((w) => w.includes('G28'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('program end'))).toBe(true)
  })

  it('treats probe moves as feeds and uses the initial position', () => {
    const r = interpretGcode('G38.2 Z-2 F50\nG31 Z-3', { initial: [1, 2, 3] })
    expect(r.moves[0].from).toEqual([1, 2, 3])
    expect(r.moves[0].kind).toBe('feed')
    expect(r.moves[1].to).toEqual([1, 2, -3])
    expect(r.warnings).toEqual([])
  })

  it('exports keyword lists', () => {
    expect(gcodeLanguageKeywords.gCodes.find((k) => k.code === 'G83')).toBeTruthy()
    expect(gcodeLanguageKeywords.mCodes.find((k) => k.code === 'M6')).toBeTruthy()
  })
})
