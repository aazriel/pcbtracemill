import { describe, expect, it } from 'vitest'
import { parseGerber } from '@core/gerber'
import { polygonSetArea } from '@core/geometry'

/** Synthetic 2-layer-board-like copper: ~2.5k pads + ~2.5k tracks + a few zones. */
function syntheticBoard(): string {
  const lines: string[] = [
    '%TF.FileFunction,Copper,L1,Top*%',
    '%FSLAX46Y46*%',
    '%MOMM*%',
    '%TA.AperFunction,SMDPad,CuDef*%',
    '%ADD10R,1.2X0.6*%',
    '%TA.AperFunction,ComponentPad*%',
    '%ADD11C,1.6*%',
    '%TA.AperFunction,Conductor*%',
    '%ADD12C,0.25*%',
    '%TD*%'
  ]
  const u = (v: number): number => Math.round(v * 1e6)
  let n = 0
  for (let i = 0; i < 50; i++) {
    for (let j = 0; j < 50; j++) {
      const x = i * 2.54
      const y = j * 2.54
      lines.push(n % 2 ? 'D10*' : 'D11*')
      lines.push(`%TO.N,N${n % 97}*%`, `X${u(x)}Y${u(y)}D03*`, '%TD*%')
      lines.push('D12*', `X${u(x)}Y${u(y)}D02*`, `X${u(x + 1.27)}Y${u(y + 1.27)}D01*`)
      n++
    }
  }
  for (let k = 0; k < 4; k++) {
    const x0 = 130 + k * 12
    lines.push(
      'G36*',
      `X${u(x0)}Y0D02*`,
      `X${u(x0 + 10)}Y0D01*`,
      `X${u(x0 + 10)}Y${u(100)}D01*`,
      `X${u(x0)}Y${u(100)}D01*`,
      `X${u(x0)}Y0D01*`,
      'G37*'
    )
  }
  lines.push('M02*')
  return lines.join('\n')
}

describe('gerber performance', () => {
  it('parses a 5k-object copper layer well under 2 s', () => {
    const text = syntheticBoard()
    const t0 = performance.now()
    const layer = parseGerber(text)
    const ms = performance.now() - t0
    expect(layer.objects.length).toBe(5004)
    expect(polygonSetArea(layer.geometry)).toBeGreaterThan(4000)
    expect(ms).toBeLessThan(2000)
  })
})
