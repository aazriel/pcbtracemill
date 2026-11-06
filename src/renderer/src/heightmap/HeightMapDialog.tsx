import { useMemo, useState } from 'react'
import { AlertTriangle, Box, Grid3x3, Upload } from 'lucide-react'
import { HELP } from '@core/help'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { HelpTip } from '@renderer/components/ui/help'
import { useProject } from '@renderer/store/project'
import { mapRange, um, useWorkScene } from './geometry'
import { HeatMap } from './HeatMap'
import { Surface3D } from './Surface3D'
import { useAutoLevel } from './state'
import { importProbeResults } from './importProbe'

function Stat({
  label,
  value,
  help,
  warn
}: {
  label: string
  value: string
  help: string
  warn?: boolean
}): React.JSX.Element {
  return (
    <div
      className={
        warn
          ? 'rounded-md bg-amber-500/10 px-2 py-1 ring-1 ring-amber-500/40'
          : 'rounded-md bg-slate-900 px-2 py-1'
      }
    >
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
        {label}
        <HelpTip title={label}>{help}</HelpTip>
      </div>
      <div className={warn ? 'font-mono text-sm text-amber-300' : 'font-mono text-sm text-slate-100'}>
        {value}
      </div>
    </div>
  )
}

/**
 * The measured board surface – stats, heat map and 3D – in a dialog opened from the Auto-level
 * section (and right after importing results).
 */
export function HeightMapDialog(): React.JSX.Element | null {
  const map = useProject((s) => s.heightMap)
  const open = useAutoLevel((s) => s.mapOpen)
  const set = useAutoLevel((s) => s.set)
  const side = useAutoLevel((s) => s.measuredSide)
  const scene = useWorkScene(side)
  const [exag, setExag] = useState(200)
  const r = useMemo(() => (map ? mapRange(map) : null), [map])
  if (!map || !r) return null

  const c = map.config
  const tooWarped = r.range > 0.3
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => set({ mapOpen: o })}
      title={
        <span className="flex items-center gap-1.5">
          Measured board surface
          <HelpTip title={HELP['autolevel.heightmap']?.title}>{HELP['autolevel.heightmap']?.body}</HelpTip>
        </span>
      }
      description={`${c.countX} × ${c.countY} grid from “${map.source}”. Heights are compared with point 1 (where Z zero is); 1 mm = 1000 µm.`}
      className="w-[min(96vw,1200px)]"
      footer={
        <>
          <Button variant="ghost" onClick={() => void importProbeResults()}>
            <Upload /> Import other results…
          </Button>
          <Button onClick={() => set({ mapOpen: false })} data-testid="heightmap-close">
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="heightmap-dialog">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Lowest"
            value={um(r.min, true)}
            help="The deepest measured point compared with point 1."
          />
          <Stat
            label="Highest"
            value={um(r.max, true)}
            help="The highest measured point compared with point 1."
          />
          <Stat
            label="Range"
            value={um(r.range)}
            warn={tooWarped}
            help="Difference between the highest and lowest point. Isolation cuts are only ~100 µm deep, so even a small range matters – that is why this correction exists."
          />
          <Stat label="Average" value={um(r.mean, true)} help="Mean of all measured heights." />
        </div>
        {tooWarped && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <b>The board is {um(r.range)} out of flat – is it clamped down flat?</b>
              <div className="text-xs text-amber-200/80">
                More than 0.3 mm usually means the board is lifting, there are chips under it, or the
                spoilboard is not level. Correction still works, but check the setup and probe again if you
                can.
              </div>
            </div>
          </div>
        )}
        <div className="grid h-[min(58vh,520px)] grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="flex min-h-0 flex-col gap-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Grid3x3 className="size-3.5" /> Heat map (seen from above)
              <HelpTip title="Heat map">
                Colours show how high the copper is: blue = lower, red = higher than point 1. White dots are
                the probed points, the green/white line is your board and the dashed frame is the material.
                Hover to read a height.
              </HelpTip>
            </div>
            <div className="min-h-0 flex-1">
              <HeatMap map={map} scene={scene} />
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-1">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
              <Box className="size-3.5" /> 3D surface
              <HelpTip title="3D surface">
                The same measurements as a 3D landscape. Heights are stretched (exaggerated) so the tiny bumps
                become visible – a real board looks flat to the eye. Drag to rotate, scroll to zoom,
                right-drag to move.
              </HelpTip>
              <label className="ml-auto flex items-center gap-2 font-normal text-slate-400">
                Z exaggeration
                <input
                  type="range"
                  min={50}
                  max={500}
                  step={10}
                  value={exag}
                  onChange={(e) => setExag(Number(e.target.value))}
                  aria-label="Z exaggeration"
                  className="w-28 accent-sky-500"
                />
                <span className="w-10 font-mono text-slate-200">×{exag}</span>
              </label>
            </div>
            <div className="min-h-0 flex-1">
              <Surface3D map={map} scene={scene} exaggeration={exag} />
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
