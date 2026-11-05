/**
 * Advanced "Skip parts" section of the Step editor: click copper areas (isolation) or holes
 * (drilling, hole milling) on the board to leave them out of this step. Only offered while
 * Settings -> Advanced -> "Allow skipping traces and holes in a step" is on (DECISIONS D-023).
 */
import { useCallback, useMemo } from 'react'
import { Ban, RotateCcw } from 'lucide-react'
import type { CamStep, DrillHole, PolygonSet, SkipRef, StepKind } from '@core/model/types'
import { pointInPolygonSet, union } from '@core/geometry'
import { computeBoardBBox } from '@core/model/board'
import { holeMatches } from '@core/toolpath'
import { useUi } from '@renderer/store/ui'
import { useLayersWithParsed } from '@renderer/store/controller'
import { BoardCanvas, type OverlayDraw } from '@renderer/viewport/BoardCanvas'
import { polygonSetPath } from '@renderer/viewport/boardRender'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/fields'
import type { SectionProps } from './editorSections'

/** Step kinds that can skip parts. */
export const SKIP_KINDS: StepKind[] = ['isolate', 'drill', 'holeMill']

export function setAdvancedSkip(on: boolean): void {
  useUi.getState().set({ advancedSkip: on })
  void window.tracemill?.settingsSet('advancedSkip', on)
  useUi
    .getState()
    .toast(
      'info',
      on
        ? 'Advanced: isolation, drilling and hole-milling steps now have a “Skip parts” section.'
        : 'Skipping parts is hidden again. Steps that already skip parts keep doing so (their card shows it).'
    )
}

/** Whether the step editor shows the Skip section for this draft. */
export function useShowSkip(draft: CamStep): boolean {
  const advanced = useUi((s) => s.advancedSkip)
  return SKIP_KINDS.includes(draft.kind) && (advanced || !!draft.skip?.items.length)
}

const ROSE = '#f43f5e'

export function SkipSection({ draft, update }: SectionProps): React.JSX.Element {
  const all = useLayersWithParsed()
  const copperStep = draft.kind === 'isolate'
  const stepLayers = useMemo(
    () => all.filter((l) => draft.layerIds.includes(l.id) && l.parsed),
    [all, draft.layerIds]
  )
  // what is drawn: the step's layers plus, for hole steps, the copper and outline around them
  const shown = useMemo(
    () =>
      all
        .filter(
          (l) =>
            l.parsed &&
            (draft.layerIds.includes(l.id) ||
              (!copperStep &&
                ((l.type === 'copper' && (l.side === draft.side || l.side === 'all')) ||
                  l.type === 'outline')))
        )
        .map((l) => ({ ...l, visible: true })),
    [all, draft.layerIds, draft.side, copperStep]
  )
  const fitBox = useMemo(() => computeBoardBBox(shown), [shown])
  const copper: PolygonSet = useMemo(
    () => (copperStep ? union(...stepLayers.map((l) => l.parsed!.geometry).filter((g) => g.length)) : []),
    [copperStep, stepLayers]
  )
  const range =
    draft.kind === 'drill' ? draft.params.drill : draft.kind === 'holeMill' ? draft.params.holeMill : null
  const holes: DrillHole[] = useMemo(
    () =>
      copperStep || !range
        ? []
        : stepLayers
            .flatMap((l) => l.parsed!.drills?.holes ?? [])
            .filter((h) => h.diameter >= range.minDiameter - 1e-3 && h.diameter <= range.maxDiameter + 1e-3),
    [copperStep, stepLayers, range]
  )
  const enabled = draft.skip?.enabled ?? false
  const items = useMemo(() => draft.skip?.items ?? [], [draft.skip])

  const setItems = useCallback(
    (next: SkipRef[], on = true): void => update((d) => ({ ...d, skip: { enabled: on, items: next } })),
    [update]
  )

  const onPick = (x: number, y: number, ppm: number): void => {
    if (copperStep) {
      const poly = copper.find((p) => pointInPolygonSet({ x, y }, [p]))
      if (!poly) return
      const at = items.findIndex((it) => it.kind === 'copper' && pointInPolygonSet(it, [poly]))
      setItems(at >= 0 ? items.filter((_, i) => i !== at) : [...items, { kind: 'copper', x, y }])
      return
    }
    let best: DrillHole | null = null
    let bestD = Infinity
    for (const h of holes) {
      const d = Math.hypot(h.x - x, h.y - y)
      if (d < bestD && d <= Math.max(h.diameter / 2, 8 / ppm)) {
        best = h
        bestD = d
      }
    }
    if (!best) return
    const h = best
    const at = items.findIndex((it) => holeMatches(it, h))
    setItems(
      at >= 0 ? items.filter((_, i) => i !== at) : [...items, { kind: 'hole', x: h.x, y: h.y, d: h.diameter }]
    )
  }

  const skippedPolys = useMemo(
    () =>
      copperStep
        ? copper.filter((p) => items.some((it) => it.kind === 'copper' && pointInPolygonSet(it, [p])))
        : [],
    [copperStep, copper, items]
  )
  const missed = copperStep
    ? items.filter((it) => it.kind === 'copper' && !copper.some((p) => pointInPolygonSet(it, [p]))).length
    : items.filter((it) => it.kind === 'hole' && !holes.some((h) => holeMatches(it, h))).length

  const overlay: OverlayDraw = (ctx, _view, ppm) => {
    const px = 1 / ppm
    ctx.save()
    ctx.globalAlpha = enabled ? 1 : 0.7
    if (skippedPolys.length) {
      const path = polygonSetPath(skippedPolys)
      ctx.fillStyle = 'rgba(244,63,94,0.55)'
      ctx.fill(path, 'evenodd')
      ctx.strokeStyle = ROSE
      ctx.lineWidth = 2 * px
      ctx.stroke(path)
    }
    if (!copperStep) {
      for (const h of holes) {
        const skipped = items.some((it) => holeMatches(it, h))
        const r = Math.max(h.diameter / 2, 3 * px)
        ctx.beginPath()
        ctx.arc(h.x, h.y, r + 2 * px, 0, Math.PI * 2)
        ctx.lineWidth = (skipped ? 2.5 : 1.2) * px
        ctx.strokeStyle = skipped ? ROSE : 'rgba(56,189,248,0.85)'
        ctx.stroke()
        if (skipped) {
          const k = (r + 2 * px) * 0.7
          ctx.beginPath()
          ctx.moveTo(h.x - k, h.y - k)
          ctx.lineTo(h.x + k, h.y + k)
          ctx.moveTo(h.x + k, h.y - k)
          ctx.lineTo(h.x - k, h.y + k)
          ctx.stroke()
        }
      }
    }
    ctx.restore()
  }

  const n = copperStep
    ? skippedPolys.length
    : items.filter((it) => holes.some((h) => holeMatches(it, h))).length
  const noun = copperStep ? 'copper area' : 'hole'
  return (
    <div className="flex flex-col gap-3" data-testid="skip-section">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <Switch
            label={copperStep ? 'Leave the picked copper areas un-isolated' : 'Leave the picked holes out'}
            checked={enabled}
            onChange={(v) => setItems(items, v)}
            description={
              copperStep
                ? 'A skipped copper area gets no isolation groove, so it stays connected to the copper around it. Use it for areas you do not need (e.g. an unused connector), never for a trace that must be separate.'
                : 'Skipped holes are not drilled / milled by this step. Use it for holes you do not need, or that you will make some other way.'
            }
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Click {copperStep ? 'a trace or pad' : 'a hole'} on the board below to skip it (red); click it
            again to machine it after all. Drag to move, scroll to zoom.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={n ? 'text-xs font-semibold text-rose-300' : 'text-xs text-slate-500'}
            data-testid="skip-count"
          >
            <Ban className="mr-1 inline size-3.5" />
            {n} {noun}
            {n === 1 ? '' : 's'} skipped
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={!items.length}
            onClick={() => setItems([], enabled)}
          >
            <RotateCcw /> Clear
          </Button>
        </div>
      </div>
      {missed > 0 && (
        <p className="text-[11px] text-amber-300">
          ! {missed} picked part{missed === 1 ? ' is' : 's are'} no longer on this step’s layers.{' '}
          <button
            className="underline"
            onClick={() =>
              setItems(
                items.filter((it) =>
                  copperStep
                    ? copper.some((p) => pointInPolygonSet(it, [p]))
                    : holes.some((h) => holeMatches(it, h))
                ),
                enabled
              )
            }
          >
            Remove {missed === 1 ? 'it' : 'them'}
          </button>
        </p>
      )}
      <div className="h-[340px] overflow-hidden rounded-lg border border-slate-800" data-testid="skip-board">
        <BoardCanvas
          layers={shown}
          side={draft.side}
          realistic={false}
          highlight={false}
          fitBox={fitBox}
          overlay={overlay}
          redrawKey={`${items.length}:${enabled}:${JSON.stringify(items)}`}
          onPick={onPick}
        />
      </div>
    </div>
  )
}
