import { useCallback, useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, Loader2, MousePointerClick, FileX, X } from 'lucide-react'
import type { BBox } from '@core/model/types'
import { bboxIsEmpty, bboxUnion } from '@core/geometry'
import { boardToStockTransform, stockRectInWork } from '@core/toolpath'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import {
  canEnterStage,
  importDropped,
  reimportLayer,
  removeLayer,
  resetLayerToAuto,
  startImport,
  useBoardBBox,
  useBoardHint,
  useLayersWithParsed,
  useLayerStatus,
  useStageStatus
} from '@renderer/store/controller'
import { LayerPanel, LayerStatusPanel, type LayerStatusEntry } from '@renderer/layers/LayerPanel'
import { edaInfo } from '@renderer/layers/eda'
import { ImportDropZone } from '@renderer/layers/ImportDropZone'
import { BoardCanvas, type OverlayDraw } from '@renderer/viewport/BoardCanvas'
import { Button } from '@renderer/components/ui/button'
import { Segmented, Switch } from '@renderer/components/ui/fields'
import { StatusCircle } from '@renderer/components/ui/status'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'

/** Layer kinds that belong to one side of the board (the status shows which sides have one). */
const SIDED = new Set(['copper', 'silkscreen', 'soldermask'])

const STATUS_LABELS: Record<string, string> = {
  copper: 'Copper',
  outline: 'Board outline',
  drill: 'Drill holes',
  silkscreen: 'Silkscreen',
  soldermask: 'Solder mask',
  fab: 'Fab / Assembly'
}

export function BoardStage(): React.JSX.Element {
  const layers = useLayersWithParsed()
  const p = useProject()
  const ui = useUi()
  const status = useLayerStatus()
  const stageStatus = useStageStatus()
  const hint = useBoardHint()
  const bbox = useBoardBBox()

  const statusEntries: LayerStatusEntry[] = useMemo(
    () =>
      status.map((s) => {
        const of = p.layers.filter((l) => l.type === s.key)
        const sides = SIDED.has(s.key)
          ? (['top', 'bottom'] as const).filter((side) => of.some((l) => l.side === side || l.side === 'all'))
          : undefined
        return { ...s, label: STATUS_LABELS[s.key] ?? s.key, sides: sides ? [...sides] : undefined }
      }),
    [status, p.layers]
  )

  // Layers that belong to the side that is not shown (so the user knows they exist).
  const otherSide = ui.boardSide === 'top' ? 'bottom' : ui.boardSide === 'bottom' ? 'top' : null
  const onOtherSide = otherSide ? p.layers.filter((l) => l.side === otherSide).length : 0
  const material = p.material

  // Stock rectangle expressed in BOARD coordinates (so the extra material shows around the board).
  const stockInBoard = useMemo(() => {
    if (!material || bboxIsEmpty(bbox)) return null
    const m = boardToStockTransform(material, bbox)
    // invert the (rigid) transform for the four stock corners
    const det = m[0] * m[3] - m[1] * m[2]
    const inv = (x: number, y: number): [number, number] => {
      const dx = x - m[4]
      const dy = y - m[5]
      return [(m[3] * dx - m[2] * dy) / det, (-m[1] * dx + m[0] * dy) / det]
    }
    return [inv(0, 0), inv(material.width, 0), inv(material.width, material.height), inv(0, material.height)]
  }, [material, bbox])

  const fitBox: BBox | null = useMemo(() => {
    if (bboxIsEmpty(bbox)) return null
    if (!stockInBoard) return bbox
    const s: BBox = {
      minX: Math.min(...stockInBoard.map((q) => q[0])),
      minY: Math.min(...stockInBoard.map((q) => q[1])),
      maxX: Math.max(...stockInBoard.map((q) => q[0])),
      maxY: Math.max(...stockInBoard.map((q) => q[1]))
    }
    return bboxUnion(bbox, s)
  }, [bbox, stockInBoard])

  const underlay: OverlayDraw = useCallback(
    (ctx, _v, zoom) => {
      if (!stockInBoard) return
      ctx.save()
      ctx.beginPath()
      stockInBoard.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.fillStyle = 'rgba(184,115,51,0.13)'
      ctx.fill()
      ctx.setLineDash([6 / zoom, 4 / zoom])
      ctx.strokeStyle = 'rgba(217,149,84,0.8)'
      ctx.lineWidth = 1.2 / zoom
      ctx.stroke()
      ctx.restore()
    },
    [stockInBoard]
  )

  const stockSize = material ? stockRectInWork(material) : null
  const empty = layers.length === 0

  return (
    <div className="flex h-full">
      <aside className="flex w-80 shrink-0 flex-col border-r border-slate-800 bg-slate-900/40">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LayerPanel
            layers={p.layers}
            onToggleVisible={p.setLayerVisible}
            onAllVisible={p.setAllVisible}
            onColor={p.setLayerColor}
            onType={p.setLayerType}
            onSide={p.setLayerSide}
            onResetAuto={(id) => void resetLayerToAuto(id)}
            onMove={p.moveLayer}
            onDelete={removeLayer}
            onReimport={(id) => void reimportLayer(id)}
            onAdd={() => void startImport('files')}
          />
          {ui.skippedFiles.length > 0 && (
            <IgnoredFiles files={ui.skippedFiles} onDismiss={() => ui.set({ skippedFiles: [] })} />
          )}
        </div>
        <LayerStatusPanel status={statusEntries} />
        <div className="flex items-center gap-2 border-t border-slate-800 p-3">
          <StatusCircle level={empty ? 'pending' : stageStatus.board} size={22} title={hint} />
          <div
            className={cn(
              'flex-1 text-xs leading-snug',
              stageStatus.board === 'warning' && !empty
                ? 'text-amber-300'
                : stageStatus.board === 'error' && !empty
                  ? 'text-rose-300'
                  : 'text-slate-400'
            )}
            data-testid="board-hint"
          >
            {hint}
          </div>
          <Button
            variant="success"
            disabled={!canEnterStage('manufacture')}
            onClick={() => ui.set({ stage: 'manufacture' })}
            data-testid="continue-manufacture"
          >
            Continue <ArrowRight />
          </Button>
        </div>
      </aside>

      <section className="relative min-w-0 flex-1">
        <ImportDropZone
          onFiles={(f) => void importDropped(f)}
          onBrowse={(k) => void startImport(k)}
          compact={!empty}
        >
          {!empty && (
            <BoardCanvas
              layers={layers}
              side={ui.boardSide}
              realistic={p.settings.realisticColors}
              highlight={p.settings.highlightOnHover}
              fitBox={fitBox}
              underlay={underlay}
              toolbar={
                <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/90 p-1.5 shadow-lg">
                  <Tooltip content="Which side of the board to look at: the top, the bottom (mirrored, as if you flipped it over), or both sides at once seen from the top">
                    <div className="flex items-center gap-2 rounded-md border border-slate-700/80 bg-slate-950/60 px-2 py-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        View
                      </span>
                      <Segmented
                        size="sm"
                        value={ui.boardSide}
                        onChange={(v) => ui.set({ boardSide: v })}
                        options={[
                          { value: 'top', label: 'Top' },
                          { value: 'bottom', label: 'Bottom' },
                          { value: 'both', label: 'Both' }
                        ]}
                      />
                    </div>
                  </Tooltip>
                  <div className="w-48 rounded-md border border-slate-700/80 bg-slate-950/60 px-2.5 py-1.5">
                    <Switch
                      label="Realistic colours"
                      checked={p.settings.realisticColors}
                      onChange={(v) => p.setSettings({ realisticColors: v })}
                      help="Shows the board like a manufactured PCB: green solder mask, gold pads, white silkscreen. Turn off to see each layer in its own colour."
                    />
                  </div>
                  <div className="rounded-md border border-slate-700/80 bg-slate-950/60 px-2.5 py-1.5">
                    <div className="w-44">
                      <Switch
                        label="Highlight traces"
                        checked={p.settings.highlightOnHover}
                        onChange={(v) => p.setSettings({ highlightOnHover: v })}
                        help="Hover over copper to highlight the whole connection (net). Click to freeze the highlight, click again to release it."
                      />
                    </div>
                    {p.settings.highlightOnHover && (
                      <span className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
                        <MousePointerClick className="size-3" /> click a trace to freeze
                      </span>
                    )}
                  </div>
                </div>
              }
            />
          )}
        </ImportDropZone>
        {!empty && stockSize && (
          <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-slate-950/80 px-2 py-1 font-mono text-[11px] text-slate-400">
            Board {(bbox.maxX - bbox.minX).toFixed(1)}×{(bbox.maxY - bbox.minY).toFixed(1)} mm · material{' '}
            <span className="text-amber-400/90">
              {material!.width.toFixed(1)}×{material!.height.toFixed(1)} mm
            </span>
          </div>
        )}
        {ui.importing && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/60">
            <div className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm text-slate-200 shadow-xl">
              <Loader2 className="size-4 animate-spin" /> Reading and analysing your files…
            </div>
          </div>
        )}
        {!empty && onOtherSide > 0 && p.settings.realisticColors && (
          <div
            className="absolute bottom-16 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-sky-500/40 bg-slate-900/90 px-3 py-1 text-xs text-sky-100 shadow-lg"
            data-testid="other-side-note"
          >
            Showing the board {ui.boardSide}. {onOtherSide} layer{onOtherSide === 1 ? '' : 's'}{' '}
            {onOtherSide === 1 ? 'belongs' : 'belong'} to the board {otherSide}.
            <button
              type="button"
              className="rounded-full bg-sky-500/20 px-2 py-0.5 font-medium hover:bg-sky-500/30"
              onClick={() => ui.set({ boardSide: 'both' })}
            >
              Show both
            </button>
          </div>
        )}
        {!empty && p.settings.edaTool && (
          <div className="pointer-events-none absolute bottom-9 left-3 rounded bg-slate-950/80 px-2 py-0.5 text-[10px] text-slate-500">
            Design program: <span className="text-slate-300">{edaInfo(p.settings.edaTool)?.name}</span>{' '}
            (change it in Settings)
          </div>
        )}
      </section>
    </div>
  )
}

/** Files from the last import that were not PCB fabrication files: folded away by default. */
function IgnoredFiles({
  files,
  onDismiss
}: {
  files: { name: string; reason: string }[]
  onDismiss: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="border-b border-slate-800 px-3 py-2 text-[11px] text-slate-500"
      data-testid="ignored-files"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-semibold text-slate-400 hover:text-slate-200"
          title="Files from your last import that are not needed for milling (reports, BOMs, pick-and-place, images…)"
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <FileX className="size-3.5" /> {files.length} file{files.length === 1 ? '' : 's'} not imported
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded p-0.5 hover:bg-slate-800 hover:text-slate-200"
          aria-label="Dismiss"
          title="Hide this list"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {open && (
        <div className="mt-1 max-h-40 overflow-y-auto pl-5">
          <p className="mb-1 text-slate-500">Not needed for milling, so they were left out:</p>
          {files.slice(0, 200).map((s) => (
            <div key={s.name} className="truncate" title={s.reason}>
              {s.name} <span className="text-slate-600">— {s.reason}</span>
            </div>
          ))}
          {files.length > 200 && <div>…and {files.length - 200} more</div>}
        </div>
      )}
    </div>
  )
}
