import { describe, expect, it } from 'vitest'
import { STARTER_TOOLS, withStarterTools } from '@core/tools'
import type { Tool } from '@core/model/types'

const own: Tool = { ...STARTER_TOOLS[0], id: 'tool-own', name: 'My V-bit', builtIn: false }

describe('withStarterTools', () => {
  it('puts the starter tools back when only saved tools are left (new-project bug)', () => {
    const out = withStarterTools([own])
    expect(out.filter((t) => t.builtIn)).toHaveLength(STARTER_TOOLS.length)
    expect(out.at(-1)).toBe(own)
    expect(out.some((t) => t.type === 'drill')).toBe(true)
    expect(out[0]).not.toBe(STARTER_TOOLS[0]) // copies, not the shared objects
  })

  it('leaves a list with built-in tools alone', () => {
    const tools = [STARTER_TOOLS[0], own]
    expect(withStarterTools(tools)).toBe(tools)
  })
})
