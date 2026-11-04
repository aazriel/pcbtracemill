import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import type { BBox, Material } from '@core/model/types'
import { defaultMaterial } from '@core/cam'
import { bboxIsEmpty } from '@core/geometry'
import { alignmentPinPositions, placedBoardBBox, workOriginInStock } from '@core/toolpath'
import { useProject } from '@renderer/store/project'
import { useBoardBBox, useMaterialIssues } from '@renderer/store/controller'
import { Button } from '@renderer/components/ui/button'
import { HelpTip } from '@renderer/components/ui/help'
import { PanelSection } from '@renderer/components/ui/section'
import { StatusCircle } from '@renderer/components/ui/status'
import { MaterialDialog } from './MaterialDialog'
import { ORIGIN_LABEL, copperLabel, mm, overallLevel } from './materialIssues'

/** Tiny static top view for the panel card: stock, board, pins and origin dot. */
function Thumb({ m, bbox, bad }: { m: Material; bbox: BBox; bad: boolean }): React.JSX.Element {
  const W = 84
  const H = 56
  const s = Math.min((W - 8) / Math.max(1, m.width), (H - 8) / Math.max(1, m.height))
  const ox = (W - m.width * s) / 2
  const oy = (H + m.height * s) / 2
  const X = (x: number): number => ox + x * s
  const Y = (y: number): number => oy - y * s
  const has = !bboxIsEmpty(bbox)
  const pb = has ? placedBoardBBox(m, bbox) : null
  const pins = has && m.doubleSided && m.alignment.enabled ? alignmentPinPositions(m, bbox) : []
  const o = workOriginInStock(m)
  return (
    <svg width={W} height={H} className="shrink-0 rounded bg-slate-950" aria-hidden>
      <rect
        x={X(0)}
        y={Y(m.height)}
        width={m.width * s}
        height={m.height * s}
        fill="#c98a50"
        stroke={bad ? '#f43f5e' : '#f5c08a'}
        strokeWidth={bad ? 1.5 : 0.75}
      />
      {pb && (
        <rect
          x={X(pb.minX)}
          y={Y(pb.maxY)}
          width={(pb.maxX - pb.minX) * s}
          height={(pb.maxY - pb.minY) * s}
          fill="#1f2937"
          fillOpacity={0.35}
          stroke={bad ? '#f43f5e' : '#fef3c7'}
          strokeWidth={0.9}
        />
      )}
      {pins.map((p, i) => (
        <circle
          key={i}
          cx={X(p.x)}
          cy={Y(p.y)}
          r={Math.max(1.5, (m.alignment.pinDiameter / 2) * s)}
          fill="#0b0f14"
          stroke="#e2e8f0"
          strokeWidth={0.6}
        />
      ))}
      <circle cx={X(o.x)} cy={Y(o.y)} r={3} fill="#38bdf8" stroke="#0b0f14" strokeWidth={1} />
    </svg>
  )
}

/** Manufacture-stage panel section: material size summary + Edit dialog. */
export function MaterialSection(): React.JSX.Element {
  const material = useProject((s) => s.material)
  const setMaterial = useProject((s) => s.setMaterial)
  const bbox = useBoardBBox()
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
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="material-edit">
            <Pencil /> Edit
          </Button>
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
          <div className="flex items-center gap-2.5">
            <Thumb m={material} bbox={bbox} bad={errors.length > 0} />
            <div className="min-w-0 text-[11px] leading-snug">
              <div className="text-sm font-medium text-slate-100">
                {mm(material.width)} × {mm(material.height)} × {mm(material.thickness, 2)} mm
              </div>
              <div className="text-slate-400">Copper {copperLabel(material.copperThickness)}</div>
              <div className="text-slate-400">
                {material.doubleSided
                  ? `Double-sided${material.alignment.enabled ? ` · pins along ${material.alignment.axis.toUpperCase()}` : ''}`
                  : 'Single-sided'}
              </div>
              <div className="text-slate-500">X0 Y0: {ORIGIN_LABEL[material.origin]}</div>
            </div>
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
          No material yet. Import a board, or click <span className="text-slate-300">Edit</span> to describe
          your copper-clad sheet.
        </p>
      )}
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
