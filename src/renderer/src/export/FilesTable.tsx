import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Clock,
  Download,
  Eye,
  FileCode2,
  FlipVertical2,
  HardDrive,
  Loader2,
  Mountain,
  RefreshCw,
  Save
} from 'lucide-react'
import type { CamStep, Tool } from '@core/model/types'
import { STEP_KIND_INFO } from '@core/cam'
import { Button } from '@renderer/components/ui/button'
import { HelpTip } from '@renderer/components/ui/help'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { cn, formatBytes, formatDuration } from '@renderer/lib/utils'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { regenerate } from '@renderer/store/controller'
import { GcodePreviewDialog } from './GcodePreviewDialog'
import { saveMany, saveOne, type ExportFile } from './exportFiles'

function SideBadge({ side }: { side: 'top' | 'bottom' }): React.JSX.Element {
  return (
    <span
      className={cn(
        'rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide',
        side === 'top' ? 'bg-rose-500/15 text-rose-300' : 'bg-indigo-500/20 text-indigo-300'
      )}
    >
      {side}
    </span>
  )
}

function Contents({
  f,
  steps,
  tools
}: {
  f: ExportFile
  steps: CamStep[]
  tools: Tool[]
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {f.file.stepIds.map((id) => {
          const s = steps.find((x) => x.id === id)
          if (!s) return null
          return (
            <Tooltip key={id} content={STEP_KIND_INFO[s.kind]?.description}>
              <span className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[11px] text-slate-200">
                {s.name}
                <SideBadge side={s.side} />
              </span>
            </Tooltip>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-1">
        {f.file.toolIds.map((id) => {
          const t = tools.find((x) => x.id === id)
          return (
            <span
              key={id}
              className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-200"
              title="The bit (tool) you must put in the machine for this file"
            >
              T{t?.number ?? '?'} · {t?.name ?? 'unknown tool'}
            </span>
          )
        })}
      </div>
      {f.sides.includes('bottom') && (
        <div className="flex items-center gap-1 text-[11px] font-medium text-indigo-300">
          <FlipVertical2 className="size-3.5" />
          {f.sides.length > 1
            ? 'The program pauses so you can flip the board half-way through.'
            : 'Flip the board (bottom side up, onto the pins) before running this file.'}
        </div>
      )}
      {f.levelled && (
        <div className="flex items-center gap-1 text-[11px] text-emerald-300">
          <Mountain className="size-3.5" /> Z adjusted to the measured height map
          {f.touchOff && ' · finds Z0 with the probe at point 1 before each bit'}
        </div>
      )}
      {f.levelSkip && (
        <div className="flex items-center gap-1 text-[11px] text-amber-300">
          <AlertTriangle className="size-3.5" /> Not height-corrected: {f.levelSkip}
        </div>
      )}
    </div>
  )
}

export function FilesTable({
  files,
  levelling,
  levelError
}: {
  files: ExportFile[]
  levelling: boolean
  levelError: string | null
}): React.JSX.Element {
  const cam = useUi((s) => s.cam)
  const stale = useUi((s) => s.camStale)
  const generating = useUi((s) => s.generating)
  const camError = useUi((s) => s.camError)
  const toast = useUi((s) => s.toast)
  const steps = useProject((s) => s.steps)
  const tools = useProject((s) => s.tools)
  const [preview, setPreview] = useState<ExportFile | null>(null)

  const totals = useMemo(
    () => ({
      seconds: files.reduce((a, f) => a + f.file.estimatedSeconds, 0),
      bytes: files.reduce((a, f) => a + f.sizeBytes, 0)
    }),
    [files]
  )

  const errors = useMemo(
    () =>
      (cam?.validations ?? []).filter(
        (v) => v.level === 'error' && steps.find((s) => s.id === v.stepId)?.enabled
      ),
    [cam, steps]
  )

  const busy = levelling || generating
  const saveAll = async (): Promise<void> => {
    const r = await saveMany(files.map((f) => ({ name: f.file.name, text: f.text })))
    if (r === null) return
    toast(
      'success',
      typeof r === 'string' ? `Saved ${files.length} file(s) to ${r}` : `Downloading ${files.length} file(s)…`
    )
  }
  const saveSingle = async (f: ExportFile): Promise<void> => {
    if (await saveOne(f.file.name, f.text)) toast('success', `Saved ${f.file.name}`)
  }

  if (!cam?.files.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
        <FileCode2 className="size-10 text-slate-600" />
        <div className="text-base font-semibold text-slate-200">
          {generating ? 'Generating G-code…' : 'No G-code files yet'}
        </div>
        <p className="max-w-md text-sm text-slate-400">
          G-code is the list of instructions your machine follows. TraceMill writes it from the steps you set
          up in Manufacture.{' '}
          {stale ? 'Something changed since the last generation, so it needs to be generated again.' : ''}
        </p>
        {camError && <p className="max-w-md text-sm text-rose-400">Last attempt failed: {camError}</p>}
        <Button onClick={() => void regenerate()} disabled={generating}>
          {generating ? <Loader2 className="animate-spin" /> : <RefreshCw />} Generate now
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-100">Your G-code files</h2>
          <p className="text-xs text-slate-400">
            Load these into your machine’s control software one after another, top to bottom.
          </p>
        </div>
        <Button
          size="lg"
          variant="success"
          data-testid="export-save-all"
          disabled={busy || !files.length}
          onClick={() => void saveAll()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Save />}
          Save {files.length} G-code file{files.length === 1 ? '' : 's'}
          {files.some((f) => f.levelled) && ' (height-corrected)'}
        </Button>
      </div>

      {stale && (
        <div className="flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
          {generating ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          <span className="flex-1">
            {generating
              ? 'Updating the files with your latest changes…'
              : 'Settings changed since these files were made. Regenerate them before saving.'}
          </span>
          {!generating && (
            <Button size="sm" onClick={() => void regenerate()}>
              Generate now
            </Button>
          )}
        </div>
      )}
      {errors.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-semibold">
              {errors.length} step{errors.length === 1 ? ' has' : 's have'} errors – the files below may be
              incomplete.
            </div>
            <div className="text-xs text-rose-300/90">
              Affected: {errors.map((v) => steps.find((s) => s.id === v.stepId)?.name ?? v.stepId).join(', ')}
              . Fix them in the Manufacture section first.
            </div>
          </div>
        </div>
      )}
      {levelError && (
        <div className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          Height-map correction failed: {levelError}. Files are shown without correction.
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm" data-testid="export-table">
          <thead className="bg-slate-900 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2">#</th>
              <th className="min-w-[200px] px-3 py-2">File name</th>
              <th className="px-3 py-2">
                <span className="flex items-center gap-1">
                  What it does
                  <HelpTip title="What it does">
                    The milling steps inside the file (with the board side they work on) and the bit (tool)
                    you must insert before you start it.
                  </HelpTip>
                </span>
              </th>
              <th className="px-3 py-2 text-right">
                <span className="inline-flex items-center gap-1">
                  <HardDrive className="size-3" /> Size
                </span>
              </th>
              <th className="px-3 py-2 text-right">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" /> Time
                  <HelpTip title="Estimated time">
                    A rough estimate of how long the machine will run this file. Real machines are often a bit
                    slower because they accelerate and slow down at corners.
                  </HelpTip>
                </span>
              </th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className={cn('divide-y divide-slate-800', stale && 'opacity-60')}>
            {files.map((f, i) => (
              <tr
                key={f.file.name}
                data-testid="export-row"
                className="bg-slate-950/40 align-top hover:bg-slate-900/60"
              >
                <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{i + 1}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5 font-mono text-[12px] text-slate-100">
                    <FileCode2 className="size-4 shrink-0 text-sky-400" />
                    <span className="break-all">{f.file.name}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <Contents f={f} steps={steps} tools={tools} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-slate-300">
                  {formatBytes(f.sizeBytes)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-slate-300">
                  {formatDuration(f.file.estimatedSeconds)}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setPreview(f)} disabled={busy}>
                      <Eye /> Preview
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void saveSingle(f)} disabled={busy}>
                      <Download /> Save
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-900/80 text-xs text-slate-300">
            <tr>
              <td />
              <td className="px-3 py-2 font-semibold" colSpan={2}>
                Total · {files.length} file{files.length === 1 ? '' : 's'}
                {levelling && (
                  <span className="ml-2 inline-flex items-center gap-1 font-normal text-sky-300">
                    <Loader2 className="size-3 animate-spin" /> applying height map…
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right font-mono">{formatBytes(totals.bytes)}</td>
              <td className="px-3 py-2 text-right font-mono">{formatDuration(totals.seconds)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {preview && (
        <GcodePreviewDialog
          open
          onOpenChange={(o) => !o && setPreview(null)}
          name={preview.file.name}
          text={preview.text}
          note={preview.levelled ? 'Includes the height-map Z correction.' : undefined}
          onSave={() => void saveSingle(preview)}
        />
      )}
    </div>
  )
}
