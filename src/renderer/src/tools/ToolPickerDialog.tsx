/**
 * "Choose a tool" for one step: the recommended tools in a green frame (for isolation: the bits whose
 * groove fits the narrowest gap between traces, the best one ringed), the others folded away under
 * "Show more". Your own tools come before the starter kit. Picking a tool closes the dialog.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, Library, Loader2, Ruler, Sparkles, Wrench } from 'lucide-react'
import type { StepKind, Tool } from '@core/model/types'
import { STEP_KIND_INFO, toolsForStep } from '@core/cam'
import { useProject } from '@renderer/store/project'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { ToolCard } from './ToolCard'
import { cutWidthAt, stepNeedsText, typeList } from './toolMeta'
import { measureNarrowestGap } from '@renderer/store/controller'

function Group({
  label,
  icon,
  tone,
  children
}: {
  label: string
  icon: ReactNode
  tone: 'recommended' | 'other'
  children: ReactNode
}): React.JSX.Element {
  return (
    <fieldset
      className={cn(
        'rounded-xl border px-3 pb-3 pt-1',
        tone === 'recommended' ? 'border-emerald-500/50' : 'border-slate-700'
      )}
      data-testid={`tool-group-${tone}`}
    >
      <legend
        className={cn(
          'flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider [&_svg]:size-3.5',
          tone === 'recommended' ? 'text-emerald-300' : 'text-slate-400'
        )}
      >
        {icon}
        {label}
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

/** What the picker needs to know to recommend an isolation bit that fits between the traces. */
export interface ToolFit {
  layerIds: string[]
  cutDepth: number
  ignoreGapsBelow: number
}

interface Entry {
  tool: Tool
  recommended: boolean
  best?: boolean
  reason: string
}

const fmt = (v: number): string => String(Math.round(v * 1000) / 1000)

/** Your own tools before the starter kit. */
const ownFirst = (a: Entry, b: Entry): number => Number(a.tool.builtIn) - Number(b.tool.builtIn)

/**
 * Isolation: a bit is recommended when the groove it cuts at the step's depth fits in the narrowest
 * gap between copper. The widest one that fits is the best (sturdiest, fewest passes), preferring
 * your own tools over the starter kit.
 */
function fitEntries(entries: Entry[], gap: number, depth: number): Entry[] {
  const out = entries.map((e) => {
    const w = cutWidthAt(e.tool, depth)
    const fits = w <= gap + 1e-6
    return {
      ...e,
      width: w,
      recommended: fits,
      reason: fits
        ? `Cuts ${fmt(w)} mm wide at ${fmt(depth)} mm deep: fits the narrowest ${fmt(gap)} mm gap between your traces.`
        : `Cuts ${fmt(w)} mm wide at ${fmt(depth)} mm deep: too wide for the narrowest ${fmt(gap)} mm gap, so some places would not be isolated.`
    }
  })
  const fitting = out.filter((e) => e.recommended)
  const pool = fitting.some((e) => !e.tool.builtIn) ? fitting.filter((e) => !e.tool.builtIn) : fitting
  const best = pool.reduce<(typeof out)[number] | null>((b, e) => (!b || e.width > b.width ? e : b), null)
  return out
    .map((e) => (e === best ? { ...e, best: true, reason: `Best fit. ${e.reason}` } : e))
    .sort((a, b) => Number(!!b.best) - Number(!!a.best) || ownFirst(a, b) || b.width - a.width)
}

export function ToolPickerDialog({
  open,
  onOpenChange,
  stepKind,
  selectedToolId,
  onSelect,
  onOpenLibrary,
  fit
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  stepKind: StepKind
  selectedToolId: string | null
  onSelect: (toolId: string) => void
  onOpenLibrary: () => void
  /** Isolation only: recommend by the narrowest gap between copper on these layers. */
  fit?: ToolFit
}): React.JSX.Element {
  const tools = useProject((s) => s.tools)
  const [gap, setGap] = useState<number | null | undefined>(undefined)
  const [showOthers, setShowOthers] = useState(false)
  const layerKey = fit ? fit.layerIds.join(',') : ''
  const ignoreBelow = fit?.ignoreGapsBelow ?? 0
  useEffect(() => {
    if (!open || !layerKey) return
    let live = true
    setGap(undefined)
    measureNarrowestGap(layerKey.split(','), ignoreBelow)
      .then((g) => {
        if (live) setGap(g)
      })
      .catch(() => {
        if (live) setGap(null)
      })
    return () => {
      live = false
    }
  }, [open, layerKey, ignoreBelow])
  const cutDepth = fit?.cutDepth
  const entries: Entry[] = useMemo(() => {
    const base = toolsForStep(stepKind, tools)
    if (cutDepth !== undefined && typeof gap === 'number') return fitEntries(base, gap, cutDepth)
    return [...base].sort((a, b) => Number(b.recommended) - Number(a.recommended) || ownFirst(a, b))
  }, [stepKind, tools, cutDepth, gap])
  const info = STEP_KIND_INFO[stepKind]
  const recommended = entries.filter((e) => e.recommended)
  const others = entries.filter((e) => !e.recommended)
  const othersOpen = showOthers || recommended.length === 0
  const card = (e: Entry): React.JSX.Element => (
    <ToolCard
      key={e.tool.id}
      tool={e.tool}
      active={e.tool.id === selectedToolId}
      chosen={e.tool.id === selectedToolId}
      recommended={e.recommended}
      reason={e.reason}
      className={cn(
        e.recommended && e.tool.id !== selectedToolId && 'border-emerald-500/60 bg-emerald-500/5',
        e.best && 'ring-2 ring-emerald-400/70'
      )}
      data-best={e.best || undefined}
      onClick={() => {
        onSelect(e.tool.id)
        onOpenChange(false)
      }}
    />
  )
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Choose a tool for “${info.label}”`}
      description={`${stepNeedsText(stepKind)}. Only tools that can do this step are listed.`}
      className="w-[min(94vw,760px)]"
      footer={
        <>
          <Button
            variant="secondary"
            className="mr-auto"
            onClick={() => {
              onOpenChange(false)
              onOpenLibrary()
            }}
            data-testid="tool-picker-library"
          >
            <Library /> Open the tool library…
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="tool-picker">
        {fit && (
          <div className="flex items-center gap-2 rounded-lg bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
            <Ruler className="size-4 shrink-0 text-sky-300" />
            {gap === undefined ? (
              <span className="flex items-center gap-1.5 text-slate-400">
                <Loader2 className="size-3.5 animate-spin" /> Measuring the narrowest gap between your traces…
              </span>
            ) : gap === null ? (
              <span>Your traces are at least 1 mm apart, so any of these bits fits.</span>
            ) : (
              <span data-testid="tool-picker-gap">
                The narrowest gap between your traces is <b className="text-slate-100">{fmt(gap)} mm</b>. The
                green bits cut a groove that fits in it at this step&apos;s {fmt(fit.cutDepth)} mm depth; the
                ringed one is the best fit.
              </span>
            )}
          </div>
        )}
        {recommended.length > 0 && (
          <Group label="Recommended" icon={<Sparkles />} tone="recommended">
            {recommended.map(card)}
          </Group>
        )}
        {others.length > 0 &&
          (othersOpen ? (
            <Group
              label={recommended.length ? 'Also works' : 'Compatible tools'}
              icon={<Wrench />}
              tone="other"
            >
              {others.map(card)}
            </Group>
          ) : (
            <button
              type="button"
              onClick={() => setShowOthers(true)}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-700 py-2 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
              data-testid="tool-picker-more"
            >
              <ChevronDown className="size-4" />
              Show {others.length} more tool{others.length === 1 ? '' : 's'} that also work
            </button>
          ))}
        {entries.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-700 p-4 text-center text-xs text-slate-400">
            You have no {typeList(info.allowedToolTypes)} yet. Open the tool library to create one.
          </div>
        )}
      </div>
    </Dialog>
  )
}
