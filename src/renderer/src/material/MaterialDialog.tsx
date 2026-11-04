import { useMemo, useState, type ReactNode } from 'react'
import { AlignCenter, Crosshair, Layers, Maximize2, Move, RotateCcw, SquareStack } from 'lucide-react'
import type { BBox, Material } from '@core/model/types'
import { getHelp } from '@core/help'
import { bboxIsEmpty } from '@core/geometry'
import { resetMaterialToDefault, rotatedBoardSize, validateMaterial } from '@core/cam'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { NumberField, Segmented, Switch } from '@renderer/components/ui/fields'
import { HelpTip } from '@renderer/components/ui/help'
import { StatusCircle, type StatusLevel } from '@renderer/components/ui/status'
import { cn } from '@renderer/lib/utils'
import { useBoardDrawing } from './boardDrawing'
import { MaterialCrossSection } from './MaterialCrossSection'
import { MaterialPreview } from './MaterialPreview'
import { OriginPicker } from './OriginPicker'
import { fieldMessages, mm, overallLevel, sectionLevel, type MaterialSectionId } from './materialIssues'

const help = (key: string): string | undefined => getHelp(`material.${key}`)?.body
const r3 = (v: number): number => Math.round(v * 1000) / 1000

function FormSection({
  id,
  title,
  icon,
  level,
  helpText,
  intro,
  children
}: {
  id: MaterialSectionId
  title: string
  icon: ReactNode
  level: StatusLevel
  helpText?: string
  intro?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <section
      data-testid={`material-section-${id}`}
      className={cn(
        'rounded-lg border bg-slate-950/40 p-3 transition-colors',
        level === 'error'
          ? 'border-rose-500/50'
          : level === 'warning'
            ? 'border-amber-500/40'
            : 'border-slate-800'
      )}
    >
      <header className="mb-2 flex items-center gap-2">
        <StatusCircle
          level={level}
          size={18}
          title={level === 'error' ? 'Needs fixing' : level === 'warning' ? 'Please check' : 'Looks good'}
        />
        <span className="text-slate-400 [&_svg]:size-4">{icon}</span>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">{title}</h3>
        {helpText && <HelpTip title={title}>{helpText}</HelpTip>}
      </header>
      {intro && <p className="mb-2.5 text-[11px] leading-snug text-slate-500">{intro}</p>}
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function Chip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-2 py-0.5 text-[11px] font-medium ring-1 transition-colors',
        active ? 'bg-sky-600 text-white ring-sky-500' : 'text-slate-400 ring-slate-700 hover:text-slate-100'
      )}
    >
      {children}
    </button>
  )
}

/** Small diagram for the two pin layouts. */
function AxisIcon({ axis }: { axis: 'x' | 'y' }): React.JSX.Element {
  return (
    <svg viewBox="0 0 64 44" className="h-11 w-16 shrink-0">
      <rect x="12" y="10" width="40" height="24" rx="2" fill="#c47f45" opacity="0.85" />
      {axis === 'x' ? (
        <>
          <line x1="2" x2="62" y1="22" y2="22" stroke="#c4b5fd" strokeDasharray="3 2" />
          <circle cx="6" cy="22" r="3" fill="#0b0f14" stroke="#e2e8f0" />
          <circle cx="58" cy="22" r="3" fill="#0b0f14" stroke="#e2e8f0" />
          <path d="M 32 38 C 44 34, 44 10, 32 6" fill="none" stroke="#c4b5fd" strokeWidth="1.6" />
          <path d="M 29 8 L 32 6 L 30 3" fill="none" stroke="#c4b5fd" strokeWidth="1.6" />
        </>
      ) : (
        <>
          <line y1="2" y2="42" x1="32" x2="32" stroke="#c4b5fd" strokeDasharray="3 2" />
          <circle cx="32" cy="5" r="3" fill="#0b0f14" stroke="#e2e8f0" />
          <circle cx="32" cy="39" r="3" fill="#0b0f14" stroke="#e2e8f0" />
          <path d="M 14 22 C 18 12, 46 12, 50 22" fill="none" stroke="#c4b5fd" strokeWidth="1.6" />
          <path d="M 47 20 L 50 22 L 51 18" fill="none" stroke="#c4b5fd" strokeWidth="1.6" />
        </>
      )}
    </svg>
  )
}

const AXIS_TEXT = {
  x: {
    title: 'Pins left & right (along X)',
    body: 'Flip front ↔ back: turn the board over the line through the pins, so the edge nearest you goes to the back. Left stays left, right stays right.'
  },
  y: {
    title: 'Pins front & back (along Y)',
    body: 'Flip left ↔ right, like turning a page in a book: the left edge goes to the right. The front edge stays at the front.'
  }
}

/**
 * Material editor. Works on a local DRAFT; Save applies it with `onSave`, Cancel discards.
 * Rendered only while open so the draft resets on every open.
 */
export function MaterialDialog({
  initial,
  bbox,
  onSave,
  onClose
}: {
  initial: Material
  bbox: BBox
  onSave: (m: Material) => void
  onClose: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<Material>(initial)
  const drawing = useBoardDrawing()
  const issues = useMemo(() => validateMaterial(draft, bbox), [draft, bbox])
  const lvl = (s: MaterialSectionId): StatusLevel => sectionLevel(issues, s)
  const msg = (f: string): { error: string | null; warning: string | null } => fieldMessages(issues, f)
  const hasBoard = !bboxIsEmpty(bbox)
  const board = rotatedBoardSize(bbox, Number.isFinite(draft.rotation) ? draft.rotation : 0)

  /**
   * `manual` = the user typed a size/position, so automatic sizing turns off. Otherwise, while automatic
   * sizing is on, the stock is re-fitted (e.g. to make room for alignment pins).
   */
  const update = (patch: Partial<Material>, manual = false): void =>
    setDraft((d) => {
      let n: Material = { ...d, ...patch, alignment: { ...d.alignment, ...patch.alignment } }
      if (manual) n.useDefaults = false
      else if (n.useDefaults && hasBoard) n = resetMaterialToDefault(n, bbox)
      return n
    })
  const setAlignment = (patch: Partial<Material['alignment']>): void =>
    update({ alignment: { ...draft.alignment, ...patch } })

  const setRotation = (rotation: number): void =>
    setDraft((d) => {
      if (!d.useDefaults || !hasBoard) return { ...d, rotation, useDefaults: false }
      // resetMaterialToDefault always rotates back to 0°, so fit the stock to the rotated board here once.
      const base = resetMaterialToDefault(d, bbox)
      const rb = rotatedBoardSize(bbox, rotation)
      return {
        ...base,
        rotation,
        width: r3(rb.width + 2 * base.offsetX),
        height: r3(rb.height + 2 * base.offsetY),
        useDefaults: false
      }
    })

  const centre = (): void =>
    update(
      { offsetX: r3((draft.width - board.width) / 2), offsetY: r3((draft.height - board.height) / 2) },
      true
    )

  const setDefault = (): void => setDraft((d) => resetMaterialToDefault(d, bbox))

  const rotSeg = ['0', '90', '180', '270'] as const
  const rotNorm = String(((Math.round(draft.rotation) % 360) + 360) % 360)
  const overall = overallLevel(issues)
  const errorCount = issues.filter((i) => i.level === 'error').length
  const alignIssues = issues.filter((i) => i.field === 'alignment')

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Material"
      description="Describe the copper-clad sheet you will put on the machine, where the board sits on it, and where the machine's zero point is."
      className="w-[min(96vw,1180px)]"
      footer={
        <>
          <div className="mr-auto flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={setDefault}
              data-testid="material-default"
              disabled={!hasBoard}
            >
              <RotateCcw /> Set to default
            </Button>
            <span className="text-[11px] text-slate-500">
              {draft.useDefaults ? 'Automatic size: board + 5 mm' : 'Custom size'}
            </span>
            <span className="flex items-center gap-1.5 text-xs">
              <StatusCircle level={overall} size={16} />
              <span
                className={
                  overall === 'error'
                    ? 'text-rose-400'
                    : overall === 'warning'
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                }
              >
                {overall === 'error'
                  ? `${errorCount} problem${errorCount > 1 ? 's' : ''} to fix`
                  : overall === 'warning'
                    ? 'Please double-check the warnings'
                    : 'Everything fits'}
              </span>
            </span>
          </div>
          <Button variant="ghost" onClick={onClose} data-testid="material-cancel">
            Cancel
          </Button>
          <Button
            variant="success"
            data-testid="material-save"
            onClick={() => {
              onSave(draft)
              onClose()
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div
        data-testid="material-dialog"
        className="grid h-[min(72vh,760px)] grid-cols-[minmax(0,410px)_minmax(0,1fr)] gap-4"
      >
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          <FormSection
            id="size"
            title="Size"
            icon={<Maximize2 />}
            level={lvl('size')}
            helpText={help('useDefaults')}
            intro={
              hasBoard ? (
                <>
                  Your board measures{' '}
                  <span className="font-medium text-slate-300">
                    {mm(board.width, 2)} × {mm(board.height, 2)} mm
                  </span>
                  {draft.rotation ? ` (after turning it ${mm(draft.rotation, 1)}°)` : ''}. The material must
                  be at least this big.
                </>
              ) : (
                'Import a board to compare its size with the material.'
              )
            }
          >
            <Switch
              label="Automatic size"
              description="Follows the board size plus 5 mm (2.5 mm each side). Typing a size turns this off."
              help={help('useDefaults')}
              checked={draft.useDefaults}
              disabled={!hasBoard}
              onChange={(v) => (v ? setDefault() : update({ useDefaults: false }, true))}
            />
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Width (X)"
                unit="mm"
                step={0.5}
                min={0}
                value={draft.width}
                description="Left-to-right size."
                help={help('width')}
                {...msg('width')}
                onChange={(v) => update({ width: v }, true)}
              />
              <NumberField
                label="Height (Y)"
                unit="mm"
                step={0.5}
                min={0}
                value={draft.height}
                description="Front-to-back size."
                help={help('height')}
                {...msg('height')}
                onChange={(v) => update({ height: v }, true)}
              />
            </div>
            <NumberField
              label="Thickness"
              unit="mm"
              step={0.1}
              min={0}
              value={draft.thickness}
              description="Measure with calipers. 1.6 mm is the most common."
              help={help('thickness')}
              {...msg('thickness')}
              onChange={(v) => update({ thickness: v })}
            />
            <div className="-mt-1 flex flex-wrap gap-1">
              {[0.8, 1.0, 1.2, 1.6, 2.0].map((v) => (
                <Chip
                  key={v}
                  active={Math.abs(draft.thickness - v) < 1e-6}
                  onClick={() => update({ thickness: v })}
                >
                  {v.toFixed(1)} mm
                </Chip>
              ))}
            </div>
          </FormSection>

          <FormSection
            id="copper"
            title="Copper thickness"
            icon={<Layers />}
            level={lvl('copper')}
            helpText={help('copperThickness')}
            intro="The thin copper layer on top. Isolation cuts only need to go slightly deeper than this. Check the sheet's label; “1 oz” is most common."
          >
            <Segmented
              value={
                [0.018, 0.035, 0.07].find((v) => Math.abs(v - draft.copperThickness) < 1e-6)?.toString() ??
                'custom'
              }
              onChange={(v) => update({ copperThickness: Number(v) })}
              options={[
                { value: '0.018', label: '18 µm (½ oz)', title: 'Thin copper, 0.018 mm' },
                { value: '0.035', label: '35 µm (1 oz)', title: 'Most common, 0.035 mm' },
                { value: '0.07', label: '70 µm (2 oz)', title: 'Thick copper, 0.07 mm' }
              ]}
            />
            <NumberField
              label="Exact copper thickness"
              unit="mm"
              step={0.005}
              min={0}
              value={draft.copperThickness}
              description="In millimetres: 0.035 mm = 35 µm = 1 oz."
              help={help('copperThickness')}
              {...msg('copperThickness')}
              onChange={(v) => update({ copperThickness: v })}
            />
          </FormSection>

          <FormSection
            id="placement"
            title="Board placement"
            icon={<Move />}
            level={lvl('placement')}
            intro="Where the board sits on the material, measured from the bottom-left (front-left) corner of the material to the bottom-left corner of the board."
          >
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="X offset"
                unit="mm"
                step={0.5}
                value={draft.offsetX}
                description="Gap from the left edge."
                help={help('offsetX')}
                {...msg('offsetX')}
                onChange={(v) => update({ offsetX: v }, true)}
              />
              <NumberField
                label="Y offset"
                unit="mm"
                step={0.5}
                value={draft.offsetY}
                description="Gap from the front edge."
                help={help('offsetY')}
                {...msg('offsetY')}
                onChange={(v) => update({ offsetY: v }, true)}
              />
            </div>
            <Button variant="outline" size="sm" className="self-start" onClick={centre} disabled={!hasBoard}>
              <AlignCenter /> Centre the board on the material
            </Button>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                Rotation <HelpTip title="Board rotation">{help('rotation')}</HelpTip>
              </div>
              <div className="flex items-center gap-2">
                <Segmented
                  value={
                    rotSeg.includes(rotNorm as (typeof rotSeg)[number]) && Number.isInteger(draft.rotation)
                      ? rotNorm
                      : 'custom'
                  }
                  onChange={(v) => setRotation(Number(v))}
                  options={rotSeg.map((v) => ({
                    value: v,
                    label: `${v}°`,
                    title: `Turn the board ${v}° anticlockwise`
                  }))}
                />
                <div className="w-28">
                  <NumberField
                    label="Rotation angle"
                    unit="°"
                    step={90}
                    min={-360}
                    max={360}
                    value={draft.rotation}
                    {...msg('rotation')}
                    onChange={setRotation}
                  />
                </div>
              </div>
              <p className="text-[11px] leading-snug text-slate-500">
                Turns the board anticlockwise on the material — useful to fit a long board on a sheet the
                other way round.
                {draft.useDefaults && hasBoard
                  ? ' Rotating resizes the material once and turns off automatic size.'
                  : ''}
              </p>
            </div>
          </FormSection>

          <FormSection
            id="origin"
            title="Origin (X0 Y0)"
            icon={<Crosshair />}
            level={lvl('origin')}
            helpText={getHelp('concept.origin')?.body}
            intro={help('origin')}
          >
            <OriginPicker value={draft.origin} onChange={(origin) => update({ origin })} />
          </FormSection>

          <FormSection
            id="sides"
            title="Sides"
            icon={<SquareStack />}
            level={lvl('sides')}
            helpText={help('doubleSided')}
            intro="Single-sided: traces only on top. Double-sided: you mill the top, flip the board over and mill the bottom."
          >
            <Segmented
              value={draft.doubleSided ? 'double' : 'single'}
              onChange={(v) =>
                update(
                  v === 'double'
                    ? { doubleSided: true, alignment: { ...draft.alignment, enabled: true } }
                    : { doubleSided: false }
                )
              }
              options={[
                { value: 'single', label: 'Single-sided' },
                { value: 'double', label: 'Double-sided' }
              ]}
            />
            {draft.doubleSided && (
              <>
                <Switch
                  label="Alignment pins"
                  description="Drills two holes outside the board. After flipping, pins in these holes put the board back exactly where it was."
                  help={`${help('alignment.enabled') ?? ''} ${getHelp('concept.alignment')?.body ?? ''}`}
                  checked={draft.alignment.enabled}
                  onChange={(enabled) => setAlignment({ enabled })}
                />
                {msg('alignment.enabled').warning && (
                  <p className="-mt-2 text-[11px] font-medium text-amber-400">
                    ! {msg('alignment.enabled').warning}
                  </p>
                )}
                {draft.alignment.enabled && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                        Where the pins go & how you flip{' '}
                        <HelpTip title="Flipping the board">{getHelp('concept.flip')?.body}</HelpTip>
                      </div>
                      {(['x', 'y'] as const).map((axis) => {
                        const active = draft.alignment.axis === axis
                        return (
                          <button
                            key={axis}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            data-testid={`material-axis-${axis}`}
                            onClick={() => setAlignment({ axis })}
                            className={cn(
                              'flex items-center gap-2.5 rounded-md border p-2 text-left transition-colors',
                              active
                                ? 'border-violet-400/70 bg-violet-500/10'
                                : 'border-slate-800 hover:border-slate-600'
                            )}
                          >
                            <AxisIcon axis={axis} />
                            <span className="min-w-0">
                              <span
                                className={cn(
                                  'block text-xs font-medium',
                                  active ? 'text-violet-200' : 'text-slate-200'
                                )}
                              >
                                {AXIS_TEXT[axis].title}
                              </span>
                              <span className="block text-[11px] leading-snug text-slate-500">
                                {AXIS_TEXT[axis].body}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <NumberField
                        label="Pin diameter"
                        unit="mm"
                        step={0.5}
                        min={0}
                        value={draft.alignment.pinDiameter}
                        description="Size of your pins; holes are drilled this size."
                        help={help('alignment.pinDiameter')}
                        {...msg('alignment.pinDiameter')}
                        onChange={(pinDiameter) => setAlignment({ pinDiameter })}
                      />
                      <NumberField
                        label="Pin distance"
                        unit="mm"
                        step={0.5}
                        min={0}
                        value={draft.alignment.margin}
                        description="Board edge → pin centre."
                        help={help('alignment.margin')}
                        {...msg('alignment.margin')}
                        onChange={(margin) => setAlignment({ margin })}
                      />
                    </div>
                    {alignIssues.map((i) => (
                      <p
                        key={i.message}
                        className={cn(
                          'text-[11px] font-medium',
                          i.level === 'error' ? 'text-rose-400' : 'text-amber-400'
                        )}
                      >
                        {i.level === 'error' ? '✕' : '!'} {i.message}
                      </p>
                    ))}
                  </>
                )}
              </>
            )}
          </FormSection>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-800 bg-[#0b0f14]">
          <div className="min-h-0 flex-1">
            <MaterialPreview material={draft} bbox={bbox} drawing={drawing} />
          </div>
          <div className="border-t border-slate-800 bg-slate-950/60 px-3 py-2">
            <MaterialCrossSection
              thickness={draft.thickness}
              copperThickness={draft.copperThickness}
              doubleSided={draft.doubleSided}
            />
          </div>
        </div>
      </div>
    </Dialog>
  )
}
