import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectLayer, fromFileFunction, isRelevantFile, looksLikeOutline } from '@core/import'
import type { EdaTool, LayerSide, LayerType } from '@core/model/types'

const read = (dir: string, f: string): string =>
  readFileSync(resolve(__dirname, '../../../fixtures', dir, f), 'utf8')
const GERBER = read('import', 'copper.gbr')
const OUTLINE = read('import', 'outline.gbr')
const DRILL = 'M48\nMETRIC\nT1C0.8\n%\nT1\nX1.0Y1.0\nM30\n'
const KICAD_NPTH = read('excellon', 'kicad-npth.drl')
const ALTIUM_DRILL = read('excellon', 'altium-inch-tz.txt')

type Row = [
  name: string,
  text: string,
  eda: EdaTool | null,
  type: LayerType,
  side: LayerSide,
  plating?: string
]

const ROWS: Row[] = [
  // KiCad
  ['board-F_Cu.gbr', GERBER, 'kicad', 'copper', 'top'],
  ['board-B_Cu.gbr', GERBER, 'kicad', 'copper', 'bottom'],
  ['board-In1_Cu.gbr', GERBER, 'kicad', 'copper', 'inner'],
  ['board-In2.Cu.gbr', GERBER, null, 'copper', 'inner'],
  ['board-F_Mask.gbr', GERBER, 'kicad', 'soldermask', 'top'],
  ['board-B_Mask.gbr', GERBER, 'kicad', 'soldermask', 'bottom'],
  ['board-F_Silkscreen.gbr', GERBER, 'kicad', 'silkscreen', 'top'],
  ['board-F_SilkS.gbr', GERBER, 'kicad', 'silkscreen', 'top'],
  ['board-B_Silkscreen.gbr', GERBER, null, 'silkscreen', 'bottom'],
  ['board-F_Paste.gbr', GERBER, 'kicad', 'paste', 'top'],
  ['board-B_Paste.gbr', GERBER, 'kicad', 'paste', 'bottom'],
  ['board-Edge_Cuts.gbr', OUTLINE, 'kicad', 'outline', 'all'],
  ['board-F_Fab.gbr', GERBER, 'kicad', 'fab', 'top'],
  ['board-B_Fab.gbr', GERBER, 'kicad', 'fab', 'bottom'],
  ['board-F_Courtyard.gbr', GERBER, 'kicad', 'fab', 'top'],
  ['board-User_Drawings.gbr', GERBER, 'kicad', 'other', 'none'],
  ['board-F_Cu.gtl', GERBER, 'kicad', 'copper', 'top'],
  ['board.gtl', GERBER, 'kicad', 'copper', 'top'],
  ['board.gbl', GERBER, 'kicad', 'copper', 'bottom'],
  ['board.gts', GERBER, 'kicad', 'soldermask', 'top'],
  ['board.gbs', GERBER, 'kicad', 'soldermask', 'bottom'],
  ['board.gto', GERBER, 'kicad', 'silkscreen', 'top'],
  ['board.gbo', GERBER, 'kicad', 'silkscreen', 'bottom'],
  ['board.gtp', GERBER, 'kicad', 'paste', 'top'],
  ['board.gbp', GERBER, 'kicad', 'paste', 'bottom'],
  ['board.gm1', OUTLINE, 'kicad', 'outline', 'all'],
  ['board.drl', DRILL, 'kicad', 'drill', 'all', 'pth'],
  ['board-PTH.drl', DRILL, 'kicad', 'drill', 'all', 'pth'],
  ['board-NPTH.drl', DRILL, 'kicad', 'drill', 'all', 'npth'],
  ['board-NPTH.drl', KICAD_NPTH, null, 'drill', 'all', 'npth'],
  ['board-job.gbrjob', '{"Header":{}}', 'kicad', 'other', 'none'],
  // Altium / Protel
  ['PCB1.GTL', GERBER, 'altium', 'copper', 'top'],
  ['PCB1.GBL', GERBER, 'altium', 'copper', 'bottom'],
  ['PCB1.GTO', GERBER, 'altium', 'silkscreen', 'top'],
  ['PCB1.GBO', GERBER, 'altium', 'silkscreen', 'bottom'],
  ['PCB1.GTS', GERBER, 'altium', 'soldermask', 'top'],
  ['PCB1.GBS', GERBER, 'altium', 'soldermask', 'bottom'],
  ['PCB1.GTP', GERBER, 'altium', 'paste', 'top'],
  ['PCB1.GBP', GERBER, 'altium', 'paste', 'bottom'],
  ['PCB1.GKO', OUTLINE, 'altium', 'outline', 'all'],
  ['PCB1.GM1', OUTLINE, 'altium', 'outline', 'all'],
  ['PCB1.GM13', OUTLINE, 'altium', 'outline', 'all'],
  ['PCB1.GM2', GERBER, 'altium', 'fab', 'all'],
  ['PCB1.GM16', GERBER, null, 'fab', 'all'],
  ['PCB1.GML', OUTLINE, 'altium', 'outline', 'all'],
  ['PCB1.GD1', GERBER, 'altium', 'other', 'none'],
  ['PCB1.GG1', GERBER, 'altium', 'other', 'none'],
  ['PCB1.G1', GERBER, 'altium', 'copper', 'inner'],
  ['PCB1.G30', GERBER, 'altium', 'copper', 'inner'],
  ['PCB1.GP1', GERBER, 'altium', 'copper', 'inner'],
  ['PCB1.TXT', ALTIUM_DRILL, 'altium', 'drill', 'all', 'pth'],
  ['PCB1.DRL', DRILL, 'altium', 'drill', 'all', 'pth'],
  ['PCB1-RoundHoles.TXT', ALTIUM_DRILL, 'altium', 'drill', 'all', 'pth'],
  ['PCB1-SlotHoles.TXT', ALTIUM_DRILL, null, 'drill', 'all', 'pth'],
  ['PCB1-NonPlated.TXT', DRILL, 'altium', 'drill', 'all', 'npth'],
  // Eagle
  ['board.cmp', GERBER, 'eagle', 'copper', 'top'],
  ['board.sol', GERBER, 'eagle', 'copper', 'bottom'],
  ['board.stc', GERBER, 'eagle', 'soldermask', 'top'],
  ['board.sts', GERBER, 'eagle', 'soldermask', 'bottom'],
  ['board.plc', GERBER, 'eagle', 'silkscreen', 'top'],
  ['board.pls', GERBER, 'eagle', 'silkscreen', 'bottom'],
  ['board.crc', GERBER, 'eagle', 'paste', 'top'],
  ['board.crs', GERBER, 'eagle', 'paste', 'bottom'],
  ['board.dim', OUTLINE, 'eagle', 'outline', 'all'],
  ['board.gml', OUTLINE, 'eagle', 'outline', 'all'],
  ['board.drd', DRILL, 'eagle', 'drill', 'all', 'pth'],
  ['board.xln', DRILL, 'eagle', 'drill', 'all', 'pth'],
  ['board.dri', DRILL, 'eagle', 'drill', 'all', 'pth'],
  ['copper_top.gbr', GERBER, 'eagle', 'copper', 'top'],
  ['copper_bottom.gbr', GERBER, null, 'copper', 'bottom'],
  ['copper_l2.gbr', GERBER, 'eagle', 'copper', 'inner'],
  ['silkscreen_top.gbr', GERBER, 'eagle', 'silkscreen', 'top'],
  ['silkscreen_bottom.gbr', GERBER, 'eagle', 'silkscreen', 'bottom'],
  ['soldermask_top.gbr', GERBER, 'eagle', 'soldermask', 'top'],
  ['soldermask_bottom.gbr', GERBER, 'eagle', 'soldermask', 'bottom'],
  ['solderpaste_top.gbr', GERBER, 'eagle', 'paste', 'top'],
  ['profile.gbr', OUTLINE, 'eagle', 'outline', 'all'],
  ['drills.xln', DRILL, 'eagle', 'drill', 'all', 'pth'],
  // EasyEDA
  ['Gerber_TopLayer.GTL', GERBER, 'easyeda', 'copper', 'top'],
  ['Gerber_BottomLayer.GBL', GERBER, 'easyeda', 'copper', 'bottom'],
  ['Gerber_TopSilkLayer.GTO', GERBER, 'easyeda', 'silkscreen', 'top'],
  ['Gerber_BottomSilkLayer.GBO', GERBER, null, 'silkscreen', 'bottom'],
  ['Gerber_BoardOutline.GKO', OUTLINE, 'easyeda', 'outline', 'all'],
  ['Gerber_BoardOutlineLayer.GKO', OUTLINE, 'easyeda', 'outline', 'all'],
  ['Gerber_TopSolderMaskLayer.GTS', GERBER, 'easyeda', 'soldermask', 'top'],
  ['Gerber_BottomSolderMaskLayer.GBS', GERBER, 'easyeda', 'soldermask', 'bottom'],
  ['Gerber_TopPasteMaskLayer.GTP', GERBER, 'easyeda', 'paste', 'top'],
  ['Gerber_InnerLayer1.G1', GERBER, 'easyeda', 'copper', 'inner'],
  ['Drill_PTH_Through.DRL', DRILL, 'easyeda', 'drill', 'all', 'pth'],
  ['Drill_NPTH_Through.DRL', DRILL, 'easyeda', 'drill', 'all', 'npth'],
  ['Gerber_Drill_PTH.DRL', DRILL, 'easyeda', 'drill', 'all', 'pth'],
  ['Gerber_Drill_NPTH.DRL', DRILL, null, 'drill', 'all', 'npth'],
  ['Gerber_DocumentLayer.GDL', GERBER, 'easyeda', 'fab', 'all'],
  // Keywords and sniffing
  ['my_board_top_copper.gbr', GERBER, null, 'copper', 'top'],
  ['bottom_soldermask.gbr', GERBER, null, 'soldermask', 'bottom'],
  ['edge.gbr', GERBER, null, 'outline', 'all'],
  ['mystery.gbr', OUTLINE, null, 'outline', 'all'],
  ['mystery.gbr', GERBER, null, 'other', 'none'],
  ['mystery.nc', DRILL, null, 'drill', 'all', 'pth'],
  ['holes_unnamed.foo', DRILL, null, 'drill', 'all', 'pth']
]

describe('detectLayer naming conventions', () => {
  it.each(ROWS)('%s (eda=%s…)', (name, text, eda, type, side, plating) => {
    const d = detectLayer(name, text, eda)
    expect({ type: d.type, side: d.side }).toEqual({ type, side })
    if (plating) expect(d.plating).toBe(plating)
    else if (type !== 'drill') expect(d.plating).toBeUndefined()
    expect(d.reason.length).toBeGreaterThan(0)
    expect(d.confidence).toBeGreaterThan(0)
    expect(d.confidence).toBeLessThanOrEqual(1)
  })
})

describe('X2 FileFunction priority', () => {
  const x2 = (ff: string): string =>
    `%TF.FileFunction,${ff}*%\n%FSLAX46Y46*%\n%MOMM*%\n%ADD10C,0.1*%\nD10*\nX0Y0D02*\nX100Y0D01*\nM02*\n`

  it('beats a contradicting file name', () => {
    const d = detectLayer('board-B_Cu.gbr', read('import', 'copper-top-x2.gbr'), 'kicad')
    expect(d).toMatchObject({ type: 'copper', side: 'top', confidence: 0.99 })
    expect(d.reason).toMatch(/X2/)
  })

  it.each([
    ['Copper,L1,Top', 'copper', 'top'],
    ['Copper,L2,Bot', 'copper', 'bottom'],
    ['Copper,L3,Inr,Plane', 'copper', 'inner'],
    ['Soldermask,Top', 'soldermask', 'top'],
    ['Soldermask,Bot', 'soldermask', 'bottom'],
    ['Legend,Top', 'silkscreen', 'top'],
    ['Legend,Bot', 'silkscreen', 'bottom'],
    ['Paste,Top', 'paste', 'top'],
    ['Profile,NP', 'outline', 'all'],
    ['Plated,1,2,PTH', 'drill', 'all'],
    ['NonPlated,1,2,NPTH', 'drill', 'all'],
    ['AssemblyDrawing,Top', 'fab', 'top'],
    ['FabricationDrawing', 'fab', 'all'],
    ['Other,Courtyard,Bot', 'fab', 'bottom'],
    ['Glue,Top', 'other', 'top']
  ] as const)('%s', (ff, type, side) => {
    expect(fromFileFunction(ff)).toMatchObject({ type, side })
    expect(detectLayer('whatever.gbr', x2(ff), null)).toMatchObject({ type, side })
  })

  it('reads G04 comment form and Excellon comment form', () => {
    const g04 = 'G04 #@! TF.FileFunction,Soldermask,Bot*\n%FSLAX46Y46*%\n%MOMM*%\nM02*\n'
    expect(detectLayer('a.gbr', g04, null)).toMatchObject({ type: 'soldermask', side: 'bottom' })
    expect(detectLayer('weird.gtl', KICAD_NPTH, null)).toMatchObject({ type: 'drill', plating: 'npth' })
  })

  it('NPTH plating: content beats file name', () => {
    expect(detectLayer('board-PTH.drl', KICAD_NPTH, 'kicad').plating).toBe('npth')
  })

  it('Excellon content overrides a non-drill name', () => {
    expect(detectLayer('board.gtl', DRILL, null)).toMatchObject({ type: 'drill', side: 'all' })
  })
})

describe('isRelevantFile / isRelevantForEda', () => {
  it.each([
    ['board-F_Cu.gbr', GERBER, 'kicad', true],
    ['board-PTH.drl', DRILL, 'kicad', true],
    ['board-job.gbrjob', '{"Header":{}}', 'kicad', false],
    ['board-top.pos', 'Ref Val Package\n', 'kicad', false],
    ['board-drl_map.gbr', GERBER, 'kicad', false],
    ['board.rpt', 'report\n', 'kicad', false],
    ['bom.csv', read('import', 'bom.csv'), null, false],
    ['PickAndPlace_PCB1.csv', 'a,b\n', 'easyeda', false],
    ['How-to-order-PCB.txt', 'Upload the zip...\n', 'easyeda', false],
    ['PCB1.apr', 'D10 ROUND 10\n', 'altium', false],
    ['PCB1.REP', 'report', 'altium', false],
    ['PCB1.RUL', 'rules', 'altium', false],
    ['PCB1.EXTREP', 'x', 'altium', false],
    ['PCB1.LDP', 'x', 'altium', false],
    ['Status Report.Txt', 'Output: Gerber Files\n', 'altium', false],
    ['PCB1.TXT', ALTIUM_DRILL, 'altium', true],
    ['board.dri', 'Drill File Info\nT01 0.6mm\n', 'eagle', false],
    ['board.gpi', 'Photoplotter Info\n', 'eagle', false],
    ['README.txt', 'hello', null, false],
    ['board.pdf', '%PDF-1.4', null, false],
    ['board.png', 'x', null, false],
    ['board.ipc', 'P  JOB', null, false],
    ['board.json', '{}', null, false],
    ['empty.gbr', '   \n', null, false],
    ['random.dat', 'just some text', null, false],
    ['mystery.gbr', GERBER, null, true]
  ] as const)('%s → %s', (name, text, eda, relevant) => {
    const r = isRelevantFile(name, text, eda)
    expect(r.relevant).toBe(relevant)
    expect(r.reason.length).toBeGreaterThan(0)
    expect(detectLayer(name, text, eda).isRelevantForEda).toBe(relevant)
  })
})

describe('outline heuristic', () => {
  it('accepts thin closed loops and rejects pads / open paths', () => {
    expect(looksLikeOutline(OUTLINE)).toBe(true)
    expect(looksLikeOutline(GERBER)).toBe(false)
    const open = OUTLINE.replace('X0Y0D01*\n', '')
    expect(looksLikeOutline(open)).toBe(false)
  })
})
