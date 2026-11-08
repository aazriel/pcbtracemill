import { useEffect } from 'react'
import { FilePlus2, FolderOpen, HelpCircle, Redo2, Save, Undo2, Loader2 } from 'lucide-react'
import type { EdaTool } from '@core/model/types'
import { TooltipProvider, Tooltip } from '@renderer/components/ui/tooltip'
import { Button } from '@renderer/components/ui/button'
import { Segmented } from '@renderer/components/ui/fields'
import { Toasts } from '@renderer/components/Toasts'
import { Stepper } from '@renderer/layout/Stepper'
import { EdaDialog } from '@renderer/layers/EdaDialog'
import { DuplicateDialog } from '@renderer/layers/DuplicateDialog'
import { FolderBrowserDialog } from '@renderer/layers/FolderBrowserDialog'
import { RestoreDialog } from '@renderer/layers/RestoreDialog'
import { NewProjectDialog } from '@renderer/layers/NewProjectDialog'
import { checkLastSession } from '@renderer/store/session'
import { setAdvancedSkip } from '@renderer/steps/SkipSection'
import { Tour, maybeShowTour, openTour } from '@renderer/components/Tour'
import { HelpDialog } from '@renderer/components/HelpDialog'
import { useProject, useTemporal } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import {
  browseAndImport,
  cancelEdaChoice,
  canEnterStage,
  changeEda,
  ensureDefaults,
  addUserTools,
  newProject,
  openProject,
  redo,
  resolveDuplicates,
  resolveEda,
  saveProject,
  undo,
  useBoardHint,
  useStageStatus,
  analyzeCopperLayers
} from '@renderer/store/controller'
import { loadUserTools } from '@renderer/tools/toolLibrary'
import { loadProjectNames } from '@renderer/store/projectNames'
import { UNNAMED_PROJECT } from '@core/project'
import { BoardStage } from '@renderer/stages/BoardStage'
import { ManufactureStage } from '@renderer/stages/ManufactureStage'
import { SimulationStage } from '@renderer/stages/SimulationStage'
import { ExportStage } from '@renderer/stages/ExportStage'

export function App(): React.JSX.Element {
  const stage = useUi((s) => s.stage)
  const setUi = useUi((s) => s.set)
  const pending = useUi((s) => s.pendingImport)
  const pendingBrowse = useUi((s) => s.pendingBrowse)
  const duplicates = useUi((s) => s.pendingDuplicates)
  const helpOpen = useUi((s) => s.helpOpen)
  const helpTopic = useUi((s) => s.helpTopic)
  const eda = useProject((s) => s.settings.edaTool)
  const units = useProject((s) => s.settings.units ?? 'mm')
  const setSettings = useProject((s) => s.setSettings)
  const boardHint = useBoardHint()
  const generating = useUi((s) => s.generating)
  const advancedSkip = useUi((s) => s.advancedSkip)
  const name = useProject((s) => s.name)
  const dirty = useProject((s) => s.dirty)
  const setName = useProject((s) => s.setName)
  const status = useStageStatus()
  const canUndo = useTemporal((s) => s.pastStates.length > 0)
  const canRedo = useTemporal((s) => s.futureStates.length > 0)
  // re-render when stage availability changes
  useProject((s) => s.layers.length)
  // measure the copper spacing of every copper layer in the background (D-031)
  const parsedVersion = useProject((s) => s.parsedVersion)
  const copperKey = useProject((s) =>
    s.layers
      .filter((l) => l.type === 'copper')
      .map((l) => l.id)
      .join(',')
  )
  useEffect(() => analyzeCopperLayers(), [parsedVersion, copperKey])
  useUi((s) => s.cam)

  useEffect(() => {
    ensureDefaults()
    void loadUserTools().then(addUserTools)
    void loadProjectNames()
    // first start: the tour (there is no last session yet); afterwards: offer the last session
    void maybeShowTour()
    void checkLastSession()
    void window.tracemill
      ?.settingsGet<boolean>('advancedSkip', false)
      .then((v) => useUi.getState().set({ advancedSkip: !!v }))
    const off = window.tracemill?.onMenu((cmd) => {
      if (cmd === 'new-project') newProject()
      else if (cmd === 'open-project') void openProject()
      else if (cmd === 'save-project') void saveProject()
      else if (cmd === 'save-project-as') void saveProject(true)
      else if (cmd === 'import-files') void browseAndImport(false)
      else if (cmd === 'import-folder') void browseAndImport(true)
      else if (cmd === 'undo') undo()
      else if (cmd === 'redo') redo()
      else if (cmd === 'tour') openTour()
      else if (cmd === 'toggle-advanced-skip') setAdvancedSkip(!useUi.getState().advancedSkip)
      else if (cmd === 'help') useUi.getState().set({ helpOpen: true, helpTopic: 'start' })
      else if (cmd === 'shortcuts') useUi.getState().set({ helpOpen: true, helpTopic: 'shortcuts' })
      else if (cmd === 'about') useUi.getState().set({ helpOpen: true, helpTopic: 'about' })
      else if (cmd.startsWith('set-eda:')) void changeEda(cmd.slice('set-eda:'.length) as EdaTool)
      else if (cmd === 'set-units:mm' || cmd === 'set-units:inch')
        useProject.getState().setSettings({ units: cmd === 'set-units:inch' ? 'inch' : 'mm' })
    })
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, .monaco-editor')) return
      const mod = e.ctrlKey || e.metaKey
      if (e.key === 'F1' && !window.tracemill) {
        e.preventDefault()
        useUi.getState().set({ helpOpen: true, helpTopic: 'start' })
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      } else if (mod && e.key.toLowerCase() === 's' && !window.tracemill) {
        e.preventDefault()
        void saveProject()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off?.()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${name} — TraceMill`
  }, [name, dirty])

  // Keep the Settings menu showing the current design program.
  useEffect(() => {
    window.tracemill?.setMenuState({ eda, units, advancedSkip })
  }, [eda, units, advancedSkip])

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-slate-800 bg-slate-900/80 px-3">
          <div className="flex items-center gap-2">
            <img src="./icon.svg" alt="" className="size-7" />
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-wide">TraceMill</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-48 rounded bg-transparent text-xs font-semibold text-sky-200 outline-none hover:bg-slate-800/60 focus:bg-slate-800 focus:text-white"
                aria-label="Project name"
                title="Project name (used for file names)"
              />
            </div>
          </div>
          <div className="flex flex-1 justify-center">
            <Stepper
              stage={stage}
              status={status}
              onSelect={(s) => setUi({ stage: s })}
              canEnter={canEnterStage}
              hints={{ board: boardHint }}
            />
          </div>
          <div className="flex items-center gap-1">
            {generating && (
              <span className="mr-2 flex items-center gap-1 text-xs text-sky-300" data-testid="generating">
                <Loader2 className="size-3.5 animate-spin" /> Generating…
              </span>
            )}
            <Tooltip
              content="Units for every size, distance and feed in the app (also in Settings). Values are converted, nothing changes on the board."
              side="bottom"
            >
              <div className="mr-1" data-testid="units-toggle">
                <Segmented
                  size="sm"
                  value={units}
                  onChange={(v) => setSettings({ units: v })}
                  options={[
                    { value: 'mm', label: 'mm' },
                    { value: 'inch', label: 'in' }
                  ]}
                />
              </div>
            </Tooltip>
            <Tooltip content="Help: how TraceMill works, shortcuts and a glossary (F1)" side="bottom">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setUi({ helpOpen: true, helpTopic: helpTopic ?? 'start' })}
                aria-label="Help"
                data-testid="open-help"
              >
                <HelpCircle />
              </Button>
            </Tooltip>
            <Tooltip content="Undo (Ctrl+Z)" side="bottom">
              <Button size="icon" variant="ghost" onClick={undo} disabled={!canUndo} aria-label="Undo">
                <Undo2 />
              </Button>
            </Tooltip>
            <Tooltip content="Redo (Ctrl+Shift+Z)" side="bottom">
              <Button size="icon" variant="ghost" onClick={redo} disabled={!canRedo} aria-label="Redo">
                <Redo2 />
              </Button>
            </Tooltip>
            <Tooltip content="New project" side="bottom">
              <Button size="icon" variant="ghost" onClick={newProject} aria-label="New project">
                <FilePlus2 />
              </Button>
            </Tooltip>
            <Tooltip content="Open a saved TraceMill project (.tmill)" side="bottom">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void openProject()}
                aria-label="Open project"
              >
                <FolderOpen />
              </Button>
            </Tooltip>
            <Tooltip
              content="Save the project (.tmill) – keeps layers, machine, material, tools and steps"
              side="bottom"
            >
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void saveProject()}
                aria-label="Save project"
              >
                <Save />
              </Button>
            </Tooltip>
          </div>
        </header>
        <main className="min-h-0 flex-1">
          {stage === 'board' && <BoardStage />}
          {stage === 'manufacture' && <ManufactureStage />}
          {stage === 'simulation' && <SimulationStage />}
          {stage === 'export' && <ExportStage />}
        </main>
        <EdaDialog
          open={!!pending || !!pendingBrowse}
          current={eda}
          beforeBrowse={!!pendingBrowse}
          askName={name === UNNAMED_PROJECT}
          onPick={(e, n) => void resolveEda(e, n)}
          onClose={cancelEdaChoice}
        />
        <DuplicateDialog pending={duplicates} onResolve={resolveDuplicates} />
        <FolderBrowserDialog />
        <RestoreDialog />
        <NewProjectDialog />
        <Tour />
        <HelpDialog
          open={helpOpen}
          topic={helpTopic}
          onTopic={(t) => setUi({ helpTopic: t })}
          onClose={() => setUi({ helpOpen: false })}
        />
        <Toasts />
      </div>
    </TooltipProvider>
  )
}
