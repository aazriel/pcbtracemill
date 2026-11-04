import { useState } from 'react'
import {
  Eye,
  EyeOff,
  GripVertical,
  RefreshCw,
  Trash2,
  Lock,
  Unlock,
  Layers as LayersIcon,
  Plus
} from 'lucide-react'
import type { ImportedLayer, LayerSide, LayerType } from '@core/model/types'
import { Button } from '@renderer/components/ui/button'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { HelpTip } from '@renderer/components/ui/help'
import { PanelSection } from '@renderer/components/ui/section'
import { cn } from '@renderer/lib/utils'
import { StatusCircle, type StatusLevel } from '@renderer/components/ui/status'

export const LAYER_TYPE_LABELS: Record<LayerType, string> = {
  copper: 'Copper',
  soldermask: 'Solder mask',
  silkscreen: 'Silkscreen',
  paste: 'Solder paste',
  outline: 'Board outline',
  drill: 'Drill holes',
  fab: 'Fab / Assembly',
  other: 'Other'
}

export const LAYER_TYPE_HELP: Record<LayerType, string> = {
  copper: 'The copper traces and pads. This is what isolation milling keeps on the board.',
  soldermask: 'The green protective coating. Usually not milled, but can be used for reference or engraving.',
  silkscreen: 'The white text and component outlines. Can be engraved lightly with a V-bit if you want.',
  paste: 'Stencil openings for solder paste. Not used for milling.',
  outline: 'The board shape. Used to cut the finished board out of the material.',
  drill: 'Hole positions and sizes (Excellon). Used for drilling and milling big holes.',
  fab: 'Fabrication / assembly drawings. Reference only.',
  other: 'Unrecognised file. Assign a type if it is useful.'
}

export const SIDE_LABELS: Record<LayerSide, string> = {
  top: 'Board top',
  bottom: 'Board bottom',
  inner: 'Inner layer',
  all: 'Both sides',
  none: 'No side'
}

export interface LayerPanelProps {
  layers: ImportedLayer[]
  onToggleVisible(id: string, v: boolean): void
  onAllVisible(v: boolean): void
  onColor(id: string, c: string): void
  onType(id: string, t: LayerType): void
  onSide(id: string, s: LayerSide): void
  onResetAuto(id: string): void
  onMove(id: string, toIndex: number): void
  onDelete(id: string): void
  onReimport(id: string): void
  onAdd(): void
}

export function LayerPanel(p: LayerPanelProps): React.JSX.Element {
  // Show top of draw order first (like layer lists in image editors).
  const sorted = [...p.layers].sort((a, b) => b.order - a.order)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const allVisible = p.layers.length > 0 && p.layers.every((l) => l.visible)

  return (
    <PanelSection
      title={
        <span className="flex items-center gap-1.5">
          <LayersIcon className="size-3.5" /> Layers ({p.layers.length})
        </span>
      }
      actions={
        <>
          <Tooltip content={allVisible ? 'Hide all layers' : 'Show all layers'}>
            <Button
              size="iconSm"
              variant="ghost"
              onClick={() => p.onAllVisible(!allVisible)}
              aria-label="Toggle all layers"
              data-testid="toggle-all-layers"
            >
              {allVisible ? <Eye /> : <EyeOff />}
            </Button>
          </Tooltip>
          <Tooltip content="Add more Gerber / drill files">
            <Button size="iconSm" variant="ghost" onClick={p.onAdd} aria-label="Add files">
              <Plus />
            </Button>
          </Tooltip>
        </>
      }
    >
      {sorted.length === 0 && (
        <p className="py-4 text-center text-xs text-slate-500">
          No layers yet. Import your fabrication files to start.
        </p>
      )}
      <ul className="flex flex-col gap-1.5" data-testid="layer-list">
        {sorted.map((l) => (
          <li
            key={l.id}
            draggable
            onDragStart={(e) => {
              setDragId(l.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setOverId(l.id)
            }}
            onDragEnd={() => {
              setDragId(null)
              setOverId(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragId && dragId !== l.id) p.onMove(dragId, l.order)
              setDragId(null)
              setOverId(null)
            }}
            className={cn(
              'group rounded-lg border bg-slate-900/60 p-2 transition-colors',
              overId === l.id && dragId !== l.id ? 'border-sky-500' : 'border-slate-800',
              dragId === l.id && 'opacity-50'
            )}
            data-testid="layer-item"
          >
            <div className="flex items-center gap-1.5">
              <Tooltip content="Drag to change the drawing order (layers higher in the list are drawn on top)">
                <span className="cursor-grab text-slate-600 hover:text-slate-300">
                  <GripVertical className="size-4" />
                </span>
              </Tooltip>
              <Tooltip content={l.visible ? 'Hide this layer in the view' : 'Show this layer in the view'}>
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-100"
                  onClick={() => p.onToggleVisible(l.id, !l.visible)}
                  aria-label="Toggle visibility"
                >
                  {l.visible ? <Eye className="size-4" /> : <EyeOff className="size-4 text-slate-600" />}
                </button>
              </Tooltip>
              <Tooltip content="Layer colour – click to change it. Each layer gets its own colour.">
                <label
                  className="relative size-4 shrink-0 cursor-pointer rounded border border-slate-600"
                  style={{ background: l.color }}
                >
                  <input
                    type="color"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    value={l.color}
                    onChange={(e) => p.onColor(l.id, e.target.value)}
                    aria-label="Layer colour"
                  />
                </label>
              </Tooltip>
              <span
                className="min-w-0 flex-1 truncate text-xs font-medium text-slate-200"
                title={l.fileName}
                data-testid="layer-name"
              >
                {l.fileName}
              </span>
              <div className="-my-1 hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
                <Tooltip content="Re-import this file from disk (e.g. after you changed the design)">
                  <Button
                    size="iconSm"
                    variant="ghost"
                    onClick={() => p.onReimport(l.id)}
                    aria-label="Re-import"
                  >
                    <RefreshCw />
                  </Button>
                </Tooltip>
                <Tooltip content="Remove this layer from the project">
                  <Button
                    size="iconSm"
                    variant="ghost"
                    className="hover:text-rose-400"
                    onClick={() => p.onDelete(l.id)}
                    aria-label="Delete layer"
                  >
                    <Trash2 />
                  </Button>
                </Tooltip>
              </div>
            </div>
            <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_108px] items-end gap-x-1.5 gap-y-0.5 pl-6">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Type</span>
              <span className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                Side
                <Tooltip
                  content={
                    l.autoDetected
                      ? `Type and side were detected automatically (${Math.round(l.confidence * 100)}% sure). Change them if the guess is wrong.`
                      : 'You changed the detected type or side. Pick the detected values again, or click here, to go back to automatic.'
                  }
                >
                  <button
                    type="button"
                    onClick={() => !l.autoDetected && p.onResetAuto(l.id)}
                    className={cn(
                      'flex items-center gap-0.5 rounded px-1 text-[9px] font-semibold normal-case tracking-normal',
                      l.autoDetected ? 'text-emerald-400' : 'text-amber-400 hover:bg-slate-800'
                    )}
                    aria-label={l.autoDetected ? 'Auto-detected' : 'Manual override'}
                    data-testid="layer-auto"
                  >
                    {l.autoDetected ? <Lock className="size-2.5" /> : <Unlock className="size-2.5" />}
                    {l.autoDetected ? 'AUTO' : 'MANUAL'}
                  </button>
                </Tooltip>
              </span>
              <select
                className="h-6 min-w-0 rounded border border-slate-700 bg-slate-950 px-1 text-[11px] text-slate-200"
                value={l.type}
                onChange={(e) => p.onType(l.id, e.target.value as LayerType)}
                aria-label="Layer type"
                title={LAYER_TYPE_HELP[l.type]}
              >
                {Object.entries(LAYER_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                className="h-6 rounded border border-slate-700 bg-slate-950 px-1 text-[11px] text-slate-200"
                value={l.side}
                onChange={(e) => p.onSide(l.id, e.target.value as LayerSide)}
                aria-label="Layer side"
                title="Which side of the board this layer belongs to"
              >
                {(Object.keys(SIDE_LABELS) as LayerSide[]).map((k) => (
                  <option key={k} value={k}>
                    {SIDE_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1 pl-6 font-mono text-[10px] text-slate-500">
              <span title="Width × height of this layer in millimetres">
                {l.stats.widthMm.toFixed(1)}×{l.stats.heightMm.toFixed(1)}mm
              </span>
              <span title="Number of geometric points (vertices) after parsing">
                {l.stats.points.toLocaleString()} pts
              </span>
              <span title={l.type === 'drill' ? 'Number of holes' : 'Number of pads (flashed shapes)'}>
                {l.stats.pads.toLocaleString()} {l.type === 'drill' ? 'holes' : 'pads'}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </PanelSection>
  )
}

export interface LayerStatusEntry {
  key: string
  label: string
  present: boolean
  requirement: 'required' | 'recommended' | 'optional'
  /** For layers that belong to a side: which board sides have one. */
  sides?: ('top' | 'bottom')[]
}

export function LayerStatusPanel({ status }: { status: LayerStatusEntry[] }): React.JSX.Element {
  return (
    <PanelSection
      title={
        <span className="flex items-center gap-1">
          File status
          <HelpTip title="File status">
            Which kinds of files we found, for the whole board. Copper is required. Board outline and drill
            holes are strongly recommended (without them we cannot cut the board out or drill holes). The rest
            are optional. For copper, silkscreen and solder mask it also shows which side of the board they
            are on.
          </HelpTip>
        </span>
      }
    >
      <ul className="flex flex-col gap-1.5" data-testid="file-status">
        {status.map((s) => {
          const level: StatusLevel = s.present
            ? 'ok'
            : s.requirement === 'required'
              ? 'error'
              : s.requirement === 'recommended'
                ? 'warning'
                : 'pending'
          const tip = s.present
            ? `${s.label}: found`
            : s.requirement === 'required'
              ? `${s.label}: missing — required`
              : s.requirement === 'recommended'
                ? `${s.label}: missing — recommended`
                : `${s.label}: not loaded (optional)`
          return (
            <li key={s.key} className="flex items-center gap-2 text-xs" data-testid={`status-${s.key}`}>
              <StatusCircle level={level} size={16} title={tip} />
              <span className="text-slate-300">{s.label}</span>
              <span className="text-[10px] uppercase tracking-wide text-slate-600">{s.requirement}</span>
              {s.present && s.sides && (
                <span className="ml-auto flex gap-1">
                  {(['top', 'bottom'] as const).map((side) => (
                    <span
                      key={side}
                      title={
                        s.sides!.includes(side)
                          ? `${s.label} found for the board ${side}`
                          : `No ${s.label.toLowerCase()} for the board ${side}`
                      }
                      className={cn(
                        'rounded px-1 text-[9px] font-semibold uppercase',
                        s.sides!.includes(side)
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-slate-800 text-slate-600 line-through'
                      )}
                    >
                      {side}
                    </span>
                  ))}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </PanelSection>
  )
}
