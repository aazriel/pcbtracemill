/**
 * Turns user-supplied files (possibly zip archives) into a flat list of text files.
 */
import JSZip from 'jszip'

export interface InputFile {
  name: string
  data: string | Uint8Array
}

export interface ExpandedFile {
  /** Base name (directories stripped). */
  name: string
  text: string
  /** Full path for display, e.g. "board.zip/gerbers/board-F_Cu.gbr". */
  path: string
}

/** Extensions that are never text CAM data. */
const BINARY_EXT = new Set(
  (
    'pdf png jpg jpeg gif bmp ico tif tiff webp svgz zip 7z rar gz tgz bz2 xz exe dll so dylib ' +
    'xls xlsx ods doc docx odt ppt pptx pcbdoc schdoc pcblib schlib step stp wrl iges igs stl 3mf ' +
    'mp4 mov avi mp3 wav ttf otf woff woff2'
  ).split(' ')
)

const MAX_ZIP_DEPTH = 4

function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

function base(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function isJunkPath(path: string): boolean {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.some((p) => p === '__MACOSX' || p.startsWith('.'))) return true
  const b = parts[parts.length - 1] ?? ''
  return b === '' || b === 'Thumbs.db' || b === 'desktop.ini'
}

/** Heuristic binary check on the first 8 KB: NUL bytes or many control characters. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192)
  if (n === 0) return false
  let ctrl = 0
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b === 0) return true
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) ctrl++
  }
  return ctrl / n > 0.05
}

function decode(bytes: Uint8Array): string {
  let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return text
}

const isZipBytes = (b: Uint8Array): boolean =>
  b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04

async function expandZip(
  bytes: Uint8Array,
  prefix: string,
  depth: number,
  out: ExpandedFile[]
): Promise<void> {
  const zip = await JSZip.loadAsync(bytes)
  const entries = Object.values(zip.files)
    .filter((f) => !f.dir && !isJunkPath(f.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const path = `${prefix}/${entry.name}`
    const e = ext(entry.name)
    if (e === 'zip') {
      if (depth >= MAX_ZIP_DEPTH) continue
      const inner = await entry.async('uint8array')
      await expandZip(inner, path, depth + 1, out)
      continue
    }
    if (BINARY_EXT.has(e)) continue
    const data = await entry.async('uint8array')
    if (looksBinary(data)) continue
    out.push({ name: base(entry.name), text: decode(data), path })
  }
}

/**
 * Expands archives and decodes text. Zip files (given as bytes) are unpacked recursively;
 * directories, `__MACOSX`, hidden files and binary files are dropped. Names are flattened
 * to base names; the full path is kept in `path`.
 */
export async function expandInputs(files: InputFile[]): Promise<ExpandedFile[]> {
  const out: ExpandedFile[] = []
  for (const f of files) {
    if (isJunkPath(f.name)) continue
    const name = base(f.name)
    if (typeof f.data === 'string') {
      const text = f.data.charCodeAt(0) === 0xfeff ? f.data.slice(1) : f.data
      out.push({ name, text, path: f.name })
      continue
    }
    if (ext(name) === 'zip' || isZipBytes(f.data)) {
      try {
        await expandZip(f.data, name, 1, out)
      } catch {
        // Not a readable archive: ignore.
      }
      continue
    }
    if (BINARY_EXT.has(ext(name)) || looksBinary(f.data)) continue
    out.push({ name, text: decode(f.data), path: f.name })
  }
  return out
}
