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
