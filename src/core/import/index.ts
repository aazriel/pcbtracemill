/**
 * File import: archive expansion, layer detection and ImportedLayer assembly.
 * `defaultParse` lives in './parse' (it depends on the Gerber parser) and is not re-exported here.
 */
export { expandInputs, looksBinary, type ExpandedFile, type InputFile } from './expand'
export { detectLayer, isRelevantFile, fromFileFunction, baseName, type LayerDetection } from './detect'
export {
  buildImportedLayer,
  computeLayerStats,
  defaultLayerColor,
  summarizeLayerStatus,
  type LayerStatusEntry,
  type LayerStatusKey,
  type ParseFn
} from './layer'
export { looksLikeGerber, looksLikeOutline, readFileFunction, sketchGerber, type GerberSketch } from './sniff'
