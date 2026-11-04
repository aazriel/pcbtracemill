/**
 * Layer detection: maps a file (name + content) to a layer type / side / plating.
 *
 * Priority:
 *  1. X2 `TF.FileFunction` attribute in the content (Gerber `%TF`, `G04 #@! TF`, Excellon `; #@! TF`).
 *  2. EDA naming conventions (the selected EDA tool's table first, then the others).
 *  3. Generic Protel/Gerber extension table.
 *  4. Keywords in the file name (top/bottom/mask/silk/...).
 *  5. Content sniffing: Excellon → drill, Gerber outline heuristic → outline.
 * Excellon content always wins over a non-drill name guess (an Excellon file can only be a drill layer).
 */
import type { DetectionResult, EdaTool, LayerSide, LayerType } from '../model/types'
import { isExcellon, platingFromFileName, scanExcellonPlating } from '../excellon'
import { looksLikeGerber, looksLikeOutline, readFileFunction } from './sniff'

/** DetectionResult plus a relevance flag. Requested to be merged into the shared type. */
export interface LayerDetection extends DetectionResult {
  /** False for files that are not fabrication data for the given EDA tool (reports, BOM, job files...). */
  isRelevantForEda: boolean
}

type Plating = 'pth' | 'npth' | 'mixed'

interface Partial3 {
  type: LayerType
  side: LayerSide
  plating?: Plating
}

interface NameRule {
  re: RegExp
  type: LayerType
  side: LayerSide | ((m: RegExpExecArray) => LayerSide)
  plating?: Plating
  label: string
  conf: number
  /** Optional content check; returning null skips the rule, an object overrides type/side. */
  refine?: (text: string) => Partial3 | null
}

type TableKey = Exclude<EdaTool, 'other'> | 'generic'

const EDA_LABEL: Record<TableKey, string> = {
  kicad: 'KiCad',
  altium: 'Altium/Protel',
  eagle: 'Eagle',
  easyeda: 'EasyEDA',
  generic: 'Generic'
}

/** Builds a regex matching a KiCad layer token at the end of the file stem (`board-F_Cu.gbr`). */
const kicad = (layer: string): RegExp => new RegExp(`(?:^|[-_.])${layer}(?:\\.[a-z0-9]+)?$`, 'i')
const ext = (e: string): RegExp => new RegExp(`\\.(?:${e})$`, 'i')

const excellonOnly = (text: string): Partial3 | null =>
  isExcellon(text) ? { type: 'drill', side: 'all' } : null

const TABLES: Record<TableKey, NameRule[]> = {
  kicad: [
    { re: /-job\.gbrjob$/i, type: 'other', side: 'none', label: 'job file', conf: 0.95 },
    { re: /drl_map\.[a-z0-9]+$/i, type: 'other', side: 'none', label: 'drill map', conf: 0.9 },
    {
      re: /-NPTH(?:-drl)?\.[a-z0-9]+$/i,
      type: 'drill',
      side: 'all',
      plating: 'npth',
      label: 'NPTH drill',
      conf: 0.9
    },
    {
      re: /-PTH(?:-drl)?\.[a-z0-9]+$/i,
      type: 'drill',
      side: 'all',
      plating: 'pth',
      label: 'PTH drill',
      conf: 0.9
    },
    { re: kicad('F[._]Cu'), type: 'copper', side: 'top', label: 'F.Cu', conf: 0.9 },
    { re: kicad('B[._]Cu'), type: 'copper', side: 'bottom', label: 'B.Cu', conf: 0.9 },
    { re: kicad('In\\d+[._]Cu'), type: 'copper', side: 'inner', label: 'In*.Cu', conf: 0.9 },
    { re: kicad('F[._]Mask'), type: 'soldermask', side: 'top', label: 'F.Mask', conf: 0.9 },
    { re: kicad('B[._]Mask'), type: 'soldermask', side: 'bottom', label: 'B.Mask', conf: 0.9 },
    { re: kicad('F[._]Silk(?:S|screen)'), type: 'silkscreen', side: 'top', label: 'F.Silkscreen', conf: 0.9 },
    {
      re: kicad('B[._]Silk(?:S|screen)'),
      type: 'silkscreen',
      side: 'bottom',
      label: 'B.Silkscreen',
      conf: 0.9
    },
    { re: kicad('F[._]Paste'), type: 'paste', side: 'top', label: 'F.Paste', conf: 0.9 },
    { re: kicad('B[._]Paste'), type: 'paste', side: 'bottom', label: 'B.Paste', conf: 0.9 },
    { re: kicad('Edge[._]Cuts'), type: 'outline', side: 'all', label: 'Edge.Cuts', conf: 0.9 },
    {
      re: kicad('F[._](?:Fab|Courtyard|CrtYd)'),
      type: 'fab',
      side: 'top',
      label: 'F.Fab/Courtyard',
      conf: 0.9
    },
    {
      re: kicad('B[._](?:Fab|Courtyard|CrtYd)'),
      type: 'fab',
      side: 'bottom',
      label: 'B.Fab/Courtyard',
      conf: 0.9
    },
    { re: kicad('[FB][._]Adhes(?:ive)?'), type: 'other', side: 'none', label: 'Adhesive', conf: 0.85 },
    {
      re: kicad('(?:Dwgs|Cmts|Eco\\d)[._]User|User[._](?:Drawings|Comments|Eco\\d|\\d+)|Margin'),
      type: 'other',
      side: 'none',
      label: 'user layer',
      conf: 0.85
    }
  ],
  easyeda: [
    { re: /how[-_ ]?to[-_ ]?order/i, type: 'other', side: 'none', label: 'order instructions', conf: 0.9 },
    { re: /drill_npth/i, type: 'drill', side: 'all', plating: 'npth', label: 'Drill_NPTH', conf: 0.9 },
    { re: /drill_pth/i, type: 'drill', side: 'all', plating: 'pth', label: 'Drill_PTH', conf: 0.9 },
    { re: /(?:^|_)TopLayer\./i, type: 'copper', side: 'top', label: 'TopLayer', conf: 0.9 },
    { re: /(?:^|_)BottomLayer\./i, type: 'copper', side: 'bottom', label: 'BottomLayer', conf: 0.9 },
    {
      re: /(?:^|_)Inner(?:Layer)?(\d+)\./i,
      type: 'copper',
      side: 'inner',
      label: 'InnerLayer',
      conf: 0.9
    },
    { re: /TopSilk(?:screen)?Layer/i, type: 'silkscreen', side: 'top', label: 'TopSilkLayer', conf: 0.9 },
    {
      re: /BottomSilk(?:screen)?Layer/i,
      type: 'silkscreen',
      side: 'bottom',
      label: 'BottomSilkLayer',
      conf: 0.9
    },
    { re: /TopSolderMaskLayer/i, type: 'soldermask', side: 'top', label: 'TopSolderMaskLayer', conf: 0.9 },
    {
      re: /BottomSolderMaskLayer/i,
      type: 'soldermask',
      side: 'bottom',
      label: 'BottomSolderMaskLayer',
      conf: 0.9
    },
    { re: /TopPasteMaskLayer/i, type: 'paste', side: 'top', label: 'TopPasteMaskLayer', conf: 0.9 },
    { re: /BottomPasteMaskLayer/i, type: 'paste', side: 'bottom', label: 'BottomPasteMaskLayer', conf: 0.9 },
    { re: /BoardOutline(?:Layer)?/i, type: 'outline', side: 'all', label: 'BoardOutline', conf: 0.9 },
    {
      re: /DocumentLayer|MechanicalLayer|(?:Top|Bottom)AssemblyLayer/i,
      type: 'fab',
      side: (m) => (/bottom/i.test(m[0]) ? 'bottom' : /top/i.test(m[0]) ? 'top' : 'all'),
      label: 'Document/Mechanical',
      conf: 0.85
    },
    { re: /DrillDrawingLayer/i, type: 'other', side: 'none', label: 'DrillDrawingLayer', conf: 0.85 }
  ],
  eagle: [
    { re: /^copper_top\./i, type: 'copper', side: 'top', label: 'CAM copper_top', conf: 0.9 },
    { re: /^copper_bottom\./i, type: 'copper', side: 'bottom', label: 'CAM copper_bottom', conf: 0.9 },
    { re: /^copper_(?:inner_)?l\d+\./i, type: 'copper', side: 'inner', label: 'CAM copper_lN', conf: 0.9 },
    { re: /^silkscreen_top\./i, type: 'silkscreen', side: 'top', label: 'CAM silkscreen_top', conf: 0.9 },
    {
      re: /^silkscreen_bottom\./i,
      type: 'silkscreen',
      side: 'bottom',
      label: 'CAM silkscreen_bottom',
      conf: 0.9
    },
    { re: /^soldermask_top\./i, type: 'soldermask', side: 'top', label: 'CAM soldermask_top', conf: 0.9 },
    {
      re: /^soldermask_bottom\./i,
      type: 'soldermask',
      side: 'bottom',
      label: 'CAM soldermask_bottom',
      conf: 0.9
    },
    { re: /^solderpaste_top\./i, type: 'paste', side: 'top', label: 'CAM solderpaste_top', conf: 0.9 },
    {
      re: /^solderpaste_bottom\./i,
      type: 'paste',
      side: 'bottom',
      label: 'CAM solderpaste_bottom',
      conf: 0.9
    },
    { re: /^profile\./i, type: 'outline', side: 'all', label: 'CAM profile', conf: 0.9 },
    { re: /^drills?\.(?:xln|drl|txt)$/i, type: 'drill', side: 'all', label: 'CAM drills', conf: 0.9 },
    { re: /gerber_job\.gbrjob$/i, type: 'other', side: 'none', label: 'CAM job file', conf: 0.9 },
    { re: ext('cmp'), type: 'copper', side: 'top', label: '.cmp (component side)', conf: 0.85 },
    { re: ext('sol'), type: 'copper', side: 'bottom', label: '.sol (solder side)', conf: 0.85 },
    { re: ext('stc'), type: 'soldermask', side: 'top', label: '.stc (stop mask top)', conf: 0.85 },
    { re: ext('sts'), type: 'soldermask', side: 'bottom', label: '.sts (stop mask bottom)', conf: 0.85 },
    { re: ext('plc'), type: 'silkscreen', side: 'top', label: '.plc (place top)', conf: 0.85 },
    { re: ext('pls'), type: 'silkscreen', side: 'bottom', label: '.pls (place bottom)', conf: 0.85 },
    { re: ext('crc'), type: 'paste', side: 'top', label: '.crc (cream top)', conf: 0.85 },
    { re: ext('crs'), type: 'paste', side: 'bottom', label: '.crs (cream bottom)', conf: 0.85 },
    { re: ext('dim'), type: 'outline', side: 'all', label: '.dim (dimension)', conf: 0.85 },
    { re: ext('gml'), type: 'outline', side: 'all', label: '.gml (milling)', conf: 0.85 },
    { re: ext('drd|xln'), type: 'drill', side: 'all', label: 'Eagle drill', conf: 0.85 },
    { re: ext('dri'), type: 'drill', side: 'all', label: '.dri drill', conf: 0.7, refine: excellonOnly }
  ],
  altium: [
    {
      re: /-NonPlated\.(?:txt|drl)$/i,
      type: 'drill',
      side: 'all',
      plating: 'npth',
      label: 'NonPlated',
      conf: 0.9
    },
    { re: /-Plated\.(?:txt|drl)$/i, type: 'drill', side: 'all', plating: 'pth', label: 'Plated', conf: 0.9 },
    { re: /-RoundHoles\.(?:txt|drl)$/i, type: 'drill', side: 'all', label: 'RoundHoles', conf: 0.9 },
    { re: /-SlotHoles\.(?:txt|drl)$/i, type: 'drill', side: 'all', label: 'SlotHoles', conf: 0.9 },
    { re: ext('gko'), type: 'outline', side: 'all', label: '.GKO (keep-out)', conf: 0.85 },
    { re: ext('gm1'), type: 'outline', side: 'all', label: '.GM1 (mechanical 1)', conf: 0.8 },
    {
      re: /\.gm(\d+)$/i,
      type: 'fab',
      side: 'all',
      label: '.GMn (mechanical)',
      conf: 0.6,
      refine: (text) =>
        looksLikeOutline(text) ? { type: 'outline', side: 'all' } : { type: 'fab', side: 'all' }
    },
    { re: /\.gd\d+$/i, type: 'other', side: 'none', label: '.GDn (drill drawing)', conf: 0.8 },
    { re: /\.gg\d+$/i, type: 'other', side: 'none', label: '.GGn (drill guide)', conf: 0.8 },
    { re: /\.gp[tb]$/i, type: 'other', side: 'none', label: 'pad master', conf: 0.8 },
    { re: /\.gp\d+$/i, type: 'copper', side: 'inner', label: '.GPn (internal plane)', conf: 0.85 },
    { re: /\.g(?:[1-9]|[12]\d|30)$/i, type: 'copper', side: 'inner', label: '.Gn (mid layer)', conf: 0.85 },
    { re: ext('txt'), type: 'drill', side: 'all', label: '.TXT NC drill', conf: 0.8, refine: excellonOnly },
    { re: ext('drl'), type: 'drill', side: 'all', label: '.DRL NC drill', conf: 0.8 }
  ],
  generic: [
    { re: ext('gtl'), type: 'copper', side: 'top', label: '.GTL', conf: 0.8 },
    { re: ext('gbl'), type: 'copper', side: 'bottom', label: '.GBL', conf: 0.8 },
    { re: ext('gts'), type: 'soldermask', side: 'top', label: '.GTS', conf: 0.8 },
    { re: ext('gbs'), type: 'soldermask', side: 'bottom', label: '.GBS', conf: 0.8 },
    { re: ext('gto'), type: 'silkscreen', side: 'top', label: '.GTO', conf: 0.8 },
    { re: ext('gbo'), type: 'silkscreen', side: 'bottom', label: '.GBO', conf: 0.8 },
    { re: ext('gtp'), type: 'paste', side: 'top', label: '.GTP', conf: 0.8 },
    { re: ext('gbp'), type: 'paste', side: 'bottom', label: '.GBP', conf: 0.8 },
    {
      re: ext('gko|gm1|gml|oln|out|bor|outline'),
      type: 'outline',
      side: 'all',
      label: 'outline extension',
      conf: 0.75
    },
    { re: /\.g(?:[1-9]|[12]\d|30)$/i, type: 'copper', side: 'inner', label: '.Gn (inner)', conf: 0.7 },
    { re: /\.gp\d+$/i, type: 'copper', side: 'inner', label: '.GPn (plane)', conf: 0.7 },
    { re: ext('top'), type: 'copper', side: 'top', label: '.top', conf: 0.6 },
    { re: ext('bot'), type: 'copper', side: 'bottom', label: '.bot', conf: 0.6 },
    { re: ext('smt'), type: 'soldermask', side: 'top', label: '.smt', conf: 0.6 },
    { re: ext('smb'), type: 'soldermask', side: 'bottom', label: '.smb', conf: 0.6 },
    { re: ext('sst'), type: 'silkscreen', side: 'top', label: '.sst', conf: 0.6 },
    { re: ext('ssb'), type: 'silkscreen', side: 'bottom', label: '.ssb', conf: 0.6 },
    { re: ext('spt'), type: 'paste', side: 'top', label: '.spt', conf: 0.6 },
    { re: ext('spb'), type: 'paste', side: 'bottom', label: '.spb', conf: 0.6 },
    {
      re: ext('drl|xln|drd|exc|ncd|nc|tap'),
      type: 'drill',
      side: 'all',
      label: 'drill extension',
      conf: 0.75
    },
    { re: ext('txt|dri'), type: 'drill', side: 'all', label: 'text drill', conf: 0.7, refine: excellonOnly }
  ]
}

const TABLE_ORDER: TableKey[] = ['kicad', 'easyeda', 'eagle', 'altium', 'generic']

export function baseName(fileName: string): string {
  return fileName.split(/[\\/]/).pop() ?? fileName
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

// ─────────────────────────────────────────── X2 FileFunction

function sideOf(fields: string[]): LayerSide | null {
  for (const f of fields) {
    const v = f.trim().toLowerCase()
    if (v === 'top') return 'top'
    if (v === 'bot' || v === 'bottom') return 'bottom'
    if (v === 'inr') return 'inner'
  }
  return null
}

/** Maps an X2 `.FileFunction` value (without the attribute name) to a layer classification. */
export function fromFileFunction(value: string): Partial3 | null {
  const fields = value.split(',').map((f) => f.trim())
  const fn = fields[0].toLowerCase()
  const side = sideOf(fields.slice(1))
  switch (fn) {
    case 'copper':
      return { type: 'copper', side: side ?? 'inner' }
    case 'soldermask':
      return { type: 'soldermask', side: side ?? 'top' }
    case 'legend':
      return { type: 'silkscreen', side: side ?? 'top' }
    case 'paste':
      return { type: 'paste', side: side ?? 'top' }
    case 'profile':
      return { type: 'outline', side: 'all' }
    case 'plated':
      return { type: 'drill', side: 'all', plating: 'pth' }
    case 'nonplated':
      return { type: 'drill', side: 'all', plating: 'npth' }
    case 'mixedplating':
      return { type: 'drill', side: 'all', plating: 'mixed' }
    case 'assemblydrawing':
    case 'fabricationdrawing':
    case 'component':
      return { type: 'fab', side: side ?? 'all' }
    case 'other': {
      const what = (fields[1] ?? '').toLowerCase()
      if (/fab|courtyard|assembly/.test(what)) return { type: 'fab', side: side ?? 'all' }
      return { type: 'other', side: side ?? 'none' }
    }
    case '':
      return null
    default:
      // Glue, Carbonmask, Goldmask, Heatsinkmask, Peelablemask, Silvermask, Tinmask, Pads,
      // Keep-out, Drillmap, ArrayDrawing, Depthrout, Vcut, ...
      return { type: 'other', side: side ?? 'none' }
  }
}

// ─────────────────────────────────────────── keyword fallback

function fromKeywords(name: string): (Partial3 & { label: string }) | null {
  const stem = name.replace(/\.[^.]*$/, '').toLowerCase()
  let type: LayerType | null = null
  let label = ''
  const tests: [RegExp, LayerType][] = [
    [/drill|holes?\b|(?:^|[^a-z])n?pth/, 'drill'],
    [/outline|edge|profile|contour|dimension|border|milling|\brout/, 'outline'],
    [/paste|cream|stencil/, 'paste'],
    [/silk|legend|overlay/, 'silkscreen'],
    [/mask|stop/, 'soldermask'],
    [/fab|assembly|courtyard|document/, 'fab'],
    [/copper|signal|\bcu\b|_cu$|layer|trace/, 'copper']
  ]
  for (const [re, t] of tests) {
    const m = re.exec(stem)
    if (m) {
      type = t
      label = m[0]
      break
    }
  }
  let side: LayerSide | null = null
  if (/top|front|component|(?:^|[^a-z])f(?:[^a-z]|$)/.test(stem)) side = 'top'
  else if (/bot(?:tom)?|back|solder[-_ ]?side|(?:^|[^a-z])b(?:[^a-z]|$)/.test(stem)) side = 'bottom'
  else if (/inner|(?:^|[^a-z])in\d|(?:^|[^a-z])l\d+/.test(stem)) side = 'inner'
  if (!type) return null
  if (type === 'drill' || type === 'outline') side = 'all'
  if (!side) {
    if (type === 'copper') return null // copper without a side is too ambiguous
    side = type === 'fab' ? 'all' : 'top'
  }
  return { type, side, label }
}

// ─────────────────────────────────────────── relevance

const JUNK_EXT = new Set(
  (
    'pdf png jpg jpeg gif bmp svg ico tif tiff webp csv tsv xls xlsx ods pos rpt ipc d356 net json gbrjob md ' +
    'html htm xml log apr rep rul extrep ldp drr pcbdoc schdoc prjpcb pcbdwf kicad_pcb kicad_sch kicad_pro kicad_prl ' +
    'sch brd lbr step stp wrl iges igs doc docx odt rtf zip 7z rar bak lck pro gpi cpl bom mnt dsn ses'
  ).split(' ')
)

const EDA_JUNK: Record<Exclude<EdaTool, 'other'>, { re: RegExp; label: string }[]> = {
  kicad: [
    { re: /-job\.gbrjob$/i, label: 'KiCad job file' },
    { re: /drl_map\.[a-z0-9]+$/i, label: 'KiCad drill map' },
    { re: /\.(?:pos|rpt|csv|ipc|d356)$/i, label: 'KiCad report / placement / netlist' }
  ],
  altium: [
    { re: /\.(?:apr|rep|rul|extrep|ldp|drr)$/i, label: 'Altium report / aperture file' },
    { re: /status report/i, label: 'Altium status report' }
  ],
  eagle: [
    { re: /\.(?:dri|gpi|pro)$/i, label: 'Eagle CAM info file' },
    { re: /gerber_job\.gbrjob$/i, label: 'Eagle job file' }
  ],
  easyeda: [
    { re: /how[-_ ]?to[-_ ]?order/i, label: 'EasyEDA order instructions' },
    { re: /^(?:pickandplace|bom)_/i, label: 'EasyEDA BOM / pick-and-place' }
  ]
}

const JUNK_NAME =
  /readme|license|(?:^|[-_ ])bom(?:[-_ .]|$)|pick[-_ ]?(?:and|n|&)?[-_ ]?place|pnp|centroid|position|drl_map|how[-_ ]?to[-_ ]?order|report/i

/** Decides whether a file is fabrication data worth importing. */
export function isRelevantFile(
  fileName: string,
  text: string,
  eda: EdaTool | null
): { relevant: boolean; reason: string } {
  const name = baseName(fileName)
  if (eda && eda !== 'other') {
    for (const j of EDA_JUNK[eda]) if (j.re.test(name)) return { relevant: false, reason: j.label }
  }
  if (name.startsWith('.')) return { relevant: false, reason: 'hidden file' }
  if (text.trim() === '') return { relevant: false, reason: 'empty file' }
  const e = extensionOf(name)
  if (JUNK_EXT.has(e)) return { relevant: false, reason: `.${e} is not a Gerber/drill file` }
  if (JUNK_NAME.test(name)) return { relevant: false, reason: 'documentation / assembly file' }
  if (isExcellon(text)) return { relevant: true, reason: 'Excellon drill data' }
  if (looksLikeGerber(text)) return { relevant: true, reason: 'Gerber data' }
  return { relevant: false, reason: 'not a Gerber or Excellon file' }
}

// ─────────────────────────────────────────── main entry

/**
 * Detects layer type/side/plating of a file. Returns a `DetectionResult` extended with
 * `isRelevantForEda`.
 */
export function detectLayer(fileName: string, text: string, eda: EdaTool | null): LayerDetection {
  const name = baseName(fileName)
  const relevant = isRelevantFile(fileName, text, eda).relevant
  const excellon = isExcellon(text)

  const finish = (r: DetectionResult): LayerDetection => {
    let out: DetectionResult = r
    if (excellon && out.type !== 'drill') {
      out = {
        type: 'drill',
        side: 'all',
        confidence: 0.9,
        reason: `Excellon content (name suggested ${r.type}: ${r.reason})`
      }
    }
    if (out.type === 'drill') {
      const plating: Plating =
        scanExcellonPlating(text) ??
        out.plating ??
        (() => {
          const p = platingFromFileName(name)
          return p === null ? 'pth' : p ? 'pth' : 'npth'
        })()
      out = { ...out, side: 'all', plating }
    } else if (out.plating !== undefined) {
      const { plating: _p, ...rest } = out
      out = rest
    }
    return { ...out, isRelevantForEda: relevant }
  }

  // 1. X2 file function.
  const ff = readFileFunction(text)
  if (ff) {
    const r = fromFileFunction(ff)
    if (r) return finish({ ...r, confidence: 0.99, reason: `X2 FileFunction ${ff}` })
  }

  // 2/3. Naming tables.
  const order: TableKey[] =
    eda && eda !== 'other' ? [eda, ...TABLE_ORDER.filter((t) => t !== eda)] : TABLE_ORDER
  for (const key of order) {
    for (const rule of TABLES[key]) {
      const m = rule.re.exec(name)
      if (!m) continue
      let type = rule.type
      let side = typeof rule.side === 'function' ? rule.side(m) : rule.side
      if (rule.refine) {
        const r = rule.refine(text)
        if (!r) continue
        type = r.type
        side = r.side
      }
      const bonus = eda === key ? 0.05 : 0
      return finish({
        type,
        side,
        plating: rule.plating,
        confidence: Math.round(Math.min(0.97, rule.conf + bonus) * 100) / 100,
        reason: `${EDA_LABEL[key]} naming: ${rule.label}`
      })
    }
  }

  // 4. Keywords.
  const kw = fromKeywords(name)
  if (kw)
    return finish({
      type: kw.type,
      side: kw.side,
      confidence: 0.6,
      reason: `File name keyword "${kw.label}"`
    })

  // 5. Content sniffing.
  if (excellon) return finish({ type: 'drill', side: 'all', confidence: 0.7, reason: 'Excellon content' })
  if (looksLikeGerber(text)) {
    if (looksLikeOutline(text))
      return finish({
        type: 'outline',
        side: 'all',
        confidence: 0.5,
        reason: 'Thin closed-loop draws (outline heuristic)'
      })
    return finish({
      type: 'other',
      side: 'none',
      confidence: 0.2,
      reason: 'Gerber file; layer could not be identified'
    })
  }
  return finish({ type: 'other', side: 'none', confidence: 0.05, reason: 'Unrecognised file' })
}
