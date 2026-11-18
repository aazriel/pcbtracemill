import { describe, expect, it } from 'vitest'
import { parseToolLibrary, serializeToolLibrary, STARTER_TOOLS } from '@core/tools'
import type { Tool } from '@core/model/types'

const mine: Tool = { ...STARTER_TOOLS[0], id: 'my-vbit', name: 'My 10° V-bit', builtIn: false }

describe('tool library files (.tmtools)', () => {
  it('round-trips the own tools and leaves the starter kit out', () => {
    const text = serializeToolLibrary([...STARTER_TOOLS, mine], '0.1.2')
    const back = parseToolLibrary(text)
    expect(back.tools).toEqual([mine])
    expect(back.skipped).toEqual([])
    expect(JSON.parse(text).app).toBe('0.1.2')
  })

  it('reads the own tools of a project file', () => {
    const project = JSON.stringify({ format: 'tracemill-project', version: 2, tools: [...STARTER_TOOLS, mine] })
    expect(parseToolLibrary(project).tools.map((t) => t.id)).toEqual(['my-vbit'])
  })

  it('refuses foreign files and files from a newer version', () => {
    expect(() => parseToolLibrary('nope')).toThrow(/not a PCB TraceMill tool library/)
    expect(() => parseToolLibrary('{"format":"x"}')).toThrow(/not a PCB TraceMill tool library/)
    const newer = JSON.stringify({ format: 'pcb-tracemill-tools', version: 9, app: '3.0.0', tools: [] })
    expect(() => parseToolLibrary(newer)).toThrow(/newer PCB TraceMill \(3\.0\.0\)/)
  })

  it('skips broken tools with a reason', () => {
    const bad = { ...mine, id: 'bad', name: 'Broken', geometry: { ...mine.geometry, diameter: -1 } }
    const r = parseToolLibrary(serializeToolLibrary([mine, bad]))
    expect(r.tools.map((t) => t.id)).toEqual(['my-vbit'])
    expect(r.skipped[0]).toMatch(/^Broken:/)
  })
})
