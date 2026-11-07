import { useEffect, useState } from 'react'
import { AlertTriangle, Cpu, Info } from 'lucide-react'
import type { ExportGrouping, ProbeGridConfig } from '@core/model/types'
import { HELP } from '@core/help'
import { PROBE_RECOMMENDED_BELOW, maxIsolationDepth } from '@core/cam'
import { Button } from '@renderer/components/ui/button'
import { useJobClearance } from '@renderer/steps/IsolationAdvice'
import { PanelSection } from '@renderer/components/ui/section'
import { Switch } from '@renderer/components/ui/fields'
import { HelpTip } from '@renderer/components/ui/help'
import { StatusCircle } from '@renderer/components/ui/status'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { scheduleRegenerate, useStageStatus } from '@renderer/store/controller'
import { GroupingCards } from '@renderer/export/GroupingCards'
import { FilesTable } from '@renderer/export/FilesTable'
import { useExportFiles } from '@renderer/export/exportFiles'
import { AutoLevelSection } from '@renderer/heightmap/AutoLevelSection'
import { HeightMapDialog } from '@renderer/heightmap/HeightMapDialog'
import { ProbeDialog } from '@renderer/heightmap/ProbeDialog'
import { PROBE_CFG_SETTINGS_KEY, useAutoLevel } from '@renderer/heightmap/state'

const POST_LABELS: Record<string, string> = {
  mach3: 'Mach3 / Mach4',
  grbl: 'GRBL',
  linuxcnc: 'LinuxCNC',
  generic: 'Generic G-code'
}

function MachineSummary(): React.JSX.Element | null {
  const machine = useProject((s) => s.machine)
  const grouping = useProject((s) => s.settings.exportGrouping)
  if (!machine) return null
  const ext = (machine.fileExtension || 'nc').replace(/^\.+/, '')
  const rows: [string, string, string][] = [
    ['Machine', machine.name, 'The machine profile chosen in the Manufacture section.'],
    [
      'Output format',
      POST_LABELS[machine.postProcessor] ?? machine.postProcessor,
      'The G-code “dialect” your control software understands. Every controller speaks a slightly different flavour.'
    ],
    [
      'Units',
      machine.outputUnits === 'mm' ? 'millimetres (G21)' : 'inches (G20)',
      'Units used for numbers in the file.'
    ],
    [
      'File extension',
      `.${ext}`,
      'The ending of the saved file names, so your control software recognises them.'
    ],
    [
      'Bit changes',
      machine.supportsToolChange ? 'automatic (M6)' : 'manual – program pauses',
      'Whether the machine can swap bits by itself. Without a tool changer the program stops and waits for you.'
    ]
  ]
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
        <Cpu className="size-3.5" /> Files are written for
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-[11px]">
        {rows.map(([k, v, h]) => (
          <div key={k} className="contents">
            <dt className="flex items-center gap-1 text-slate-500">
              {k}
              <HelpTip title={k}>{h}</HelpTip>
            </dt>
            <dd className="truncate text-slate-200" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {!machine.supportsToolChange && grouping === 'combined' && (
        <p className="flex gap-1 text-[11px] text-sky-300/90">
          <Info className="mt-px size-3 shrink-0" />
          Your machine changes bits by hand: the single file pauses at every bit change. Set Z zero again on
          the copper (at point 1 if you auto-level) before continuing.
        </p>
      )}
    </div>
  )
}

/** Probe Z0 before each bit in files that are not height-corrected (no probing of the board needed). */
function ProbeZeroSwitch(): React.JSX.Element {
  const probeZero = useAutoLevel((s) => s.probeZero)
  const set = useAutoLevel((s) => s.set)
  return (
    <div data-testid="probe-zero" className="flex flex-col gap-1">
      <Switch
        label="Find Z zero with the probe before each bit"
        checked={probeZero}
        onChange={(v) => set({ probeZero: v })}
        helpWide
        help={
          <>
            For a probe clip on the bit and the copper – no height map needed. Each file stops before every
            bit: you set Z zero <b>roughly</b> (a sheet of paper), clip the probe on and press Start. The bit
            touches the copper very slowly (F2) near the corner of the board – the same place as point 1 of
            the probe grid – sets Z0 there and stops so you can remove the clip. Files corrected with a height
            map use the setting in Auto-level step 3 instead.
          </>
        }
      />
    </div>
  )
}

/** Narrow gaps cannot be milled on an unprobed board: say so before the files are saved (D-031). */
function ProbeAdvice({ onGenerate }: { onGenerate: () => void }): React.JSX.Element | null {
  const map = useProject((s) => s.heightMap)
  const info = useJobClearance()
  const c = info?.clearance ?? null
  if (map || c === null || c >= PROBE_RECOMMENDED_BELOW) return null
  return (
    <div
      className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] leading-snug text-amber-100"
      data-testid="probe-advice"
    >
      <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-300" />
      <div className="flex flex-col gap-1.5">
        <span>
          <b>Probe the board first.</b> The narrowest copper gaps are {c} mm, so the isolation cuts only{' '}
          {maxIsolationDepth(c)} mm deep – a board that is a few hundredths of a millimetre out of flat (they
          all are) is cut too deep in one corner and not at all in another. Gaps of 0.2–0.8 mm cannot be
          milled reliably without auto-levelling.
        </span>
        <Button size="sm" variant="secondary" className="self-start" onClick={onGenerate}>
          Make the probe program…
        </Button>
      </div>
    </div>
  )
}

export function ExportStage(): React.JSX.Element {
  const grouping = useProject((s) => s.settings.exportGrouping)
  const setSettings = useProject((s) => s.setSettings)
  const stale = useUi((s) => s.camStale)
  const status = useStageStatus()
  const [probeOpen, setProbeOpen] = useState(false)
  const { files, levelling, levelError } = useExportFiles()

  // Restore the last saved probe grid (desktop app) so results can be aligned after a restart.
  useEffect(() => {
    if (!window.tracemill || useAutoLevel.getState().probeCfg) return
    void window.tracemill
      .settingsGet<{ cfg: ProbeGridConfig; side: 'top' | 'bottom' } | null>(PROBE_CFG_SETTINGS_KEY, null)
      .then((v) => {
        if (v?.cfg && !useAutoLevel.getState().probeCfg) useAutoLevel.getState().set({ probeCfg: v.cfg })
      })
      .catch(() => undefined)
  }, [])

  const setGrouping = (g: ExportGrouping): void => {
    if (g === grouping) return
    setSettings({ exportGrouping: g })
    scheduleRegenerate(true)
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-slate-800 bg-slate-900/40">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PanelSection
            title="Export"
            status={
              <StatusCircle level={stale ? 'pending' : status.export} size={14} title="Export status" />
            }
            actions={
              <HelpTip title={HELP['export.grouping']?.title}>{HELP['export.grouping']?.body}</HelpTip>
            }
          >
            <div className="flex flex-col gap-3">
              <p className="text-[11px] leading-snug text-slate-400">
                Choose how the G-code is split into files. It doesn’t change what the machine does – only how
                many files you load.
              </p>
              <GroupingCards value={grouping} onChange={setGrouping} />
              <MachineSummary />
              <ProbeZeroSwitch />
            </div>
          </PanelSection>
        </div>
      </aside>
      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 p-5">
          <AutoLevelSection
            wide
            title="1. Probe the board (auto-level)"
            files={files}
            levelling={levelling}
            onGenerate={() => setProbeOpen(true)}
          >
            <ProbeAdvice onGenerate={() => setProbeOpen(true)} />
          </AutoLevelSection>
          <FilesTable files={files} levelling={levelling} levelError={levelError} />
        </div>
      </section>
      <ProbeDialog open={probeOpen} onOpenChange={setProbeOpen} />
      <HeightMapDialog />
    </div>
  )
}
