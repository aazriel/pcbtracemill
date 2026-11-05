import type { ReactNode } from 'react'
import { Gauge, NotebookPen, Ruler, Tag } from 'lucide-react'
import type { StepKind, Tool, ToolType } from '@core/model/types'
import { TOOL_FIELD_HELP, TOOL_TYPE_INFO, createTool, type ToolFieldKey } from '@core/tools'
import { defaultCutDepth } from '@core/cam'
import { NumberField, SelectField, TextField } from '@renderer/components/ui/fields'
import { Button } from '@renderer/components/ui/button'
import { HelpTip } from '@renderer/components/ui/help'
import { cn } from '@renderer/lib/utils'
import { ToolPreview } from './ToolPreview'
import { CutDepthDiagram } from './ToolDiagrams'
import { toolFigure } from './toolFigures'
import { changeToolType, cutWidthAt, fmtMm, TOOL_TYPES } from './toolMeta'

/** Maps validateTool() messages onto the field they belong to. */
export function fieldErrors(errors: string[]): Partial<Record<ToolFieldKey, string>> {
  const out: Partial<Record<ToolFieldKey, string>> = {}
  const rules: [RegExp, ToolFieldKey][] = [
    [/needs a name/i, 'name'],
    [/tool number/i, 'number'],
    [/^diameter/i, 'geometry.diameter'],
    [/cutting length/i, 'geometry.fluteLength'],
    [/flutes/i, 'geometry.flutes'],
    [/tip angle/i, 'geometry.tipAngle'],
    [/tip width/i, 'geometry.tipDiameter'],
    [/point angle/i, 'geometry.pointAngle'],
    [/spindle/i, 'feeds.spindleRpm'],
    [/cutting feed/i, 'feeds.feedXY'],
    [/plunge/i, 'feeds.feedZ'],
    [/depth per pass/i, 'feeds.stepDown'],
    [/tool type/i, 'type']
  ]
  for (const e of errors) {
    const hit = rules.find(([re]) => re.test(e))
    if (hit && !out[hit[1]]) out[hit[1]] = e
  }
  return out
}

/** Field props from TOOL_FIELD_HELP: label, unit, and the (?) text plus the field's illustration. */
function fieldProps(
  key: ToolFieldKey,
  tool: Tool
): { label: string; description: string; help?: ReactNode; helpWide?: boolean; unit?: string } {
  const h = TOOL_FIELD_HELP[key]
  const figure = toolFigure(key, tool)
  return {
    label: h.label,
    description: h.description,
    unit: h.unit,
    ...(figure
      ? {
          help: (
            <>
              {h.description}
              <div className="mt-2">{figure}</div>
            </>
          ),
          helpWide: true
        }
      : {})
  }
}

/** Typical V-bit cone length for a given shank, tip and angle. */
function coneLength(t: Tool): number {
  const g = t.geometry
  const half = ((g.tipAngle ?? 30) * Math.PI) / 360
  return Math.round(((g.diameter - (g.tipDiameter ?? 0)) / 2 / Math.tan(half)) * 100) / 100
}

/** One block of the tool form; its explanation and illustration live in the (?) next to the title. */
function Section({
  icon,
  title,
  help,
  children
}: {
  icon: ReactNode
  title: string
  help?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <header className="mb-2.5 flex items-center gap-2">
        <span className="text-sky-400 [&_svg]:size-4">{icon}</span>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">{title}</h3>
        {help && (
          <HelpTip title={title} wide>
            {help}
          </HelpTip>
        )}
      </header>
      {children}
    </section>
  )
}

export interface ToolEditorProps {
  draft: Tool
  onChange: (t: Tool) => void
  readOnly: boolean
  errors: string[]
  /** Other tools (for duplicate tool number warnings). */
  otherTools: Tool[]
  /** Cut depth shown in the Geometry illustration for V-bits and ball end mills. */
  previewDepth: number
  stepKind?: StepKind | null
}

/** Editable form + live animated preview of one tool. */
export function ToolEditor({
  draft,
  onChange,
  readOnly,
  errors,
  otherTools,
  previewDepth,
  stepKind
}: ToolEditorProps): React.JSX.Element {
  const g = draft.geometry
  const f = draft.feeds
  const fe = fieldErrors(errors)
  const fh = (key: ToolFieldKey): ReturnType<typeof fieldProps> => fieldProps(key, draft)
  const info = TOOL_TYPE_INFO[draft.type]
  const setGeo = (patch: Partial<Tool['geometry']>): void =>
    onChange({ ...draft, geometry: { ...g, ...patch } })
  const setFeeds = (patch: Partial<Tool['feeds']>): void => onChange({ ...draft, feeds: { ...f, ...patch } })
  const numberClash = otherTools.find((t) => t.id !== draft.id && t.number === draft.number)
  const chipLoad = f.spindleRpm > 0 && g.flutes > 0 ? f.feedXY / (f.spindleRpm * g.flutes) : 0
  const depthMatters = draft.type === 'vbit' || draft.type === 'ball'
  const cone = draft.type === 'vbit' ? coneLength(draft) : 0
  const stepDepthHint =
    stepKind === 'isolate' || stepKind === 'clear'
      ? defaultCutDepth(stepKind, { thickness: 1.6, copperThickness: 0.035 })
      : null
  const typicalDepth = stepDepthHint ?? (draft.type === 'vbit' ? 0.1 : Math.min(g.diameter / 4, 0.3))
  // depth shown in the Geometry illustration
  const diagramDepth = depthMatters
    ? previewDepth
    : draft.type === 'drill'
      ? 1.7
      : Math.max(0.1, Math.min(g.fluteLength, 0.4))

  return (
    <div className="flex flex-col gap-3">
      {/* Live preview */}
      <div className="flex items-center gap-4 rounded-lg border border-slate-800 bg-gradient-to-b from-slate-950 to-slate-900 p-3">
        <div className="shrink-0 rounded-md bg-slate-950/70" data-testid="tool-preview">
          <ToolPreview tool={draft} width={230} height={290} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-base font-semibold text-slate-100">
              {draft.name || info.label}
            </span>
            <HelpTip title={info.label}>
              {info.description}
              <div className="mt-1.5">
                <span className="font-medium text-slate-100">Used for: </span>
                {info.usedFor}
              </div>
            </HelpTip>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['Kind', info.label],
              [
                draft.type === 'drill' ? 'Hole size' : 'Cut width',
                depthMatters
                  ? `${fmtMm(cutWidthAt(draft, typicalDepth))} mm at ${fmtMm(typicalDepth)} mm deep`
                  : `${fmtMm(g.diameter)} mm`
              ],
              ['Spindle', `${Math.round(f.spindleRpm).toLocaleString('en-US')} RPM`],
              ['Cutting feed', `${f.feedXY} mm/min`]
            ].map(([k, v]) => (
              <div key={k} className="rounded-md border border-slate-800 bg-slate-950/50 px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
                <div className="truncate text-xs text-slate-100">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {readOnly && (
        <div className="rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs text-slate-300">
          This is a <b>starter-kit</b> tool, so it cannot be changed. Press <b>Duplicate to customise</b> to
          make your own editable copy (for example, to enter the exact numbers printed on your bit&apos;s
          package).
        </div>
      )}

      <fieldset disabled={readOnly} className="flex flex-col gap-3">
        <Section
          icon={<Tag />}
          title="Name & kind"
          help={
            <>
              The name you will recognise it by, what kind of cutter it is, and its number (T1, T2…) in the
              G-code.
              <div className="mt-2 flex items-end justify-between gap-1 rounded-md bg-slate-950/70 p-2">
                {TOOL_TYPES.map((t) => (
                  <div
                    key={t}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded px-1 pb-1 text-[10px]',
                      t === draft.type
                        ? 'bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/50'
                        : 'text-slate-500'
                    )}
                  >
                    <ToolPreview
                      tool={createTool(t)}
                      width={36}
                      height={72}
                      compact
                      spinning={t === draft.type}
                    />
                    {TOOL_TYPE_INFO[t].label.split(' ')[0]}
                  </div>
                ))}
              </div>
            </>
          }
        >
          <div className="grid grid-cols-[1fr_1fr_110px] gap-3">
            <TextField
              {...fh('name')}
              value={draft.name}
              onChange={(name) => onChange({ ...draft, name })}
              error={fe.name}
              placeholder="e.g. V-bit 30° 0.1 mm"
            />
            <SelectField<ToolType>
              {...fh('type')}
              value={draft.type}
              onChange={(type) => onChange(changeToolType(draft, type))}
              options={TOOL_TYPES.map((t) => ({ value: t, label: TOOL_TYPE_INFO[t].label }))}
              error={fe.type}
            />
            <NumberField
              {...fh('number')}
              description="Written as T1, T2… in the G-code."
              value={draft.number}
              onChange={(number) => onChange({ ...draft, number: Math.round(number) })}
              min={0}
              step={1}
              error={fe.number}
              warning={numberClash ? `"${numberClash.name}" also uses T${draft.number}.` : null}
            />
          </div>
        </Section>

        <Section
          icon={<Ruler />}
          title="Geometry"
          help={
            <>
              The shape and size of the cutter. Watch the big drawing change as you type.{' '}
              {depthMatters
                ? `${draft.type === 'vbit' ? 'A V-bit' : 'A ball end mill'} cuts wider the deeper it goes.`
                : draft.type === 'drill'
                  ? `This drill makes round holes exactly ${fmtMm(g.diameter)} mm wide; it only moves straight down and back up.`
                  : `This cutter makes a groove exactly ${fmtMm(g.diameter)} mm wide at any depth.`}
              {stepDepthHint !== null && ` This step normally cuts about ${stepDepthHint} mm deep.`}
              <div className="mt-2 overflow-hidden rounded-md bg-slate-950/70">
                <CutDepthDiagram tool={draft} depth={diagramDepth} width={340} height={150} animate />
              </div>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              {...fh('geometry.diameter')}
              description={
                draft.type === 'vbit'
                  ? 'For a V-bit: the width of the round shank that goes into the spindle.'
                  : 'The width of the cutter — this is how wide it cuts.'
              }
              value={g.diameter}
              onChange={(diameter) => setGeo({ diameter })}
              min={0}
              step={draft.type === 'vbit' ? 0.025 : 0.05}
              error={fe['geometry.diameter']}
            />
            {draft.type === 'vbit' && (
              <>
                <NumberField
                  {...fh('geometry.tipAngle')}
                  value={g.tipAngle ?? 30}
                  onChange={(tipAngle) => setGeo({ tipAngle })}
                  min={0}
                  step={5}
                  error={fe['geometry.tipAngle']}
                />
                <NumberField
                  {...fh('geometry.tipDiameter')}
                  value={g.tipDiameter ?? 0}
                  onChange={(tipDiameter) => setGeo({ tipDiameter })}
                  min={0}
                  step={0.05}
                  error={fe['geometry.tipDiameter']}
                />
              </>
            )}
            {draft.type === 'drill' && (
              <NumberField
                {...fh('geometry.pointAngle')}
                value={g.pointAngle ?? 118}
                onChange={(pointAngle) => setGeo({ pointAngle })}
                min={0}
                step={1}
                error={fe['geometry.pointAngle']}
              />
            )}
            <NumberField
              {...fh('geometry.fluteLength')}
              value={g.fluteLength}
              onChange={(fluteLength) => setGeo({ fluteLength })}
              min={0}
              step={0.5}
              error={fe['geometry.fluteLength']}
              warning={
                draft.type === 'vbit' && cone > 0 && Math.abs(cone - g.fluteLength) > 0.05
                  ? `For these numbers the pointed part is about ${cone} mm long.`
                  : null
              }
            />
            <NumberField
              {...fh('geometry.flutes')}
              value={g.flutes}
              onChange={(flutes) => setGeo({ flutes: Math.round(flutes) })}
              min={1}
              step={1}
              error={fe['geometry.flutes']}
            />
          </div>
          {!readOnly && draft.type === 'vbit' && cone > 0 && Math.abs(cone - g.fluteLength) > 0.05 && (
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => setGeo({ fluteLength: cone })}>
              Use {cone} mm as cutting length
            </Button>
          )}
        </Section>

        <Section
          icon={<Gauge />}
          title="Feeds & speeds"
          help={
            <>
              How fast the bit spins and how fast it moves through the material. Each cutting edge takes a
              small bite every turn: feed ÷ (speed × flutes). For tiny PCB bits a few micrometres is normal;
              much more risks breaking the bit.
              <div className="mt-2 flex items-center gap-3 rounded-md bg-slate-950/70 p-2">
                <ToolPreview tool={draft} width={70} height={110} compact />
                <span className="text-[11px] text-slate-400">
                  Spinning at {Math.round(f.spindleRpm).toLocaleString('en-US')} RPM (slowed down so you can
                  see it), moving at {f.feedXY} mm/min.
                </span>
              </div>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              {...fh('feeds.spindleRpm')}
              value={f.spindleRpm}
              onChange={(spindleRpm) => setFeeds({ spindleRpm })}
              min={0}
              step={500}
              error={fe['feeds.spindleRpm']}
            />
            <NumberField
              {...fh('feeds.feedXY')}
              value={f.feedXY}
              onChange={(feedXY) => setFeeds({ feedXY })}
              min={0}
              step={10}
              error={fe['feeds.feedXY']}
            />
            <NumberField
              {...fh('feeds.feedZ')}
              value={f.feedZ}
              onChange={(feedZ) => setFeeds({ feedZ })}
              min={0}
              step={10}
              error={fe['feeds.feedZ']}
              warning={
                f.feedZ > f.feedXY && draft.type !== 'drill'
                  ? 'Plunging is usually slower than cutting sideways.'
                  : null
              }
            />
            <NumberField
              {...fh('feeds.stepDown')}
              description={
                draft.type === 'drill'
                  ? 'For drills: how deep each "peck" goes before pulling out to clear chips.'
                  : 'The deepest the bit cuts in one go; deeper cuts are split into passes.'
              }
              value={f.stepDown}
              onChange={(stepDown) => setFeeds({ stepDown })}
              min={0}
              step={0.05}
              error={fe['feeds.stepDown']}
            />
          </div>
          {chipLoad > 0 && (
            <p className="mt-2 text-[11px] text-slate-400">
              Chip load: <b className="text-slate-200">{(chipLoad * 1000).toFixed(1)} µm</b> per cutting edge
            </p>
          )}
        </Section>

        <Section icon={<NotebookPen />} title="Notes">
          <TextField
            {...fh('notes')}
            multiline
            value={draft.notes}
            onChange={(notes) => onChange({ ...draft, notes })}
            placeholder="Where you bought it, how worn it is, what worked well…"
          />
        </Section>
      </fieldset>
    </div>
  )
}
