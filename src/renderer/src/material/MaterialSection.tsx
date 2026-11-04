import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import { defaultMaterial } from '@core/cam'
import { lengthValue, unitLabel, useUnits } from '@renderer/lib/units'
import { useProject } from '@renderer/store/project'
import { useBoardBBox, useMaterialIssues } from '@renderer/store/controller'
import { Button } from '@renderer/components/ui/button'
import { HelpTip } from '@renderer/components/ui/help'
import { PanelSection } from '@renderer/components/ui/section'
import { StatusCircle } from '@renderer/components/ui/status'
import { MaterialDialog } from './MaterialDialog'
import { overallLevel } from './materialIssues'

/** Manufacture-stage panel section: material size summary + Edit dialog. */
export function MaterialSection(): React.JSX.Element {
  const material = useProject((s) => s.material)
  const setMaterial = useProject((s) => s.setMaterial)
  const bbox = useBoardBBox()
  const units = useUnits()
  const issues = useMaterialIssues()
  const [open, setOpen] = useState(false)
  const errors = useMemo(() => issues.filter((i) => i.level === 'error'), [issues])
  const warnings = useMemo(() => issues.filter((i) => i.level === 'warning'), [issues])
  const level = material ? overallLevel(issues) : 'pending'

  return (
    <PanelSection
      title="Material"
      status={
        <StatusCircle
          level={level}
          size={14}
          title={
            !material
              ? 'No material yet'
              : (errors[0]?.message ?? warnings[0]?.message ?? 'Material fits the board')
          }
        />
      }
      actions={
        <>
          <HelpTip title="Material">
            The copper-clad sheet you clamp on the machine: its size and thickness, where the board sits on
            it, and where the machine’s zero point (X0 Y0) is.
          </HelpTip>
        </>
      }
    >
      {material ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-left transition-colors hover:border-slate-600"
          data-testid="material-summary"
        >
          <div className="text-xs tabular-nums text-slate-200" title="Width × height × thickness">
            {lengthValue(material.width, units, 1)} × {lengthValue(material.height, units, 1)} ×{' '}
            {lengthValue(material.thickness, units, 2)} {unitLabel(units)}
          </div>
          {errors.slice(0, 2).map((e) => (
            <p key={e.message} className="text-[11px] font-medium text-rose-400">
              ✕ {e.message}
            </p>
          ))}
          {!errors.length &&
            warnings.slice(0, 1).map((w) => (
              <p key={w.message} className="text-[11px] font-medium text-amber-400">
                ! {w.message}
              </p>
            ))}
        </button>
      ) : (
        <p className="text-xs text-slate-500">
          No material yet. Import a board, or click <span className="text-slate-300">Edit material</span> to
          describe your copper-clad sheet.
        </p>
      )}
      <Button
        variant="secondary"
        className="mt-2 h-9 w-full"
        onClick={() => setOpen(true)}
        data-testid="material-edit"
      >
        <Pencil /> Edit material
      </Button>
      {open && (
        <MaterialDialog
          initial={material ?? defaultMaterial(bbox)}
          bbox={bbox}
          onSave={setMaterial}
          onClose={() => setOpen(false)}
        />
      )}
    </PanelSection>
  )
}
