import type { EdaTool } from '@core/model/types'

export interface EdaInfo {
  id: EdaTool
  name: string
  short: string
  blurb: string
  files: string
  /** File extensions this program writes for fabrication (lower case, no dot). */
  extensions: string[]
}

const range = (prefix: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`)

const PROTEL = ['gtl', 'gbl', 'gto', 'gbo', 'gts', 'gbs', 'gtp', 'gbp', 'gko', 'gml', 'gm1']

export const EDA_INFO: EdaInfo[] = [
  {
    id: 'kicad',
    name: 'KiCad',
    short: 'KiCad',
    blurb: 'Free & open-source. Files look like "board-F_Cu.gbr".',
    files: '*-F_Cu.gbr, *-Edge_Cuts.gbr, *.drl',
    extensions: ['gbr', ...PROTEL, ...range('g', 1, 30), 'drl', 'exc', 'xln']
  },
  {
    id: 'altium',
    name: 'Altium Designer',
    short: 'Altium',
    blurb: 'Professional EDA. Files use extensions like .GTL / .GBL.',
    files: '*.GTL, *.GBL, *.GKO, *.TXT',
    extensions: [...PROTEL, ...range('gm', 2, 16), ...range('g', 1, 30), 'gp1', 'gpt', 'gpb', 'txt', 'drl']
  },
  {
    id: 'eagle',
    name: 'Autodesk Eagle / Fusion Electronics',
    short: 'Eagle / Fusion',
    blurb: 'Files like .cmp / .sol or copper_top.gbr.',
    files: '*.cmp, *.sol, *.dim, *.drd',
    extensions: [
      'cmp',
      'sol',
      'stc',
      'sts',
      'plc',
      'pls',
      'crc',
      'crs',
      'dim',
      'ger',
      'gbr',
      ...PROTEL,
      'drd',
      'drl',
      'xln',
      'txt'
    ]
  },
  {
    id: 'easyeda',
    name: 'EasyEDA / JLCPCB',
    short: 'EasyEDA',
    blurb: 'Files like "Gerber_TopLayer.GTL".',
    files: 'Gerber_TopLayer.GTL, Drill_PTH_Through.DRL',
    extensions: [...PROTEL, 'g1', 'g2', 'g3', 'g4', 'gbr', 'drl', 'txt']
  },
  {
    id: 'other',
    name: 'Other / not sure',
    short: 'Other',
    blurb: 'We will detect everything from the file contents.',
    files: 'Any RS-274X Gerber + Excellon',
    extensions: [
      'gbr',
      'ger',
      'gbx',
      'art',
      'pho',
      ...PROTEL,
      ...range('gm', 2, 16),
      ...range('g', 1, 30),
      'cmp',
      'sol',
      'stc',
      'sts',
      'plc',
      'pls',
      'dim',
      'drl',
      'drd',
      'xln',
      'exc',
      'nc',
      'txt'
    ]
  }
]

export function edaInfo(id: EdaTool | null | undefined): EdaInfo | undefined {
  return EDA_INFO.find((e) => e.id === id)
}

/**
 * How to export the fabrication files from one design program, shown in the import wizard.
 * `**text**` is shown in bold (menu names and buttons).
 */
export interface ExportGuide {
  steps: string[]
  /** Without these there is nothing to mill. */
  required: string[]
  /** Needed to drill the holes and cut the board out. */
  recommended: string[]
  /** Only for looks or reference (silkscreen can be engraved). */
  optional: string[]
  /** Which import type fits best. */
  best: 'files' | 'folder' | 'zip'
  note?: string
}

export const EXPORT_GUIDES: Record<EdaTool, ExportGuide> = {
  kicad: {
    steps: [
      'In the PCB Editor open **File → Fabrication Outputs → Gerbers (.gbr)…**',
      'Plot format **Gerber**, pick an **Output directory**, and tick the layers listed on the right.',
      'Click **Plot**.',
      'In the same window click **Generate Drill Files…**, choose **Excellon** and **Millimeters**, then **Generate Drill File**.',
      'Import the output folder.'
    ],
    required: ['**F.Cu** (top copper), and **B.Cu** for a two-sided board'],
    recommended: [
      '**Edge.Cuts**: the board outline, to cut the board out',
      '**Drill files** (*.drl, PTH and NPTH)'
    ],
    optional: ['**F.Silkscreen / B.Silkscreen**: can be engraved', '**F.Mask / B.Mask**: for reference'],
    best: 'folder',
    note: 'Keep the same origin for the Gerbers and the drill files (the default), or the holes will be shifted.'
  },
  altium: {
    steps: [
      '**File → Fabrication Outputs → Gerber Files**.',
      '**General** tab: units **Millimeters**, format **4:4**.',
      '**Layers** tab: tick the layers listed on the right, then **OK**.',
      '**File → Fabrication Outputs → NC Drill Files**: the same units and format, then **OK**.',
      'Import the **Project Outputs** folder.'
    ],
    required: ['**Top Layer** (.GTL), and **Bottom Layer** (.GBL) for a two-sided board'],
    recommended: ['**Board outline**: Mechanical 1 (.GM1) or Keep-Out (.GKO)', '**NC Drill** (.TXT / .DRL)'],
    optional: ['**Top / Bottom Overlay** (.GTO / .GBO): silkscreen', '**Top / Bottom Solder** (.GTS / .GBS)'],
    best: 'folder',
    note: 'The Gerbers and the drill file must use the same units and origin, or the holes will be shifted.'
  },
  eagle: {
    steps: [
      'Eagle: **File → CAM Processor**. Fusion Electronics: **Manufacturing → CAM Processor** in the PCB editor.',
      'Load the default **2-layer template** (or your board house’s, e.g. JLCPCB).',
      'Check that the job has the layers listed on the right, with the drill output as **Excellon**.',
      'Click **Process Job** and save the ZIP or the folder.',
      'Import that ZIP or folder.'
    ],
    required: ['**Top Copper** (copper_top.gbr / .cmp), and **Bottom Copper** for a two-sided board'],
    recommended: ['**Profile** (profile.gbr / .dim): the board outline', '**Drill** (*.xln / .drd)'],
    optional: ['**Silkscreen Top / Bottom**', '**Solder Mask Top / Bottom**'],
    best: 'zip',
    note: 'The board shape comes from the Dimension layer (20). If the outline is missing, draw it there.'
  },
  easyeda: {
    steps: [
      'EasyEDA Standard: **Fabrication → PCB Fabrication File (Gerber)…**. EasyEDA Pro: **Export → PCB Fabrication File (Gerber)…**',
      'Click **Generate Gerber** (Pro: **Export**). A ZIP file is saved.',
      'Import that ZIP as it is. There is no need to unzip it.'
    ],
    required: ['**Gerber_TopLayer.GTL**, and **Gerber_BottomLayer.GBL** for a two-sided board'],
    recommended: [
      '**Gerber_BoardOutlineLayer.GKO**: the board outline',
      '**Drill_PTH_Through.DRL** and **Drill_NPTH_Through.DRL**'
    ],
    optional: ['**Silkscreen** layers (.GTO / .GBO)', '**Solder mask** layers (.GTS / .GBS)'],
    best: 'zip',
    note: 'The ZIP always has everything. Files not needed for milling are left out automatically.'
  },
  other: {
    steps: [
      'Look for **Gerber**, **Fabrication outputs**, **Plot** or **CAM** in your design program.',
      'Choose **Gerber RS-274X** (also called Extended Gerber or Gerber X2), not RS-274D.',
      'Export the holes as an **Excellon** drill file, in millimetres if you can.',
      'Use the same origin for the Gerbers and the drill file.',
      'Import the files, their folder, or the ZIP.'
    ],
    required: ['**Copper**: the top layer, and the bottom layer for a two-sided board'],
    recommended: ['**Board outline** (edge, profile or mechanical layer)', '**Excellon drill** file(s)'],
    optional: ['**Silkscreen**', '**Solder mask**'],
    best: 'folder',
    note: 'PCB TraceMill reads what is inside each file, so the file names do not matter.'
  }
}
