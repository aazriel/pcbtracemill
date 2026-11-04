import type { ReactNode } from 'react'
import { Gauge, NotebookPen, Ruler, Tag } from 'lucide-react'
import type { StepKind, Tool, ToolType } from '@core/model/types'
import { TOOL_FIELD_HELP, TOOL_TYPE_INFO, type ToolFieldKey } from '@core/tools'
import { defaultCutDepth } from '@core/cam'
import { NumberField, SelectField, TextField } from '@renderer/components/ui/fields'
import { Button } from '@renderer/components/ui/button'
import { ToolPreview } from './ToolPreview'
import { CutDepthDiagram, StepoverDiagram } from './ToolDiagrams'
import { changeToolType, fmtMm, TOOL_TYPES } from './toolMeta'

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
    [/stepover/i, 'feeds.stepOver'],
    [/tool type/i, 'type']
  ]
  for (const e of errors) {
    const hit = rules.find(([re]) => re.test(e))
    if (hit && !out[hit[1]]) out[hit[1]] = e
  }
  return out
}

/** label/description/help/unit props for a field, straight from TOOL_FIELD_HELP. */
function fh(key: ToolFieldKey): { label: string; description: string; help: string; unit?: string } {
  const h = TOOL_FIELD_HELP[key]
  const firstSentence = h.description.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? h.description
  return { label: h.label, description: firstSentence, help: h.description, unit: h.unit }
}

/** Typical V-bit cone length for a given shank, tip and angle. */
function coneLength(t: Tool): number {
  const g = t.geometry
  const half = ((g.tipAngle ?? 30) * Math.PI) / 360
  return Math.round(((g.diameter - (g.tipDiameter ?? 0)) / 2 / Math.tan(half)) * 100) / 100
}

function Section({
  icon,
  title,
  hint,
  children
}: {
  icon: ReactNode
  title: string
  hint?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <header className="mb-2.5 flex items-center gap-2">
        <span className="text-sky-400 [&_svg]:size-4">{icon}</span>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">{title}</h3>
        {hint && <span className="ml-auto text-[11px] text-slate-500">{hint}</span>}
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
  previewDepth: number
  onPreviewDepthChange: (d: number) => void
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
  onPreviewDepthChange,
  stepKind
}: ToolEditorProps): React.JSX.Element {
  const g = draft.geometry
  const f = draft.feeds
  const fe = fieldErrors(errors)
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

  return (
    <div className="flex flex-col gap-3">
      {/* Live preview */}
      <div className="flex gap-4 rounded-lg border border-slate-800 bg-gradient-to-b from-slate-950 to-slate-900 p-3">
        <div className="shrink-0 rounded-md bg-slate-950/70" data-testid="tool-preview">
          <ToolPreview tool={draft} width={230} height={290} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-100">{info.label}</div>
            <p className="mt-0.5 text-xs leading-snug text-slate-400">{info.description}</p>
            <p className="mt-1.5 text-xs leading-snug text-slate-500">
              <span className="font-medium text-slate-400">Used for: </span>
              {info.usedFor}
            </p>
          </div>
          {depthMatters ? (
            <div className="mt-auto flex flex-col gap-1.5">
              <div className="rounded-md bg-slate-950/70">
                <CutDepthDiagram tool={draft} depth={previewDepth} width={400} height={150} />
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="shrink-0">Try a depth:</span>
                <input
                  type="range"
                  min={0.02}
                  max={draft.type === 'vbit' ? 0.5 : Math.max(0.1, Math.min(2, g.diameter / 2))}
                  step={0.01}
                  value={previewDepth}
                  aria-label="Preview cut depth"
                  onChange={(e) => onPreviewDepthChange(Number(e.target.value))}
                  className="h-1 flex-1 accent-sky-500"
                />
                <span className="w-16 text-right tabular-nums text-slate-300">
                  {previewDepth.toFixed(2)} mm
                </span>
              </div>
              <p className="text-[11px] leading-snug text-slate-500">
                {draft.type === 'vbit' ? 'A V-bit' : 'A ball end mill'} cuts wider the deeper it goes.
                {stepDepthHint !== null && ` This step normally cuts about ${stepDepthHint} mm deep.`}
              </p>
            </div>
          ) : (
            <p className="mt-auto rounded-md border border-slate-800 bg-slate-950/50 p-2 text-[11px] leading-snug text-slate-400">
              {draft.type === 'drill'
                ? `This drill makes round holes exactly ${fmtMm(g.diameter)} mm wide. It only moves straight down and back up.`
                : `This cutter makes a groove exactly ${fmtMm(g.diameter)} mm wide at any depth.`}
            </p>
          )}
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
        <Section icon={<Tag />} title="Name & kind">
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

        <Section icon={<Ruler />} title="Geometry" hint="Shape and size — watch the preview change">
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

        <Section icon={<Gauge />} title="Feeds & speeds" hint="How fast it spins and moves">
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
            <p className="mt-2 rounded-md bg-slate-950/60 px-2 py-1.5 text-[11px] leading-snug text-slate-400">
              At these settings each cutting edge takes a bite about{' '}
              <b className="text-slate-200">{(chipLoad * 1000).toFixed(1)} µm</b> thick (feed ÷ (speed ×
              flutes)). For tiny PCB bits a few micrometres is normal; much more risks breaking the bit.
            </p>
          )}
          {draft.type !== 'drill' && (
            <div className="mt-3 grid grid-cols-[1fr_auto] items-start gap-3">
              <NumberField
                {...fh('feeds.stepOver')}
                description="0.4 = each new pass moves over 40% of the cut width (passes overlap by 60%)."
                value={f.stepOver}
                onChange={(stepOver) => setFeeds({ stepOver })}
                min={0}
                max={1}
                step={0.05}
                error={fe['feeds.stepOver']}
              />
              <div className="overflow-hidden rounded-md">
                <StepoverDiagram stepOver={f.stepOver} width={300} height={124} />
              </div>
            </div>
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
