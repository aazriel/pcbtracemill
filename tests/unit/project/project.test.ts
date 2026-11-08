import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PROJECT_FILE_EXT,
  deserializeProject,
  newProjectName,
  nextProjectName,
  projectFileBase,
  serializeProject
} from '@core/project'
import type { Project } from '@core/model/types'
import { MACHINES, TOOLS } from '../post/sample'

const GOLDEN = resolve(__dirname, '../../../fixtures/project/sample.golden.tmill')

function sampleProject(): Project {
  return {
    version: 1,
    name: 'demo',
    layers: [
      {
        id: 'l1',
        fileName: 'board-F_Cu.gbr',
        rawText: 'G04 test*\nM02*\n',
        type: 'copper',
        side: 'top',
        autoDetected: true,
        confidence: 0.9,
        visible: true,
        color: '#c87533',
        order: 0,
        stats: { widthMm: 10, heightMm: 5, points: 4, pads: 0, tracks: 1 },
        parsed: {
          format: 'gerber',
          geometry: [],
          objects: [],
          strokes: [],
          bbox: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
          fileAttributes: {},
          sourceUnits: 'mm',
          warnings: []
        }
      }
    ],
    machine: MACHINES.grbl,
    material: {
      width: 15,
      height: 10,
      thickness: 1.6,
      copperThickness: 0.035,
      offsetX: 2.5,
      offsetY: 2.5,
      rotation: 0,
      origin: 'bottom-left',
      doubleSided: false,
      alignment: { enabled: false, axis: 'x', pinDiameter: 3, margin: 5 },
      useDefaults: true
    },
    tools: TOOLS,
    steps: [
      {
        id: 's1',
        kind: 'isolate',
        name: 'Isolation',
        enabled: true,
        side: 'top',
        layerIds: ['l1'],
        toolId: 't-vbit',
        cutDepth: 0.05,
        safeZ: null,
        params: {
          isolation: { passes: 2, overlap: 0.4, direction: 'climb', extraClearance: 0 },
          clear: { overlap: 0.4, direction: 'climb', minIslandArea: 0, clearMargin: 0 },
          cutout: { tabs: 4, tabWidth: 2, tabHeight: 0.5, outside: true },
          drill: { peck: 0, retract: 1, minDiameter: 0, maxDiameter: 10, includeSlots: false },
          holeMill: { minDiameter: 1.2, maxDiameter: 10, helical: true }
        }
      }
    ],
    heightMap: {
      config: {
        minX: 0,
        minY: 0,
        maxX: 10,
        maxY: 10,
        countX: 2,
        countY: 2,
        probeFeed: 50,
        probeDepth: -2,
        clearanceZ: 2
      },
      z: [0, 0.1, -0.1, 0.05],
      source: 'probe'
    },
    settings: {
      edaTool: 'kicad',
      autoRegenerate: true,
      exportGrouping: 'combined',
      realisticColors: true,
      highlightOnHover: true
    }
  }
}

describe('project files', () => {
  it('round-trips and strips parsed caches', () => {
    const p = sampleProject()
    const text = serializeProject(p)
    expect(text).not.toContain('"parsed"')
    expect(text).toContain('G04 test*\\nM02*\\n')
    if (process.env.UPDATE_GOLDEN === '1') {
      if (!existsSync(resolve(GOLDEN, '..'))) mkdirSync(resolve(GOLDEN, '..'), { recursive: true })
      writeFileSync(GOLDEN, text)
    }
    expect(text).toBe(readFileSync(GOLDEN, 'utf8'))
    const back = deserializeProject(text)
    const expected = sampleProject()
    delete expected.layers[0].parsed
    expect(back).toEqual(expected)
    expect(p.layers[0].parsed).toBeDefined() // input not mutated
  })

  it('fills defaults for optional bits', () => {
    const o = JSON.parse(serializeProject(sampleProject()))
    delete o.settings
    delete o.heightMap
    delete o.format
    const back = deserializeProject(JSON.stringify(o))
    expect(back.heightMap).toBeNull()
    expect(back.settings.exportGrouping).toBe('per-step')
  })

  it('rejects invalid input with friendly messages', () => {
    expect(() => deserializeProject('nope')).toThrow(/not valid JSON/)
    expect(() => deserializeProject('[]')).toThrow(/project object/)
    expect(() => deserializeProject('{"format":"other","version":1}')).toThrow(/unknown file format/)
    expect(() => deserializeProject('{"version":1}')).toThrow(/"name" must be a string/)
    const o = JSON.parse(serializeProject(sampleProject()))
    o.version = 99
    expect(() => deserializeProject(JSON.stringify(o))).toThrow(/newer PCB TraceMill/)
    o.version = 1
    o.layers[0].rawText = 5
    expect(() => deserializeProject(JSON.stringify(o))).toThrow(/layers\[0\]\.rawText/)
    const o2 = JSON.parse(serializeProject(sampleProject()))
    o2.heightMap.z = [1]
    expect(() => deserializeProject(JSON.stringify(o2))).toThrow(/grid size/)
  })

  it('names and extension', () => {
    expect(PROJECT_FILE_EXT).toBe('tmill')
    expect(newProjectName(new Date(2026, 10, 4, 9, 5))).toBe('board-20261104-0905')
  })
})

describe('project names', () => {
  it('suggests the next free name', () => {
    expect(nextProjectName([])).toBe('my_pcb')
    expect(nextProjectName(['my_pcb'])).toBe('my_pcb 1')
    expect(nextProjectName(['my_pcb', 'my_pcb 1'])).toBe('my_pcb 2')
    expect(nextProjectName(['amp', 'my_pcb 1'])).toBe('my_pcb')
    expect(nextProjectName(['Amp'], 'amp')).toBe('amp 1')
    expect(nextProjectName(['amp'], 'filter')).toBe('filter')
    // compared as file names: "my_pcb 1" is saved as my_pcb_1.tmill
    expect(nextProjectName(['my_pcb', 'my_pcb_1'])).toBe('my_pcb 2')
    expect(projectFileBase(' my pcb 1 ')).toBe('my_pcb_1')
  })
})
