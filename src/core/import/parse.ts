/**
 * Default parser dispatch: Excellon content → parseExcellon, everything else → parseGerber.
 */
import type { DetectionResult, ParsedLayer } from '../model/types'
import { isExcellon, parseExcellon } from '../excellon'
import { parseGerber } from '../gerber'

export function defaultParse(text: string, name: string, detection: DetectionResult): ParsedLayer {
  if (isExcellon(text)) {
    const plated = detection.plating === 'npth' ? false : detection.plating === 'pth' ? true : undefined
    return parseExcellon(text, { fileName: name, plated })
  }
  return parseGerber(text, { fileName: name })
}
