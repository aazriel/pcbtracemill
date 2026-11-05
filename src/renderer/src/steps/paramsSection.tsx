/** Kind-specific parameter section of the Step editor (isolation, clearing, cutout, drilling...). */
import { Check, Minus, Settings2, X } from 'lucide-react'
import type { CutDirection, StepParams, ValidationIssue } from '@core/model/types'
import { effectiveCutWidth } from '@core/tools'
import { useProject } from '@renderer/store/project'
import { useBoardBBox, useLayersWithParsed } from '@renderer/store/controller'
import { bboxIsEmpty } from '@core/geometry'
import { Button } from '@renderer/components/ui/button'
import { FieldShell, NumberField, Segmented, Switch } from '@renderer/components/ui/fields'
import { HelpTip } from '@renderer/components/ui/help'
import { cn } from '@renderer/lib/utils'
import {
  ClearDiagram,
  CutoutDiagram,
  DirectionAnimation,
  Figure,
  IsolationDiagram,
  PeckAnimation
} from './illustrations'
import { help } from './stepUtils'
import {
  ClearMarginFigure,
  CutSideFigure,
  ExtraClearanceFigure,
  IslandFigure,
  OverlapFigure,
  TabsFigure
} from './paramFigures'
import {
  EngraveAnimation,
  HelixFigure,
  HoleMillAnimation,
  HoleRangeFigure,
  PinsAnimation,
  RetractFigure,
  SlotFigure,
  TabHeightFigure
} from './stepFigures'
import type { SectionProps } from './editorSections'

const r3 = (v: number): number => Math.round(v * 1000) / 1000

function firstIssue(issues: ValidationIssue[], re: RegExp, level: 'error' | 'warning'): string | null {
  return issues.find((i) => i.level === level && re.test(i.message))?.message ?? null
}

function setParam<K extends keyof StepParams>(
  update: SectionProps['update'],
  key: K,
  patch: Partial<StepParams[K]>
): void {
  update((d) => ({ ...d, params: { ...d.params, [key]: { ...d.params[key], ...patch } } }))
}

function DirectionField({
  value,
  onChange,
  helpKey
}: {
  value: CutDirection
  onChange: (v: CutDirection) => void
  helpKey: string
}): React.JSX.Element {
  return (
    <FieldShell
      label="Cutting direction"
      description="Which way the bit travels around the copper. Climb usually leaves cleaner edges."
      helpWide
      help={
        <>
          {help(helpKey)} {help('concept.climb')}
          <div className="mt-2">
            <Figure caption="Seen from above: the bit spins clockwise while it moves to the right.">
              <DirectionAnimation direction={value} />
            </Figure>
          </div>
        </>
      }
    >
      <div>
        <Segmented
          stretch
          value={value}
          onChange={onChange}
          options={[
            { value: 'climb', label: 'Climb' },
            { value: 'conventional', label: 'Conventional' }
          ]}
        />
      </div>
    </FieldShell>
  )
}

/** "Suggested X · use it" under a field: a sensible value with the reason, one click to apply. */
function Suggest({
  value,
  current,
  unit = '',
  why,
  onUse
}: {
  value: number
  current: number
  unit?: string
  why: string
  onUse: () => void
}): React.JSX.Element {
  const same = Math.abs(value - current) < 1e-6
  return (
    <p className="text-[11px] text-slate-500" title={why} data-testid="suggest">
      Suggested <b className="text-slate-300">{`${value}${unit}`}</b>
      {same ? (
        <span className="text-emerald-400"> ✓</span>
      ) : (
        <button type="button" className="ml-1 text-sky-400 hover:underline" onClick={onUse}>
          use it
        </button>
      )}
    </p>
  )
}

/** "How this step works (?)": the step's operation, animated, in a tooltip. */
function HowItWorks({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
      How this step works
      <HelpTip title="How this step works" wide>
        {children}
      </HelpTip>
    </div>
  )
}

/**
 * Parameter fields. The step's illustration lives in the "How this step works (?)" tooltip; `side` is
 * for content you work with (e.g. the hole-size table), shown next to the fields.
 */
function Grid({
  children,
  how,
  side,
  row
}: {
  children: React.ReactNode
  how?: React.ReactNode
  side?: React.ReactNode
  /** All fields side by side on one line. */
  row?: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {how && <HowItWorks>{how}</HowItWorks>}
      {side ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">{children}</div>
          <div className="flex flex-col gap-3">{side}</div>
        </div>
      ) : (
        <div
          className={cn(
            'grid grid-cols-1 items-start gap-y-4',
            row ? 'grid-cols-2 gap-x-3 md:grid-cols-4' : 'gap-x-6 lg:grid-cols-2'
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────── hole sizes

interface HoleSize {
  diameter: number
  holes: number
  slots: number
}

function useHoleSizes(layerIds: string[]): HoleSize[] {
  const layers = useLayersWithParsed()
  const map = new Map<number, HoleSize>()
  for (const l of layers) {
    if (!layerIds.includes(l.id) || !l.parsed?.drills) continue
    const add = (d: number, slot: boolean): void => {
      const k = r3(d)
      const e = map.get(k) ?? { diameter: k, holes: 0, slots: 0 }
      if (slot) e.slots++
      else e.holes++
      map.set(k, e)
    }
    for (const h of l.parsed.drills.holes) add(h.diameter, false)
    for (const s of l.parsed.drills.slots) add(s.diameter, true)
  }
  return [...map.values()].sort((a, b) => a.diameter - b.diameter)
}

function HoleTable({
  sizes,
  min,
  max,
  includeSlots,
  toolDiameter,
  mode
}: {
  sizes: HoleSize[]
  min: number
  max: number
  includeSlots: boolean
  toolDiameter: number | null
  mode: 'drill' | 'mill'
}): React.JSX.Element {
  if (!sizes.length)
    return <p className="text-[11px] text-slate-500">No holes found in the selected layers.</p>
  return (
    <div className="overflow-hidden rounded-lg border border-slate-800" data-testid="hole-table">
      <table className="w-full text-[11px]">
        <thead className="bg-slate-900 text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-2 py-1 text-left">Hole size</th>
            <th className="px-2 py-1 text-right">Count</th>
            <th className="px-2 py-1 text-center">In this step</th>
            {toolDiameter !== null && (
              <th className="px-2 py-1 text-left">{mode === 'drill' ? 'With this drill' : 'Tool fits'}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {sizes.map((s) => {
            const inRange = s.diameter >= min - 1e-9 && s.diameter <= max + 1e-9
            const count = s.holes + (includeSlots ? s.slots : 0)
            const used = inRange && count > 0
            let note: React.ReactNode = null
            if (toolDiameter !== null && used) {
              if (mode === 'mill')
                note =
                  toolDiameter < s.diameter ? (
                    <span className="text-emerald-400">yes</span>
                  ) : (
                    <span className="text-rose-400">too big</span>
                  )
              else {
                const diff = toolDiameter - s.diameter
                note =
                  diff > 0.15 ? (
                    <span className="text-amber-400">enlarged by {r3(diff)} mm</span>
                  ) : diff < -0.2 ? (
                    <span className="text-amber-400">too small by {r3(-diff)} mm</span>
                  ) : (
                    <span className="text-emerald-400">good fit</span>
                  )
              }
            }
            return (
              <tr key={s.diameter} className={cn('border-t border-slate-800', !used && 'text-slate-600')}>
                <td className="px-2 py-1 font-mono">Ø {s.diameter} mm</td>
                <td className="px-2 py-1 text-right font-mono">
                  {s.holes}
                  {s.slots ? ` + ${s.slots} slot${s.slots > 1 ? 's' : ''}` : ''}
                </td>
                <td className="px-2 py-1">
                  <span className="flex justify-center">
                    {used ? (
                      <Check className="size-3.5 text-emerald-400" />
                    ) : inRange ? (
                      <Minus className="size-3.5" />
                    ) : (
                      <X className="size-3.5" />
                    )}
                  </span>
                </td>
                {toolDiameter !== null && <td className="px-2 py-1">{note}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ───────────────────────────────────────── per kind

export function ParamsSection({
  draft,
  update,
  issues,
  onEditMaterial
}: SectionProps & { onEditMaterial: () => void }): React.JSX.Element {
  const tools = useProject((s) => s.tools)
  const material = useProject((s) => s.material)
  const tool = tools.find((t) => t.id === draft.toolId)
  const holeSizes = useHoleSizes(draft.layerIds)
  const boardBox = useBoardBBox()
  const p = draft.params
  const err = (re: RegExp): string | null => firstIssue(issues, re, 'error')
  /** (?) content: the explanation plus the illustration of that setting. */
  const fig = (text: React.ReactNode, node: React.ReactNode): { help: React.ReactNode; helpWide: true } => ({
    help: (
      <>
        {text}
        <div className="mt-2">{node}</div>
      </>
    ),
    helpWide: true
  })
  const warn = (re: RegExp): string | null => firstIssue(issues, re, 'warning')

  switch (draft.kind) {
    case 'isolate': {
      const ip = p.isolation
      const width = tool ? effectiveCutWidth(tool, draft.cutDepth) : 0.2
      const isoFig = (
        <Figure caption="Top view of one pad: each dashed line is one pass of the bit.">
          <IsolationDiagram
            passes={ip.passes}
            overlap={ip.overlap}
            cutWidth={width}
            extraClearance={ip.extraClearance}
            direction={ip.direction}
          />
        </Figure>
      )
      return (
        <Grid
          row
          how={
            <>
              <Figure caption="Top view of one pad: each dashed line is one pass of the bit, dark bands are where copper is removed. Updates as you change the values.">
                <IsolationDiagram
                  passes={ip.passes}
                  overlap={ip.overlap}
                  cutWidth={width}
                  extraClearance={ip.extraClearance}
                  direction={ip.direction}
                />
              </Figure>
            </>
          }
        >
          <NumberField
            label="Passes"
            min={1}
            max={20}
            step={1}
            value={ip.passes}
            onChange={(v) => setParam(update, 'isolation', { passes: Math.round(v) })}
            description="How many grooves are cut next to each other around every trace."
            {...fig(help('isolation.passes'), isoFig)}
            error={err(/passes/i)}
            warning={warn(/passes/i)}
          />
          <NumberField
            label="Overlap"
            unit="%"
            min={0}
            max={90}
            step={5}
            value={Math.round(ip.overlap * 100)}
            onChange={(v) => setParam(update, 'isolation', { overlap: v / 100 })}
            description="How much each pass covers the previous one; about 40% avoids thin copper slivers."
            {...fig(
              `${help('isolation.overlap')} ${help('concept.overlap')}`,
              <OverlapFigure overlap={ip.overlap} />
            )}
            error={err(/overlap/i)}
          />
          <NumberField
            label="Extra clearance"
            unit="mm"
            min={0}
            step={0.05}
            value={ip.extraClearance}
            onChange={(v) => setParam(update, 'isolation', { extraClearance: v })}
            description="Moves the first pass further away from the copper, leaving a wider gap."
            {...fig(help('isolation.extraClearance'), <ExtraClearanceFigure extra={ip.extraClearance} />)}
            error={err(/clearance/i)}
          />
          <DirectionField
            value={ip.direction}
            onChange={(v) => setParam(update, 'isolation', { direction: v })}
            helpKey="isolation.direction"
          />
        </Grid>
      )
    }
    case 'clear': {
      const cp = p.clear
      return (
        <Grid
          row
          how={
            <Figure caption="Side by side passes remove the copper between traces. Tiny copper islands smaller than the limit are not worth chasing and are skipped.">
              <ClearDiagram
                overlap={cp.overlap}
                clearMargin={cp.clearMargin}
                minIslandArea={cp.minIslandArea}
              />
            </Figure>
          }
        >
          <NumberField
            label="Overlap"
            unit="%"
            min={0}
            max={90}
            step={5}
            value={Math.round(cp.overlap * 100)}
            onChange={(v) => setParam(update, 'clear', { overlap: v / 100 })}
            description="How much each pass covers the previous one, so no thin strips are left behind."
            {...fig(
              `${help('clear.overlap')} ${help('concept.overlap')}`,
              <OverlapFigure overlap={cp.overlap} passes={4} />
            )}
            error={err(/overlap/i)}
          />
          <NumberField
            label="Skip islands under"
            unit="mm²"
            min={0}
            step={0.05}
            value={cp.minIslandArea}
            onChange={(v) => setParam(update, 'clear', { minIslandArea: v })}
            description="Tiny bits of copper the bit cannot reach well are skipped instead of reported as a problem."
            {...fig(help('clear.minIslandArea'), <IslandFigure minArea={cp.minIslandArea} />)}
            error={err(/island/i)}
          />
          <NumberField
            label="Clear margin"
            unit="mm"
            min={0}
            step={0.5}
            value={cp.clearMargin}
            onChange={(v) => setParam(update, 'clear', { clearMargin: v })}
            description="0 clears all copper. A value clears only a band of this width along the traces (much faster)."
            {...fig(help('clear.clearMargin'), <ClearMarginFigure margin={cp.clearMargin} />)}
            error={err(/margin/i)}
          />
          <DirectionField
            value={cp.direction}
            onChange={(v) => setParam(update, 'clear', { direction: v })}
            helpKey="clear.direction"
          />
        </Grid>
      )
    }
    case 'cutout': {
      const c = p.cutout
      const perimeter = bboxIsEmpty(boardBox)
        ? 0
        : 2 * (boardBox.maxX - boardBox.minX + boardBox.maxY - boardBox.minY)
      const tabsSuggested = Math.max(2, Math.min(8, Math.round(perimeter / 40)))
      const widthSuggested = Math.max(2, Math.round((tool?.geometry.diameter ?? 1.5) * 2 * 2) / 2)
      const heightSuggested = Math.round((material?.thickness ?? 1.6) * 0.3 * 10) / 10
      return (
        <Grid
          row
          how={
            <Figure caption="The bit follows the dashed line all the way around; the yellow tabs stay uncut so the board stays attached until you snap it free.">
              <CutoutDiagram
                tabs={c.tabs}
                tabWidth={c.tabWidth}
                outside={c.outside}
                toolDiameter={tool?.geometry.diameter ?? 1.5}
              />
            </Figure>
          }
        >
          <FieldShell
            label="Cut side"
            description="Outside keeps the board at its exact designed size; inside makes it slightly smaller."
            {...fig(help('cutout.outside'), <CutSideFigure outside={c.outside} />)}
          >
            <div>
              <Segmented
                stretch
                value={c.outside ? 'outside' : 'inside'}
                onChange={(v) => setParam(update, 'cutout', { outside: v === 'outside' })}
                options={[
                  { value: 'outside', label: 'Outside' },
                  { value: 'inside', label: 'Inside' }
                ]}
              />
            </div>
          </FieldShell>
          <div className="flex flex-col gap-1">
            <NumberField
              label="Tabs"
              min={0}
              max={20}
              step={1}
              value={c.tabs}
              onChange={(v) => setParam(update, 'cutout', { tabs: Math.round(v) })}
              description="Small uncut bridges that hold the board in the sheet. 2–4 is typical."
              {...fig(`${help('cutout.tabs')} ${help('concept.tabs')}`, <TabsFigure tabs={c.tabs} />)}
              error={err(/number of tabs/i)}
              warning={warn(/without tabs/i)}
            />
            <Suggest
              value={tabsSuggested}
              current={c.tabs}
              why={`About one tab per 40 mm of outline (this board's outline is about ${Math.round(perimeter)} mm).`}
              onUse={() => setParam(update, 'cutout', { tabs: tabsSuggested })}
            />
          </div>
          {c.tabs > 0 && (
            <>
              <div className="flex flex-col gap-1">
                <NumberField
                  label="Tab width"
                  unit="mm"
                  min={0}
                  step={0.5}
                  value={c.tabWidth}
                  onChange={(v) => setParam(update, 'cutout', { tabWidth: v })}
                  description="Length of each bridge along the outline."
                  {...fig(
                    help('cutout.tabWidth'),
                    <TabHeightFigure
                      measure="width"
                      tabWidth={c.tabWidth}
                      tabHeight={c.tabHeight}
                      thickness={material?.thickness ?? 1.6}
                    />
                  )}
                  error={err(/tab width/i)}
                  warning={warn(/narrower/i)}
                />
                <Suggest
                  value={widthSuggested}
                  current={c.tabWidth}
                  unit=" mm"
                  why="About twice the bit diameter (at least 2 mm): strong enough to hold, easy to snap."
                  onUse={() => setParam(update, 'cutout', { tabWidth: widthSuggested })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <NumberField
                  label="Tab height"
                  unit="mm"
                  min={0}
                  step={0.1}
                  value={c.tabHeight}
                  onChange={(v) => setParam(update, 'cutout', { tabHeight: v })}
                  description={`How much material is left standing in each tab (board is ${material?.thickness ?? '?'} mm thick).`}
                  {...fig(
                    help('cutout.tabHeight'),
                    <TabHeightFigure tabHeight={c.tabHeight} thickness={material?.thickness ?? 1.6} />
                  )}
                  error={err(/tab height/i)}
                  warning={warn(/tab height/i)}
                />
                <Suggest
                  value={heightSuggested}
                  current={c.tabHeight}
                  unit=" mm"
                  why="About a third of the board thickness: holds the board, still breaks off cleanly."
                  onUse={() => setParam(update, 'cutout', { tabHeight: heightSuggested })}
                />
              </div>
            </>
          )}
        </Grid>
      )
    }
    case 'drill': {
      const d = p.drill
      return (
        <Grid
          how={
            <Figure caption="Pecking lifts the drill out every few tenths of a millimetre to clear chips; useful for small drills.">
              <PeckAnimation peck={d.peck} depth={draft.cutDepth} thickness={material?.thickness ?? 1.6} />
            </Figure>
          }
          side={
            <>
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-300">
                Hole sizes in the selected layers
                {tool && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setParam(update, 'drill', {
                        minDiameter: r3(Math.max(0, tool.geometry.diameter - 0.1)),
                        maxDiameter: r3(tool.geometry.diameter + 0.1)
                      })
                    }
                    title="Limit this step to the holes this drill makes well (its size ± 0.1 mm)"
                  >
                    Only holes ≈ Ø {tool.geometry.diameter} mm
                  </Button>
                )}
              </div>
              <HoleTable
                sizes={holeSizes}
                min={d.minDiameter}
                max={d.maxDiameter}
                includeSlots={d.includeSlots}
                toolDiameter={tool?.geometry.diameter ?? null}
                mode="drill"
              />
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Smallest hole"
              unit="mm"
              min={0}
              step={0.05}
              value={d.minDiameter}
              onChange={(v) => setParam(update, 'drill', { minDiameter: v })}
              description="Holes smaller than this are skipped."
              {...fig(
                help('drill.minDiameter'),
                <HoleRangeFigure min={d.minDiameter} max={d.maxDiameter} mode="drill" />
              )}
              error={err(/minimum hole/i)}
            />
            <NumberField
              label="Largest hole"
              unit="mm"
              min={0}
              step={0.05}
              value={d.maxDiameter}
              onChange={(v) => setParam(update, 'drill', { maxDiameter: v })}
              description="Holes bigger than this are skipped."
              {...fig(
                help('drill.maxDiameter'),
                <HoleRangeFigure min={d.minDiameter} max={d.maxDiameter} mode="drill" />
              )}
              error={err(/maximum hole/i)}
            />
          </div>
          <NumberField
            label="Peck depth"
            unit="mm"
            min={0}
            step={0.1}
            value={d.peck}
            onChange={(v) => setParam(update, 'drill', { peck: v })}
            description="0 drills each hole in one go. A value lifts the drill out after each chunk of this depth."
            {...fig(
              help('drill.peck'),
              <Figure>
                <PeckAnimation peck={d.peck} depth={draft.cutDepth} thickness={material?.thickness ?? 1.6} />
              </Figure>
            )}
            error={err(/peck/i)}
          />
          <NumberField
            label="Retract height"
            unit="mm"
            min={0}
            step={0.5}
            value={d.retract}
            onChange={(v) => setParam(update, 'drill', { retract: v })}
            description="How high above the board the drill lifts between holes."
            {...fig(help('drill.retract'), <RetractFigure retract={d.retract} />)}
            error={err(/retract/i)}
          />
          <Switch
            label="Also drill slots"
            checked={d.includeSlots}
            onChange={(v) => setParam(update, 'drill', { includeSlots: v })}
            description="Slots (oval holes) are drilled as a row of holes."
            {...fig(help('drill.includeSlots'), <SlotFigure on={d.includeSlots} />)}
          />
        </Grid>
      )
    }
    case 'holeMill': {
      const h = p.holeMill
      return (
        <Grid
          how={<HoleMillAnimation />}
          side={
            <>
              <div className="text-[11px] font-medium text-slate-300">Hole sizes in the selected layers</div>
              <HoleTable
                sizes={holeSizes}
                min={h.minDiameter}
                max={h.maxDiameter}
                includeSlots
                toolDiameter={tool?.geometry.diameter ?? null}
                mode="mill"
              />
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Smallest hole"
              unit="mm"
              min={0}
              step={0.05}
              value={h.minDiameter}
              onChange={(v) => setParam(update, 'holeMill', { minDiameter: v })}
              description="Only holes at least this big are milled; smaller ones are left for a drill step."
              {...fig(
                help('holeMill.minDiameter'),
                <HoleRangeFigure min={h.minDiameter} max={h.maxDiameter} mode="mill" />
              )}
              error={err(/minimum hole/i)}
            />
            <NumberField
              label="Largest hole"
              unit="mm"
              min={0}
              step={0.05}
              value={h.maxDiameter}
              onChange={(v) => setParam(update, 'holeMill', { maxDiameter: v })}
              description="Holes bigger than this are skipped."
              {...fig(
                help('holeMill.maxDiameter'),
                <HoleRangeFigure min={h.minDiameter} max={h.maxDiameter} mode="mill" />
              )}
              error={err(/maximum hole/i)}
            />
          </div>
          <Switch
            label="Spiral down (helical)"
            checked={h.helical}
            onChange={(v) => setParam(update, 'holeMill', { helical: v })}
            description="The bit spirals gently into the hole instead of plunging straight down."
            {...fig(help('holeMill.helical'), <HelixFigure helical={h.helical} />)}
          />
        </Grid>
      )
    }
    case 'engrave':
      return (
        <div className="flex flex-col gap-2 text-xs leading-relaxed text-slate-300">
          <HowItWorks>
            <EngraveAnimation />
          </HowItWorks>
          <p>
            The bit follows the centre of every line in the selected artwork (text, component outlines, logos)
            at the cut depth set in <b>General</b>. Filled shapes are traced around their edge.
          </p>
          <p className="text-slate-400">
            Tip: engraving cuts through copper just like isolation does. Put this step on a side where the
            artwork does not overlap your traces, or after a <b>Clear copper</b> step. You will get a warning
            in <b>Results</b> if the engraving would cross copper.
          </p>
        </div>
      )
    case 'alignment': {
      const a = material?.alignment
      return (
        <div className="flex flex-col gap-3">
          <HowItWorks>
            <PinsAnimation />
          </HowItWorks>
          <p className="text-xs leading-relaxed text-slate-300">
            {help('concept.alignment')} The holes are placed using the alignment settings of the{' '}
            <b>material</b>:
          </p>
          {a && material && (
            <div className="grid grid-cols-2 gap-2 text-[11.5px] sm:grid-cols-4">
              {[
                ['Double-sided', material.doubleSided && a.enabled ? 'on' : 'off'],
                ['Pin diameter', `${a.pinDiameter} mm`],
                ['Pins along', a.axis === 'x' ? 'X (left / right)' : 'Y (front / back)'],
                ['Distance from board', `${a.margin} mm`]
              ].map(([k, v]) => (
                <div key={k} className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
                  <div className="text-slate-100">{v}</div>
                </div>
              ))}
            </div>
          )}
          <div>
            <Button size="sm" variant="secondary" onClick={onEditMaterial}>
              <Settings2 /> Save step &amp; edit material settings
            </Button>
          </div>
        </div>
      )
    }
  }
}
