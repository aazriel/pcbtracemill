import type { Project } from '../model/types'

/** File extension of PCB TraceMill project files (without dot). */
export const PROJECT_FILE_EXT = 'tmill'
/**
 * Current .tmill format version. 2: the file records the app version that saved it (`app`), and an
 * older app refuses a project from a newer one (D-039). Version 1 builds (0.1.x) refuse version 2.
 */
export const PROJECT_VERSION = 2 as const
/** Marker written into every project file so foreign JSON is rejected with a clear message. */
const FORMAT_MARKER = 'tracemill-project'

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type Obj = { [k: string]: unknown }

/** Default project name: "board-YYYYMMDD-HHMM" (local time). */
export function newProjectName(date: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `board-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`
}

/** The default name of a project nobody has named yet. */
export const UNNAMED_PROJECT = 'Untitled board'

/** "my_pcb 2" -> "my_pcb" */
export function projectNameBase(name: string): string {
  return name.trim().replace(/\s+\d+$/, '')
}

/** The file name (without .tmill) a project is saved under: "my pcb 1" -> "my_pcb_1". */
export function projectFileBase(name: string): string {
  return (
    name
      .trim()
      .replace(/[^a-z0-9_-]+/gi, '_')
      .replace(/^_+|_+$/g, '') || 'board'
  )
}

/**
 * A project name whose file is free: `wanted` (default "my_pcb") when no project in `used` (names
 * or file names, compared as file names) has it, otherwise the next free number ("my_pcb 1").
 */
export function nextProjectName(used: string[], wanted?: string): string {
  const taken = new Set(used.map((n) => projectFileBase(n).toLowerCase()))
  const free = (n: string): boolean => !taken.has(projectFileBase(n).toLowerCase())
  const name = (wanted ?? '').trim() || 'my_pcb'
  if (free(name)) return name
  const base = projectNameBase(name)
  for (let i = 1; ; i++) if (free(`${base} ${i}`)) return `${base} ${i}`
}

/**
 * Pretty JSON for a .tmill file. Parsed layer caches are stripped; raw file text is kept. `app` is
 * the version of PCB TraceMill that saves it.
 */
export function serializeProject(p: Project, app?: string): string {
  const layers = p.layers.map((l) => {
    const copy: Obj = { ...l }
    delete copy.parsed
    return copy
  })
  const head = app ? { format: FORMAT_MARKER, app } : { format: FORMAT_MARKER }
  return JSON.stringify({ ...head, ...p, version: PROJECT_VERSION, layers }, null, 2) + '\n'
}

/** -1 / 0 / 1 for versions such as "0.1.2" (anything after the third number is ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** A project saved by a newer PCB TraceMill than this one. */
export class NewerProjectError extends Error {
  constructor(
    readonly needed: string | null,
    readonly current: string | null
  ) {
    super(
      needed
        ? `This project was saved by PCB TraceMill ${needed}${current ? `, but this is ${current}` : ''}. Install PCB TraceMill ${needed} or newer to open it.`
        : 'This project was saved by a newer PCB TraceMill. Install the latest version to open it.'
    )
    this.name = 'NewerProjectError'
  }
}

class ProjectError extends Error {
  constructor(msg: string) {
    super(`This is not a valid PCB TraceMill project: ${msg}`)
    this.name = 'ProjectError'
  }
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function req(
  o: Obj,
  key: string,
  type: 'string' | 'number' | 'boolean' | 'object' | 'array',
  path: string
): void {
  const v = o[key]
  const ok =
    type === 'array'
      ? Array.isArray(v)
      : type === 'object'
        ? isObj(v)
        : type === 'number'
          ? typeof v === 'number' && Number.isFinite(v)
          : typeof v === type
  if (!ok)
    throw new ProjectError(
      `"${path}${key}" must be ${type === 'array' || type === 'object' ? 'an' : 'a'} ${type}.`
    )
}

function reqAll(o: unknown, path: string, spec: Record<string, Parameters<typeof req>[2]>): Obj {
  if (!isObj(o)) throw new ProjectError(`"${path.replace(/\.$/, '') || 'root'}" must be an object.`)
  for (const [k, t] of Object.entries(spec)) req(o, k, t, path)
  return o
}

/**
 * Migrations from version N to N+1. Version 1 is the first released format, so there are none yet;
 * add `2: (p) => {...}` style entries here (keyed by the SOURCE version) when the format changes.
 */
const MIGRATIONS: Record<number, (p: Obj) => Obj> = {
  // 1 → 2: only `app` is new; every setting added since is optional with the old behaviour as default
  1: (p) => p
}

const DEFAULT_SETTINGS = {
  edaTool: null,
  autoRegenerate: true,
  exportGrouping: 'per-step',
  realisticColors: true,
  highlightOnHover: true
}

/**
 * Parse, validate and migrate a .tmill file. Throws an Error with a user-readable message, and a
 * {@link NewerProjectError} when the file comes from a newer app than `app` (the running version).
 */
export function deserializeProject(text: string, app?: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(text) as Json
  } catch (e) {
    throw new ProjectError(`the file is not valid JSON (${(e as Error).message}).`)
  }
  if (!isObj(raw)) throw new ProjectError('the file does not contain a project object.')
  if ('format' in raw && raw.format !== FORMAT_MARKER)
    throw new ProjectError(`unknown file format "${String(raw.format)}".`)
  let p: Obj = { ...raw }
  delete p.format
  const savedBy = typeof p.app === 'string' ? p.app : null
  delete p.app
  if (typeof p.version !== 'number' || !Number.isInteger(p.version) || p.version < 1)
    throw new ProjectError('missing or invalid "version".')
  if (p.version > PROJECT_VERSION) throw new NewerProjectError(savedBy, app ?? null)
  if (savedBy && app && compareVersions(savedBy, app) > 0) throw new NewerProjectError(savedBy, app)
  while ((p.version as number) < PROJECT_VERSION) {
    const v = p.version as number
    const m = MIGRATIONS[v]
    if (!m) throw new ProjectError(`no migration from format version ${v}.`)
    p = { ...m(p), version: v + 1 }
  }

  reqAll(p, '', {
    name: 'string',
    layers: 'array',
    machine: 'object',
    material: 'object',
    tools: 'array',
    steps: 'array'
  })
  ;(p.layers as unknown[]).forEach((l, i) => {
    const o = reqAll(l, `layers[${i}].`, {
      id: 'string',
      fileName: 'string',
      rawText: 'string',
      type: 'string',
      side: 'string',
      visible: 'boolean',
      color: 'string',
      order: 'number'
    })
    delete o.parsed
    if (typeof o.autoDetected !== 'boolean') o.autoDetected = false
    if (typeof o.confidence !== 'number') o.confidence = 1
    if (!isObj(o.stats)) o.stats = { widthMm: 0, heightMm: 0, points: 0, pads: 0, tracks: 0 }
  })
  reqAll(p.machine, 'machine.', {
    id: 'string',
    name: 'string',
    postProcessor: 'string',
    workArea: 'object',
    safeZ: 'number',
    toolChangeZ: 'number',
    outputUnits: 'string',
    decimals: 'number',
    fileExtension: 'string'
  })
  const post = (p.machine as Obj).postProcessor
  if (!['mach3', 'grbl', 'linuxcnc', 'generic'].includes(post as string))
    throw new ProjectError(`unknown post-processor "${String(post)}".`)
  reqAll(p.material, 'material.', {
    width: 'number',
    height: 'number',
    thickness: 'number',
    doubleSided: 'boolean'
  })
  ;(p.tools as unknown[]).forEach((t, i) => {
    const o = reqAll(t, `tools[${i}].`, {
      id: 'string',
      name: 'string',
      type: 'string',
      number: 'number',
      geometry: 'object',
      feeds: 'object'
    })
    reqAll(o.geometry, `tools[${i}].geometry.`, { diameter: 'number' })
    reqAll(o.feeds, `tools[${i}].feeds.`, { spindleRpm: 'number', feedXY: 'number', feedZ: 'number' })
  })
  ;(p.steps as unknown[]).forEach((s, i) => {
    const o = reqAll(s, `steps[${i}].`, {
      id: 'string',
      kind: 'string',
      name: 'string',
      enabled: 'boolean',
      side: 'string',
      layerIds: 'array',
      cutDepth: 'number',
      params: 'object'
    })
    if (o.toolId !== null && typeof o.toolId !== 'string')
      throw new ProjectError(`"steps[${i}].toolId" must be a string or null.`)
  })
  if (p.heightMap === undefined) p.heightMap = null
  if (p.heightMap !== null) {
    const h = reqAll(p.heightMap, 'heightMap.', { config: 'object', z: 'array', source: 'string' })
    const c = reqAll(h.config, 'heightMap.config.', { countX: 'number', countY: 'number' })
    if ((h.z as unknown[]).length !== (c.countX as number) * (c.countY as number))
      throw new ProjectError('"heightMap.z" does not match the grid size.')
  }
  p.settings = { ...DEFAULT_SETTINGS, ...(isObj(p.settings) ? p.settings : {}) }
  return p as unknown as Project
}
