import { useMemo, useState, type ReactNode } from 'react'
import { Crosshair, Layers, Maximize2, Move, RotateCcw, SquareStack } from 'lucide-react'
import type { BBox, Material } from '@core/model/types'
import { getHelp } from '@core/help'
import { bboxIsEmpty } from '@core/geometry'
import { MAX_STOCK_SIZE, resetMaterialToDefault, rotatedBoardSize, validateMaterial } from '@core/cam'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { NumberField, Segmented, Switch } from '@renderer/components/ui/fields'
import { HelpTip } from '@renderer/components/ui/help'
import { Tooltip } from '@renderer/components/ui/tooltip'
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
        {(intro || helpText) && (
          <HelpTip title={title}>
            {intro}
            {intro && helpText && <div className="mt-1.5" />}
            {helpText}
          </HelpTip>
        )}
      </header>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
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

type PlacementId = 'top-left' | 'bottom-left' | 'center' | 'top-right' | 'bottom-right'
const PLACE_MARGIN = 2.5
const PLACEMENTS: { id: PlacementId; label: string }[] = [
  { id: 'top-left', label: 'Top left (back left)' },
  { id: 'bottom-left', label: 'Bottom left (front left)' },
  { id: 'center', label: 'Centre of the material' },
  { id: 'top-right', label: 'Top right (back right)' },
  { id: 'bottom-right', label: 'Bottom right (front right)' }
]

/** Tiny picture of the material with the board in the chosen spot. */
function PlacementIcon({ at }: { at: PlacementId }): React.JSX.Element {
  const x = at === 'center' ? 11 : at.endsWith('left') ? 4 : 18
  const y = at === 'center' ? 9 : at.startsWith('top') ? 4 : 14
  return (
    <svg viewBox="0 0 36 26" className="h-6 w-9">
      <rect x="1" y="1" width="34" height="24" rx="2" fill="#c47f45" opacity="0.35" stroke="#c47f45" />
      <rect x={x} y={y} width="14" height="8" rx="1" fill="#e2a06b" stroke="#fde68a" strokeWidth="0.8" />
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

  /** Puts the board in a corner (or the centre) of the material, keeping a small margin. */
  const place = (at: PlacementId): void => {
    if (at === 'center') return centre()
    const free = { x: Math.max(0, draft.width - board.width), y: Math.max(0, draft.height - board.height) }
    const gap = (f: number): number => r3(Math.min(PLACE_MARGIN, f / 2))
    const left = at.endsWith('left')
    const bottom = at.startsWith('bottom')
    update(
      {
        offsetX: left ? gap(free.x) : r3(free.x - gap(free.x)),
        offsetY: bottom ? gap(free.y) : r3(free.y - gap(free.y))
      },
      true
    )
  }

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
      bodyClassName="overflow-hidden"
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
        className="grid h-[min(66vh,720px)] grid-cols-[minmax(0,410px)_minmax(0,1fr)] gap-4"
      >
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          <FormSection
            id="size"
            title="Size"
            icon={<Maximize2 />}
            level={lvl('size')}
            helpText={help('useDefaults')}
            intro={`The copper-clad sheet you put on the machine. It must be at least as big as the board, and at most ${MAX_STOCK_SIZE} × ${MAX_STOCK_SIZE} mm.`}
          >
            {hasBoard && (
              <div className="-mt-1 font-mono text-[11px] text-slate-400" data-testid="material-board-size">
                Board {mm(board.width, 2)} × {mm(board.height, 2)} mm
                {draft.rotation ? ` (turned ${mm(draft.rotation, 1)}°)` : ''}
              </div>
            )}
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
                max={MAX_STOCK_SIZE}
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
                max={MAX_STOCK_SIZE}
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
              description="Measure with calipers. Almost every board is 1.6 mm."
              help={help('thickness')}
              {...msg('thickness')}
              onChange={(v) => update({ thickness: v })}
            />
          </FormSection>

          <FormSection
            id="copper"
            title="Copper thickness"
            icon={<Layers />}
            level={lvl('copper')}
            helpText={help('copperThickness')}
            intro="The thin copper layer on top. Isolation cuts only need to go slightly deeper than this. Check the sheet's label; “1 oz” is most common."
          >
            <NumberField
              label="Copper thickness"
              unit="mm"
              step={0.005}
              min={0}
              value={draft.copperThickness}
              description="In millimetres. Almost every board has 0.035 mm (35 µm, “1 oz”); some have 0.018 mm (½ oz) or 0.07 mm (2 oz)."
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
            <div className="flex flex-col gap-1">
              <div className="text-xs font-medium text-slate-300">Quick placement</div>
              <div className="grid grid-cols-5 gap-1" data-testid="material-placement">
                {PLACEMENTS.map((pl) => (
                  <Tooltip key={pl.id} content={pl.label}>
                    <button
                      type="button"
                      disabled={!hasBoard}
                      onClick={() => place(pl.id)}
                      aria-label={pl.label}
                      data-testid={`material-place-${pl.id}`}
                      className="flex h-11 items-center justify-center rounded-md border border-slate-700 bg-slate-950 transition-colors hover:border-sky-500 disabled:opacity-40"
                    >
                      <PlacementIcon at={pl.id} />
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                Rotation{' '}
                <HelpTip title="Board rotation">
                  Turns the board anticlockwise on the material — useful to fit a long board on a sheet the
                  other way round. {help('rotation')}
                  {draft.useDefaults && hasBoard
                    ? ' Rotating resizes the material once and turns off automatic size.'
                    : ''}
                </HelpTip>
              </div>
              <div className="flex items-start gap-2">
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
                <div className="w-24">
                  <NumberField
                    hideLabel
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
            <Segmented
              stretch
              value={draft.originOn ?? 'stock'}
              onChange={(originOn) => update({ originOn })}
              options={[
                {
                  value: 'stock',
                  label: 'On the material',
                  title: 'X0 Y0 on a corner or the centre of the sheet'
                },
                {
                  value: 'board',
                  label: 'On the board',
                  title: 'X0 Y0 on a corner or the centre of the board itself',
                  disabled: !hasBoard
                }
              ]}
            />
            <OriginPicker
              value={draft.origin}
              on={draft.originOn ?? 'stock'}
              onChange={(origin) => update({ origin })}
            />
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
              stretch
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
                            <span
                              className={cn(
                                'min-w-0 flex-1 text-xs font-medium',
                                active ? 'text-violet-200' : 'text-slate-200'
                              )}
                            >
                              {AXIS_TEXT[axis].title}
                            </span>
                            <HelpTip title={AXIS_TEXT[axis].title}>{AXIS_TEXT[axis].body}</HelpTip>
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
