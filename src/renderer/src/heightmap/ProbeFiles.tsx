/**
 * Auto-level step 3: which files are probed (all, or each on its own) and where the bit finds Z0
 * (D-037).
 */
import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Crosshair, Mountain, Move, RotateCcw } from 'lucide-react'
import type { TouchPoint } from '@core/heightmap'
import { NumberField, Segmented } from '@renderer/components/ui/fields'
import { HelpTip } from '@renderer/components/ui/help'
import { cn } from '@renderer/lib/utils'
import { useProject } from '@renderer/store/project'
import { setStepsProbed, setStepTouchPoint, type ExportFile } from '@renderer/export/exportFiles'
import { useUi } from '@renderer/store/ui'
import { FILE_COLOURS, hoverProps, useTouchUi } from './touchState'
import { boardProbeArea, useWorkScene } from './geometry'
import { useAutoLevel } from './state'

const fmt = (v: number): string => String(Math.round(v * 10) / 10)

function Box({
  checked,
  mixed,
  onChange,
  label,
  testId
}: {
  checked: boolean
  mixed?: boolean
  onChange: (v: boolean) => void
  label: string
  testId?: string
}): React.JSX.Element {
  return (
    <input
      type="checkbox"
      aria-label={label}
      data-testid={testId}
      className="size-3.5 shrink-0 accent-sky-500"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = !!mixed
      }}
      onChange={(e) => onChange(e.target.checked)}
    />
  )
}

export function ProbeFiles({
  files,
  levelling
}: {
  files: ExportFile[]
  levelling: boolean
}): React.JSX.Element {
  const allOn = files.every((f) => f.probeOn)
  const someOn = files.some((f) => f.probeOn)
  const setAll = (on: boolean): void =>
    setStepsProbed(
      files.flatMap((f) => f.file.stepIds),
      on
    )
  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-slate-800 bg-slate-950/50 p-2"
      data-testid="probe-files"
    >
      <label className="flex items-center gap-2 text-[11px] font-medium text-slate-200">
        <Box
          checked={allOn}
          mixed={someOn && !allOn}
          onChange={setAll}
          label="Probe all files"
          testId="probe-files-all"
        />
        Probe all files
        <HelpTip title="Which files are probed">
          Each ticked file follows the height map and finds Z0 with the probe before every bit. Untick a file
          you don’t need it for – a cutout or drilling through the board doesn’t care about a few hundredths
          of a millimetre. An unticked file is saved as it is: set Z0 by hand for it.
        </HelpTip>
      </label>
      <ul className="flex flex-col gap-1 pl-1">
        {files.map((f, i) => (
          <li
            key={f.file.name}
            className="-mx-1 flex flex-col gap-0.5 rounded px-1 py-0.5 hover:bg-slate-800/60"
            data-testid="probe-file"
            {...hoverProps(f.file.name)}
          >
            <label className="flex items-center gap-2 text-[11px] text-slate-300">
              <Box
                checked={f.probeOn}
                onChange={(v) => setStepsProbed(f.file.stepIds, v)}
                label={`Probe ${f.file.name}`}
              />
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: f.probeOn ? FILE_COLOURS[i % FILE_COLOURS.length] : '#475569' }}
              />
              <span className={cn('truncate font-mono', !f.probeOn && 'text-slate-500 line-through')}>
                {f.file.name}
              </span>
            </label>
            <div className="pl-5.5 text-[10.5px] leading-snug">
              {!f.probeOn ? (
                <span className="text-slate-500">not probed – set Z0 by hand</span>
              ) : f.levelSkip ? (
                <span className="flex gap-1 text-amber-300/90">
                  <AlertTriangle className="mt-px size-3 shrink-0" /> {f.levelSkip}
                </span>
              ) : f.levelled || f.touchPoints.length ? (
                <div className="flex flex-col gap-0.5">
                  {f.levelled && (
                    <span className="flex items-center gap-1 text-emerald-300/90">
                      <Mountain className="size-3" /> corrected
                    </span>
                  )}
                  {f.touchPoints.map((p, k) => (
                    <PointRow key={k} n={k + 1} p={p} />
                  ))}
                </div>
              ) : (
                <span className="text-slate-500">{levelling ? 'correcting…' : 'waiting'}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** One bit's Z0 point: where, and buttons to move it (a click on the board map) or go back to automatic. */
function PointRow({ n, p }: { n: number; p: TouchPoint }): React.JSX.Element {
  const editStep = useTouchUi((s) => s.editStep)
  const set = useTouchUi((s) => s.set)
  const name = useUi((s) => s.cam?.toolpaths.find((t) => t.stepId === p.stepId)?.stepName)
  const editing = !!p.stepId && editStep === p.stepId
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 text-emerald-300/90" data-testid="touch-point-row">
        <Crosshair className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={p.where}>
          {n}. {name ?? 'bit'}: X{fmt(p.x)} Y{fmt(p.y)} <span className="text-slate-400">({p.where})</span>
        </span>
        {p.stepId && (
          <button
            type="button"
            title="Choose this bit's Z0 point yourself: click on the board map on the left, or type X / Y"
            className={cn(
              'flex items-center gap-0.5 rounded px-1 text-sky-300 hover:bg-slate-700',
              editing && 'bg-sky-600/30'
            )}
            onClick={() => set({ editStep: editing ? null : p.stepId! })}
            data-testid="touch-point-move"
          >
            <Move className="size-3" /> {editing ? 'Done' : 'Move'}
          </button>
        )}
        {p.own && p.stepId && (
          <button
            type="button"
            title="Back to the automatic point"
            className="flex items-center gap-0.5 rounded px-1 text-slate-300 hover:bg-slate-700"
            onClick={() => {
              setStepTouchPoint(p.stepId!, null)
              if (editing) set({ editStep: null })
            }}
          >
            <RotateCcw className="size-3" /> Auto
          </button>
        )}
      </div>
      {p.rejected && (
        <span className="flex gap-1 pl-4 text-amber-300/90">
          <AlertTriangle className="mt-px size-3 shrink-0" />
          Your point X{fmt(p.rejected.x)} Y{fmt(p.rejected.y)} has no copper joined to the probe clip there
          (or is outside the probed area) – the automatic point is used.
        </span>
      )}
      {editing && p.stepId && (
        <div className="grid grid-cols-2 gap-2 pl-4">
          <NumberField
            label="X"
            unit="mm"
            value={p.rejected?.x ?? p.x}
            onChange={(x) => setStepTouchPoint(p.stepId!, { x, y: p.rejected?.y ?? p.y })}
          />
          <NumberField
            label="Y"
            unit="mm"
            value={p.rejected?.y ?? p.y}
            onChange={(y) => setStepTouchPoint(p.stepId!, { x: p.rejected?.x ?? p.x, y })}
          />
        </div>
      )}
    </div>
  )
}

/** Advanced: where isolation / copper clearing find Z0 (board centre by default). */
export function TouchPointChoice(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const choice = useProject((s) => s.settings.autoLevelTouchPoint) ?? 'center'
  const xy = useProject((s) => s.settings.autoLevelTouchXY)
  const setSettings = useProject((s) => s.setSettings)
  const side = useAutoLevel((s) => s.measuredSide)
  const scene = useWorkScene(side)
  const area = scene ? boardProbeArea(scene) : null
  const centre = scene
    ? { x: (scene.board.minX + scene.board.maxX) / 2, y: (scene.board.minY + scene.board.maxY) / 2 }
    : { x: 0, y: 0 }
  const cur = xy ?? centre
  return (
    <div className="flex flex-col gap-1.5" data-testid="touch-point">
      <button
        type="button"
        className="flex items-center gap-1 self-start text-[11px] text-slate-400 hover:text-slate-200"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        Advanced: where isolation finds Z0 by default
      </button>
      {open && (
        <div className="flex flex-col gap-2 rounded-md border border-slate-800 bg-slate-950/50 p-2">
          <p className="text-[11px] leading-snug text-slate-400">
            Isolation and copper clearing touch the copper here (the whole sheet is still copper then).
            Drilling touches on a hole it is about to drill and the cutout on its own line, so the small mark
            is removed. Every point must be copper still joined to the outer copper where the probe clip is.
            To choose the point of one file’s bit yourself, press “Move” next to it below.
          </p>
          <Segmented
            size="sm"
            value={choice}
            onChange={(v) =>
              setSettings({
                autoLevelTouchPoint: v
              })
            }
            options={[
              { value: 'center', label: 'Board centre' },
              { value: 'point1', label: 'Point 1 (corner)' },
              // older projects: one point for every copper step (now chosen per bit with "Move")
              ...(choice === 'custom' ? [{ value: 'custom' as const, label: 'My point' }] : [])
            ]}
          />
          {choice === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="X"
                unit="mm"
                value={cur.x}
                min={area?.minX}
                max={area?.maxX}
                onChange={(x) => setSettings({ autoLevelTouchXY: { ...cur, x } })}
                description="Work coordinates (from X0 Y0), inside the probed area."
              />
              <NumberField
                label="Y"
                unit="mm"
                value={cur.y}
                min={area?.minY}
                max={area?.maxY}
                onChange={(y) => setSettings({ autoLevelTouchXY: { ...cur, y } })}
                description="Work coordinates (from X0 Y0), inside the probed area."
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
