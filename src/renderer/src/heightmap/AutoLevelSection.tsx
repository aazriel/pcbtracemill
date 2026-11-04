import { Crosshair, Trash2, Upload, Mountain, AlertTriangle } from 'lucide-react'
import { HELP } from '@core/help'
import { PanelSection } from '@renderer/components/ui/section'
import { Button } from '@renderer/components/ui/button'
import { Segmented, Switch } from '@renderer/components/ui/fields'
import { HelpTip } from '@renderer/components/ui/help'
import { StatusCircle } from '@renderer/components/ui/status'
import { useProject } from '@renderer/store/project'
import type { ExportFile } from '@renderer/export/exportFiles'
import { WarpIllustration } from './ProbeIllustrations'
import { FORMAT_LABELS, importProbeResults } from './importProbe'
import { useAutoLevel } from './state'

export function AutoLevelSection({
  files,
  onGenerate
}: {
  files: ExportFile[]
  onGenerate: () => void
}): React.JSX.Element {
  const map = useProject((s) => s.heightMap)
  const setHeightMap = useProject((s) => s.setHeightMap)
  const material = useProject((s) => s.material)
  const al = useAutoLevel()
  const step1 = al.probeSaved || !!map
  const levelled = files.filter((f) => !f.levelSkip)

  return (
    <PanelSection
      title="Auto-level (optional)"
      status={
        <StatusCircle
          level={map ? 'ok' : 'pending'}
          size={14}
          title={map ? 'Height map loaded' : 'Not used'}
        />
      }
      actions={<HelpTip title={HELP['autolevel.what']?.title}>{HELP['autolevel.what']?.body}</HelpTip>}
    >
      <div className="flex flex-col gap-3">
        <p className="text-[11px] leading-snug text-slate-400">
          PCB copper is only 0.035 mm thick and a blank is never perfectly flat. A warp of just 0.1 mm means
          the bit cuts too deep in one corner and doesn’t reach the copper in another. Auto-leveling measures
          the real surface and bends the G-code to follow it.
        </p>
        <div className="rounded-md bg-slate-950/70 p-1.5">
          <WarpIllustration />
        </div>

        {material?.doubleSided && (
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-xs text-slate-300">
              Probed with side up
              <HelpTip title="Which side is probed?">
                A height map only fits the side that is facing up while probing. TraceMill adjusts only the
                files for that side. To level the other side, flip the board and probe again.
              </HelpTip>
            </span>
            <Segmented
              size="sm"
              value={al.measuredSide}
              onChange={(v) => al.set({ measuredSide: v })}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'bottom', label: 'Bottom' }
              ]}
            />
          </div>
        )}

        <ol className="flex flex-col gap-2">
          <li className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 p-2">
            <div className="flex items-center gap-2">
              <StatusCircle level={step1 ? 'ok' : 'pending'} />
              <span className="flex-1 text-sm font-medium text-slate-100">1. Generate probe program</span>
            </div>
            <p className="pl-[26px] text-[11px] text-slate-500">
              A small program that makes your machine touch the board at many points and record the height.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="ml-[26px]"
              data-testid="probe-generate"
              onClick={onGenerate}
            >
              <Crosshair /> {al.probeSaved ? 'Make another probe program…' : 'Generate probe program…'}
            </Button>
          </li>
          <li className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 p-2">
            <div className="flex items-center gap-2">
              <StatusCircle level={map ? 'ok' : al.importInfo && !al.importInfo.ok ? 'error' : 'pending'} />
              <span className="flex-1 text-sm font-medium text-slate-100">2. Import probe results</span>
            </div>
            <p className="pl-[26px] text-[11px] text-slate-500">
              After running it, load the file your controller wrote (.txt, .csv, .log…).
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="ml-[26px]"
              data-testid="probe-import"
              onClick={() => void importProbeResults()}
            >
              <Upload /> {map ? 'Import new results…' : 'Import probe results…'}
            </Button>
            {al.importInfo && (
              <div className="ml-[26px] flex flex-col gap-0.5 text-[11px]">
                <span className="text-slate-400">
                  <span className="text-slate-300">{al.importInfo.fileName}</span> · detected:{' '}
                  {FORMAT_LABELS[al.importInfo.format] ?? al.importInfo.format}
                </span>
                {al.importInfo.warnings.slice(0, 4).map((w, i) => (
                  <span key={i} className="flex gap-1 text-amber-300/90">
                    <AlertTriangle className="mt-px size-3 shrink-0" /> {w}
                  </span>
                ))}
                {al.importInfo.warnings.length > 4 && (
                  <span className="text-slate-500">…and {al.importInfo.warnings.length - 4} more notes</span>
                )}
              </div>
            )}
          </li>
        </ol>

        <div data-testid="apply-heightmap" className="rounded-lg border border-slate-800 p-2">
          <Switch
            label="Apply height-map correction to exported files"
            checked={al.apply && !!map}
            disabled={!map}
            onChange={(v) => al.set({ apply: v })}
            description={
              map
                ? 'Raises or lowers every cutting move to follow the measured surface.'
                : 'Available after you import probe results.'
            }
            help="Every saved file is rewritten so its Z follows the height map: long moves are split into 1 mm pieces and each piece gets the measured height added. The original design is not changed."
          />
          {map && al.apply && (
            <div className="mt-2 flex flex-col gap-0.5 text-[11px]">
              <span className="flex items-center gap-1 text-emerald-300">
                <Mountain className="size-3" /> Z adjusted in {levelled.length} of {files.length} file
                {files.length === 1 ? '' : 's'}
              </span>
              {files
                .filter((f) => f.levelSkip)
                .map((f) => (
                  <span key={f.file.name} className="truncate text-amber-300/90" title={f.levelSkip ?? ''}>
                    skipped: {f.file.name}
                  </span>
                ))}
            </div>
          )}
        </div>

        {map && (
          <Button
            size="sm"
            variant="ghost"
            className="self-start text-rose-300 hover:text-rose-200"
            onClick={() => {
              setHeightMap(null)
              al.set({ apply: false, importInfo: null })
            }}
          >
            <Trash2 /> Remove height map
          </Button>
        )}
      </div>
    </PanelSection>
  )
}
