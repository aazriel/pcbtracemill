import { useCallback, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { BBox, Toolpath } from '@core/model/types'
import { bboxIsEmpty, bboxUnion } from '@core/geometry'
import { effectiveCutWidth } from '@core/tools'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { useBoardBBox, useLayersWithParsed } from '@renderer/store/controller'
import { MachineSection } from '@renderer/machine/MachineSection'
import { MaterialSection } from '@renderer/material/MaterialSection'
import { BoardCanvas, type OverlayDraw } from '@renderer/viewport/BoardCanvas'
import {
  drawOrigin,
  drawStock,
  drawToolpaths,
  prepareToolpaths,
  stockCornersInBoard
} from '@renderer/viewport/toolpathOverlay'
import { Segmented, Switch } from '@renderer/components/ui/fields'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { StepsPanel } from '@renderer/steps/StepsPanel'
import { ProblemsPanel } from '@renderer/steps/ProblemsPanel'
import { GenerationFooter } from '@renderer/steps/GenerationFooter'
import { AddStepDialog } from '@renderer/steps/AddStepDialog'
import { StepEditorDialog } from '@renderer/steps/StepEditorDialog'
import { stepColor, stepIcon } from '@renderer/steps/stepUtils'

export function ManufactureStage(): React.JSX.Element {
  const layers = useLayersWithParsed()
  const bbox = useBoardBBox()
  const material = useProject((s) => s.material)
  const steps = useProject((s) => s.steps)
  const tools = useProject((s) => s.tools)
  const settings = useProject((s) => s.settings)
  const setSettings = useProject((s) => s.setSettings)
  const viewSide = useUi((s) => s.viewSide)
  const cam = useUi((s) => s.cam)
  const camStale = useUi((s) => s.camStale)
  const generating = useUi((s) => s.generating)
  const selectedStepId = useUi((s) => s.selectedStepId)
  const problemStepId = useUi((s) => s.problemStepId)
  const problemFocus = useUi((s) => s.problemFocus)
  const setUi = useUi((s) => s.set)
  const [showRapids, setShowRapids] = useState(false)
  const [showPaths, setShowPaths] = useState(true)

  const stockCorners = useMemo(
    () => (material && !bboxIsEmpty(bbox) ? stockCornersInBoard(material, bbox) : null),
    [material, bbox]
  )
  const fitBox: BBox | null = useMemo(() => {
    if (bboxIsEmpty(bbox)) return null
    if (!stockCorners) return bbox
    return bboxUnion(bbox, {
      minX: Math.min(...stockCorners.map((q) => q[0])),
      minY: Math.min(...stockCorners.map((q) => q[1])),
      maxX: Math.max(...stockCorners.map((q) => q[0])),
      maxY: Math.max(...stockCorners.map((q) => q[1]))
    })
  }, [bbox, stockCorners])

  // Step colour = position in the list (matches the stripe on each step card).
  const colorIndex = useMemo(() => new Map(steps.map((s, i) => [s.id, i])), [steps])
  const prepared = useMemo(() => {
    if (!cam || !material || bboxIsEmpty(bbox)) return []
    const enabled = new Set(steps.filter((s) => s.enabled).map((s) => s.id))
    const widthOf = (tp: Toolpath): number => {
      const tool = tools.find((t) => t.id === tp.toolId)
      const step = steps.find((s) => s.id === tp.stepId)
      if (!tool) return 0.2
      return step && (tp.stepKind === 'isolate' || tp.stepKind === 'clear')
        ? effectiveCutWidth(tool, step.cutDepth)
        : tool.geometry.diameter
    }
    return prepareToolpaths(
      cam.toolpaths.filter((t) => enabled.has(t.stepId)),
      material,
      bbox,
      (id) => stepColor(colorIndex.get(id) ?? 0),
      widthOf
    )
    // Toolpaths only change with a new CAM result; steps/tools are read for colour and width.
  }, [cam, material, bbox, steps, tools, colorIndex])

  // Places the steps cannot machine (board coordinates), and the one the view is zoomed to.
  const problems = useMemo(() => {
    const enabled = new Set(steps.filter((s) => s.enabled).map((s) => s.id))
    return (cam?.toolpaths ?? [])
      .filter((t) => enabled.has(t.stepId))
      .flatMap((t) => (t.problems ?? []).map((p, i) => ({ ...p, stepId: t.stepId, side: t.side, n: i + 1 })))
  }, [cam, steps])
  const focusBox: BBox | null = useMemo(() => {
    const p = problems.find((q) => q.id === problemFocus)
    if (!p) return null
    const r = 1.5
    return { minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r }
  }, [problems, problemFocus])

  const underlay: OverlayDraw = useCallback(
    (ctx, _v, zoom) => {
      if (stockCorners) drawStock(ctx, stockCorners, zoom)
    },
    [stockCorners]
  )
  const overlay: OverlayDraw = useCallback(
    (ctx, view, zoom) => {
      if (showPaths)
        drawToolpaths(ctx, prepared, zoom, { side: viewSide, selectedId: selectedStepId, showRapids })
      if (material && !bboxIsEmpty(bbox)) drawOrigin(ctx, view, material, bbox, viewSide)
      drawProblems(ctx, zoom, problems, viewSide, problemStepId, problemFocus)
    },
    [
      prepared,
      viewSide,
      selectedStepId,
      showRapids,
      showPaths,
      material,
      bbox,
      problems,
      problemStepId,
      problemFocus
    ]
  )

  const sideSteps = steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.enabled && cam?.toolpaths.some((t) => t.stepId === s.id && t.side === viewSide))
  const otherSide = steps.filter(
    (s) => s.enabled && cam?.toolpaths.some((t) => t.stepId === s.id && t.side !== viewSide)
  ).length

  return (
    <div className="flex h-full">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-slate-800 bg-slate-900/40">
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="manufacture-left">
          <MachineSection />
          <MaterialSection />
          <StepsPanel />
        </div>
        <GenerationFooter />
      </aside>

      <section className="relative min-w-0 flex-1">
        <BoardCanvas
          layers={layers}
          side={viewSide}
          realistic={settings.realisticColors}
          highlight={false}
          fitBox={fitBox}
          focusBox={focusBox}
          underlay={underlay}
          overlay={overlay}
          toolbar={
            <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 shadow-lg">
              <Tooltip content="Look at the board from the top, or from the bottom (mirrored, as it lies on the machine after flipping). Each side shows the toolpaths milled while that side faces up.">
                <span>
                  <Segmented
                    size="sm"
                    value={viewSide}
                    onChange={(v) => setUi({ viewSide: v })}
                    options={[
                      { value: 'top', label: 'Top' },
                      { value: 'bottom', label: 'Bottom' }
                    ]}
                  />
                </span>
              </Tooltip>
              <div>
                <Switch
                  label="Toolpaths"
                  checked={showPaths}
                  onChange={setShowPaths}
                  help="Shows where the bit will cut. The coloured line is the centre of the bit, the faint band around it is the width of material removed."
                />
              </div>
              <div>
                <Switch
                  label="Travel moves"
                  checked={showRapids}
                  onChange={setShowRapids}
                  help="Dashed lines show the fast moves in the air between cuts (the bit is lifted to the safe height)."
                />
              </div>
              <div>
                <Switch
                  label="Realistic colours"
                  checked={settings.realisticColors}
                  onChange={(v) => setSettings({ realisticColors: v })}
                  help="Shows the board like a manufactured PCB instead of one colour per layer."
                />
              </div>
            </div>
          }
        />

        {/* legend */}
        {showPaths && (sideSteps.length > 0 || otherSide > 0) && (
          <div
            className="absolute bottom-2 left-3 max-w-xs rounded-lg border border-slate-800 bg-slate-950/85 p-2 text-[11px] shadow-lg"
            data-testid="toolpath-legend"
          >
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Toolpaths · {viewSide} side
            </div>
            {sideSteps.map(({ s, i }) => {
              const Icon = stepIcon(s.kind)
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setUi({ selectedStepId: selectedStepId === s.id ? null : s.id })}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-slate-800',
                    selectedStepId === s.id && 'bg-slate-800 text-white',
                    selectedStepId && selectedStepId !== s.id && 'opacity-50'
                  )}
                >
                  <span className="h-1 w-4 shrink-0 rounded" style={{ background: stepColor(i) }} />
                  <Icon className="size-3 shrink-0 text-slate-400" />
                  <span className="truncate text-slate-300">
                    {i + 1}. {s.name}
                  </span>
                </button>
              )
            })}
            {otherSide > 0 && (
              <div className="mt-1 text-[10px] text-slate-500">
                {otherSide} step{otherSide > 1 ? 's' : ''} on the {viewSide === 'top' ? 'bottom' : 'top'} side
                hidden ·{' '}
                <button
                  type="button"
                  className="text-sky-400 hover:underline"
                  onClick={() => setUi({ viewSide: viewSide === 'top' ? 'bottom' : 'top' })}
                >
                  show
                </button>
              </div>
            )}
          </div>
        )}

        {(generating || (camStale && cam)) && (
          <div className="pointer-events-none absolute right-16 top-3 flex items-center gap-1.5 rounded bg-slate-950/85 px-2 py-1 text-[11px] text-slate-300">
            {generating ? (
              <>
                <Loader2 className="size-3 animate-spin text-sky-400" /> Updating toolpaths…
              </>
            ) : (
              <span className="text-amber-400">Toolpaths shown are out of date</span>
            )}
          </div>
        )}
        {!steps.length && (
          <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center">
            <div className="rounded-lg bg-slate-950/85 px-4 py-2 text-xs text-slate-400">
              Toolpaths appear here once you add steps (try the <b className="text-slate-200">Recipe</b>{' '}
              button).
            </div>
          </div>
        )}
        <ProblemsPanel />
      </section>

      <AddStepDialog />
      <StepEditorDialog />
    </div>
  )
}

/** Red rings where a step cannot machine; the listed step's places are numbered, the focused one glows. */
function drawProblems(
  ctx: CanvasRenderingContext2D,
  zoom: number,
  problems: { id: string; x: number; y: number; stepId: string; side: string; n: number }[],
  side: string,
  listedStepId: string | null,
  focusId: string | null
): void {
  const px = 1 / zoom
  ctx.save()
  for (const p of problems) {
    if (p.side !== side) continue
    const focused = p.id === focusId
    const listed = p.stepId === listedStepId
    const r = (focused ? 13 : 9) * px
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fillStyle = focused ? 'rgba(251,191,36,0.25)' : 'rgba(244,63,94,0.18)'
    ctx.fill()
    ctx.lineWidth = (focused ? 2.5 : 1.8) * px
    ctx.strokeStyle = focused ? '#fbbf24' : '#f43f5e'
    ctx.stroke()
    if (listed) {
      // number label (the canvas may be mirrored for the bottom view: draw text un-mirrored)
      const t = ctx.getTransform()
      const sx = t.a * p.x + t.c * p.y + t.e
      const sy = t.b * p.x + t.d * p.y + t.f
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const dpr = Math.hypot(t.a, t.b) * px
      ctx.font = `bold ${11 * dpr}px ui-sans-serif, system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#0b0f14'
      ctx.beginPath()
      ctx.arc(sx + 11 * dpr, sy - 11 * dpr, 7 * dpr, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = focused ? '#fde68a' : '#fecdd3'
      ctx.fillText(String(p.n), sx + 11 * dpr, sy - 10.5 * dpr)
      ctx.restore()
    }
  }
  ctx.restore()
}
