/**
 * Step editor: one dialog for adding and editing a CAM step. Split into sections (Layer, Tool,
 * General, <kind> parameters, Results); each section gets a status circle computed from validateStep.
 */
import { useMemo, useRef } from 'react'
import type { CamStep, ValidationIssue } from '@core/model/types'
import { STEP_KIND_INFO, validateStep } from '@core/cam'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { showProblems } from '@renderer/store/controller'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { StatusCircle, type StatusLevel } from '@renderer/components/ui/status'
import { cn } from '@renderer/lib/utils'
import { useStepEditor } from './editorStore'
import { GeneralSection, LayerSection, ResultsSection, ToolSection } from './editorSections'
import { ParamsSection } from './paramsSection'
import { IssueList } from './IssueList'
import { PARAMS_TITLE, stepIcon, summarize, useValidationCtx } from './stepUtils'

type SectionId = ValidationIssue['section']

export function StepEditorDialog(): React.JSX.Element {
  const draft = useStepEditor((s) => s.draft)
  const close = useStepEditor((s) => s.close)
  return (
    <Dialog
      open={!!draft}
      onOpenChange={(o) => !o && close()}
      title={draft ? <DialogTitle draft={draft} /> : 'Step'}
      description={draft ? STEP_KIND_INFO[draft.kind].description : undefined}
      className="h-[90vh] w-[min(96vw,1120px)]"
      footer={draft ? <Footer draft={draft} /> : undefined}
    >
      {draft && <Body draft={draft} />}
    </Dialog>
  )
}

function DialogTitle({ draft }: { draft: CamStep }): React.JSX.Element {
  const isNew = useStepEditor((s) => s.isNew)
  const Icon = stepIcon(draft.kind)
  return (
    <span className="flex items-center gap-2">
      <Icon className="size-5 text-sky-400" />
      {isNew ? 'New step: ' : 'Edit step: '}
      {STEP_KIND_INFO[draft.kind].label}
    </span>
  )
}

/** Section statuses of the draft (live validation + results warnings of the last CAM run). */
function useDraftStatus(draft: CamStep): {
  bySection: Record<SectionId, { level: StatusLevel; issues: ValidationIssue[] }>
  errors: number
  warnings: number
  hasToolpath: boolean
} {
  const ctx = useValidationCtx()
  const cam = useUi((s) => s.cam)
  return useMemo(() => {
    const live = ctx ? validateStep(draft, ctx).issues : []
    const results =
      cam?.validations.find((v) => v.stepId === draft.id)?.issues.filter((i) => i.section === 'results') ?? []
    const hasToolpath = !!cam?.toolpaths.some((t) => t.stepId === draft.id)
    const all = [...live, ...results]
    const ids: SectionId[] = ['layer', 'tool', 'general', 'params', 'results']
    const bySection = Object.fromEntries(
      ids.map((id) => {
        const issues = all.filter((i) => i.section === id)
        let level: StatusLevel = ctx ? summarize(issues).level : 'pending'
        if (id === 'results' && !issues.length) level = hasToolpath && draft.enabled ? 'ok' : 'pending'
        return [id, { level, issues }]
      })
    ) as Record<SectionId, { level: StatusLevel; issues: ValidationIssue[] }>
    const s = summarize(all)
    return { bySection, errors: s.errors, warnings: s.warnings, hasToolpath }
  }, [draft, ctx, cam])
}

function Body({ draft }: { draft: CamStep }): React.JSX.Element {
  const update = useStepEditor((s) => s.update)
  const close = useStepEditor((s) => s.close)
  const saved = useProject((s) => s.steps.find((x) => x.id === draft.id))
  const cam = useUi((s) => s.cam)
  const camStale = useUi((s) => s.camStale)
  const status = useDraftStatus(draft)
  const scrollRef = useRef<HTMLDivElement>(null)
  const refs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({})
  const toolpath = cam?.toolpaths.find((t) => t.stepId === draft.id)
  const changed = !saved || JSON.stringify(saved) !== JSON.stringify(draft)

  const sections: { id: SectionId; title: string; hint: string }[] = [
    { id: 'layer', title: 'Layer', hint: 'What to work on' },
    { id: 'tool', title: 'Tool', hint: 'Which bit to use' },
    { id: 'general', title: 'General', hint: 'Name, side, depth' },
    { id: 'params', title: PARAMS_TITLE[draft.kind], hint: 'How to cut' },
    { id: 'results', title: 'Results', hint: 'Time and length' }
  ]

  const editMaterial = (): void => {
    save(draft)
    // The material section sits at the top of the left panel.
    document.querySelector('[data-testid="manufacture-left"]')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="flex h-full gap-4" data-testid="step-dialog">
      <nav className="flex w-44 shrink-0 flex-col gap-1">
        {sections.map((s, i) => {
          const st = status.bySection[s.id]
          const e = st.issues.filter((x) => x.level === 'error').length
          const w = st.issues.filter((x) => x.level === 'warning').length
          return (
            <button
              key={s.id}
              type="button"
              data-testid={`step-section-${s.id}`}
              onClick={() => refs.current[s.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors hover:bg-slate-800/60',
                st.level === 'error'
                  ? 'border-rose-500/40'
                  : st.level === 'warning'
                    ? 'border-amber-500/30'
                    : 'border-slate-800'
              )}
            >
              <StatusCircle level={st.level} size={20} title={`${s.title}: ${st.level}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-slate-200">
                  {i + 1}. {s.title}
                </span>
                <span className="block truncate text-[10px] text-slate-500">
                  {e || w
                    ? [e && `${e} error${e > 1 ? 's' : ''}`, w && `${w} warning${w > 1 ? 's' : ''}`]
                        .filter(Boolean)
                        .join(', ')
                    : s.hint}
                </span>
              </span>
            </button>
          )
        })}
      </nav>
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto pr-1">
        {sections.map((s, i) => {
          const st = status.bySection[s.id]
          return (
            <section
              key={s.id}
              ref={(el) => void (refs.current[s.id] = el)}
              className="mb-4 scroll-mt-1 rounded-xl border border-slate-800 bg-slate-900/60 p-4"
            >
              <header className="mb-3 flex items-center gap-2">
                <StatusCircle level={st.level} size={20} />
                <h3 className="text-sm font-semibold text-slate-100">
                  {i + 1}. {s.title}
                </h3>
              </header>
              <IssueList
                issues={st.issues}
                className="mb-3"
                onShowOnBoard={() => {
                  close()
                  showProblems(draft.id)
                }}
              />
              {s.id === 'layer' && <LayerSection draft={draft} update={update} issues={st.issues} />}
              {s.id === 'tool' && <ToolSection draft={draft} update={update} issues={st.issues} />}
              {s.id === 'general' && <GeneralSection draft={draft} update={update} issues={st.issues} />}
              {s.id === 'params' && (
                <ParamsSection
                  draft={draft}
                  update={update}
                  issues={st.issues}
                  onEditMaterial={editMaterial}
                />
              )}
              {s.id === 'results' && (
                <ResultsSection draft={draft} toolpath={toolpath} stale={changed || camStale} />
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** Commits the draft to the project. New steps go before a trailing cutout (cutout must stay last). */
function save(draft: CamStep): void {
  const p = useProject.getState()
  const exists = p.steps.some((s) => s.id === draft.id)
  if (exists) p.upsertStep(draft)
  else {
    const steps = [...p.steps]
    let at = steps.length
    if (draft.kind !== 'cutout') while (at > 0 && steps[at - 1].kind === 'cutout') at--
    steps.splice(at, 0, draft)
    p.setSteps(steps)
  }
  useUi.getState().set({ selectedStepId: draft.id })
  useStepEditor.getState().close()
}

function Footer({ draft }: { draft: CamStep }): React.JSX.Element {
  const close = useStepEditor((s) => s.close)
  const isNew = useStepEditor((s) => s.isNew)
  const { errors, warnings, bySection, hasToolpath } = useDraftStatus(draft)
  const ready = errors === 0 && warnings === 0
  const level: StatusLevel = errors ? 'error' : warnings ? 'warning' : 'ok'
  return (
    <>
      <div className="mr-auto flex items-center gap-2" data-testid="step-summary">
        <StatusCircle level={level} size={24} />
        <div className="leading-tight">
          <div
            className={cn(
              'text-sm font-semibold',
              ready ? 'text-emerald-400' : errors ? 'text-rose-400' : 'text-amber-400'
            )}
          >
            {ready
              ? 'Ready ✓'
              : [
                  errors && `${errors} error${errors > 1 ? 's' : ''}`,
                  warnings && `${warnings} warning${warnings > 1 ? 's' : ''}`
                ]
                  .filter(Boolean)
                  .join(', ')}
          </div>
          <div className="text-[11px] text-slate-500">
            {errors
              ? 'Not ready: this step will not produce a toolpath until the errors are fixed. You can still save it.'
              : warnings
                ? 'Can be generated, but check the warnings.'
                : bySection.results.level === 'pending' && !hasToolpath
                  ? 'All sections are OK. Time and length are calculated after saving.'
                  : 'All sections are OK.'}
          </div>
        </div>
      </div>
      <Button variant="ghost" onClick={close} data-testid="step-cancel">
        Cancel
      </Button>
      <Button variant={errors ? 'secondary' : 'success'} onClick={() => save(draft)} data-testid="step-save">
        {isNew ? 'Add step' : 'Save'}
        {errors ? ' (not ready)' : ''}
      </Button>
    </>
  )
}
