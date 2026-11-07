import { useMemo, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  ChevronDown,
  Copy,
  Info,
  Library,
  Plus,
  Save,
  Search,
  Trash2,
  Undo2,
  Wrench
} from 'lucide-react'
import type { StepKind, Tool, ToolType } from '@core/model/types'
import { createTool, duplicateTool, TOOL_TYPE_INFO, validateTool } from '@core/tools'
import { isToolAllowed, STEP_KIND_INFO, toolsForStep } from '@core/cam'
import { useProject } from '@renderer/store/project'
import { useUi } from '@renderer/store/ui'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { HelpTip } from '@renderer/components/ui/help'
import { cn, uid } from '@renderer/lib/utils'
import { ToolCard } from './ToolCard'
import { ToolEditor } from './ToolEditor'
import { forgetTool, rememberTool } from './toolLibrary'
import {
  defaultToolName,
  nextToolNumber,
  sameTool,
  stepNeedsText,
  TOOL_NOUN,
  TOOL_TABS,
  TOOL_TYPES,
  typeList,
  type ToolTab
} from './toolMeta'

export interface ToolLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the library is in "pick a tool for this step" mode: only compatible tools can be chosen. */
  stepKind?: StepKind | null
  selectedToolId?: string | null
  /** Called when the user picks a tool (double-click or "Use this tool"). The dialog closes itself. */
  onSelect?: (toolId: string) => void
}

/** Full-size tool library: browse by type, create / duplicate / edit / delete tools, pick one for a step. */
export function ToolLibraryDialog(props: ToolLibraryDialogProps): React.JSX.Element | null {
  // Mount the body only while open so every opening starts from fresh state.
  if (!props.open) return null
  return <ToolLibraryBody {...props} />
}

type Confirm =
  { kind: 'unsaved'; proceed: () => void } | { kind: 'delete'; tool: Tool; usedBy: string[] } | null

const cloneTool = (t: Tool): Tool => ({ ...t, geometry: { ...t.geometry }, feeds: { ...t.feeds } })

function ToolLibraryBody({
  onOpenChange,
  stepKind = null,
  selectedToolId = null,
  onSelect
}: ToolLibraryDialogProps): React.JSX.Element {
  const tools = useProject((s) => s.tools)
  const steps = useProject((s) => s.steps)
  const upsertTool = useProject((s) => s.upsertTool)
  const removeTool = useProject((s) => s.removeTool)
  const toast = useUi((s) => s.toast)

  const recs = useMemo(() => {
    const m = new Map<string, { recommended: boolean; reason: string }>()
    if (stepKind) for (const r of toolsForStep(stepKind, tools)) m.set(r.tool.id, r)
    return m
  }, [stepKind, tools])

  const [tab, setTab] = useState<ToolTab>('all')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Tool | null>(() => {
    const first =
      tools.find((t) => t.id === selectedToolId) ??
      (stepKind ? toolsForStep(stepKind, tools)[0]?.tool : undefined) ??
      tools[0]
    return first ? cloneTool(first) : null
  })
  const [isNew, setIsNew] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const previewDepth = 0.1

  const stored = draft ? (tools.find((t) => t.id === draft.id) ?? null) : null
  const dirty = !!draft && !draft.builtIn && (isNew || !sameTool(draft, stored))
  const errors = useMemo(() => (draft ? validateTool(draft) : []), [draft])
  const stepInfo = stepKind ? STEP_KIND_INFO[stepKind] : null

  const compat = (t: Tool): { ok: boolean; message: string } =>
    stepKind ? isToolAllowed(stepKind, t) : { ok: true, message: '' }

  /** Runs `action` now, or after asking what to do with unsaved edits. */
  const guard = (action: () => void): void => {
    if (dirty) setConfirm({ kind: 'unsaved', proceed: action })
    else action()
  }

  const show = (t: Tool, asNew = false): void => {
    setDraft(cloneTool(t))
    setIsNew(asNew)
    setBlocked(null)
  }

  const selectTool = (t: Tool): void => {
    if (draft?.id === t.id) return
    guard(() => show(t))
  }

  const createOfType = (type: ToolType): void =>
    guard(() => {
      const base = createTool(type, { number: nextToolNumber(tools) })
      const g = base.geometry
      show({ ...base, name: defaultToolName(type, g.diameter, g.tipAngle, g.tipDiameter) }, true)
      if (tab !== 'all' && tab !== type) setTab(type)
      setSearch('')
    })

  const duplicate = (): void => {
    if (!draft) return
    const src = draft
    guard(() => {
      const copy = duplicateTool(src, uid('tool'))
      copy.number = nextToolNumber(tools)
      show(copy, true)
      if (tab !== 'all' && tab !== copy.type) setTab(copy.type)
    })
  }

  const save = (): boolean => {
    if (!draft || draft.builtIn || errors.length) return false
    upsertTool(cloneTool(draft))
    rememberTool(cloneTool(draft))
    setIsNew(false)
    toast('success', `Saved "${draft.name}".`)
    return true
  }

  const discard = (): void => {
    if (!draft) return
    if (isNew) {
      const back = tools.find((t) => t.id === selectedToolId) ?? tools[0]
      if (back) show(back)
      else setDraft(null)
    } else if (stored) show(stored)
  }

  const askDelete = (): void => {
    if (!draft) return
    if (isNew) {
      discard()
      return
    }
    const usedBy = steps.filter((s) => s.toolId === draft.id).map((s) => s.name)
    setConfirm({ kind: 'delete', tool: draft, usedBy })
  }

  const doDelete = (t: Tool): void => {
    const idx = tools.findIndex((x) => x.id === t.id)
    removeTool(t.id)
    forgetTool(t.id)
    const rest = tools.filter((x) => x.id !== t.id)
    const next = rest[Math.min(idx, rest.length - 1)]
    if (next) show(next)
    else setDraft(null)
    toast('info', `Deleted "${t.name}".`)
  }

  const close = (): void => guard(() => onOpenChange(false))

  /** Pick `t` for the step (double-click / "Use this tool"). */
  const pick = (t: Tool): void => {
    if (!stepKind || !onSelect) return
    const isCurrent = draft?.id === t.id
    const candidate = isCurrent && draft ? draft : t
    const c = compat(candidate)
    if (!c.ok) {
      setBlocked(`${c.message} Pick another tool, or press “Back to step” to leave the library.`)
      return
    }
    const finish = (): void => {
      onSelect(candidate.id)
      onOpenChange(false)
    }
    if (isCurrent && dirty) {
      if (errors.length) {
        setBlocked('Fix the highlighted problems (or discard your changes) before using this tool.')
        return
      }
      if (!save()) return
      finish()
      return
    }
    if (!isCurrent) guard(finish)
    else finish()
  }

  // ── list for the current tab
  const listFor = (tb: ToolTab): Tool[] => {
    const q = search.trim().toLowerCase()
    let list = tools.filter((t) => (tb === 'all' || t.type === tb) && (!q || matches(t, q)))
    if (isNew && draft && (tb === 'all' || draft.type === tb)) list = [draft, ...list]
    const typeRank = (t: Tool): number => TOOL_TYPES.indexOf(t.type)
    const rank = (t: Tool): number => {
      if (!stepKind) return 0
      if (!compat(t).ok) return 2
      return recs.get(t.id)?.recommended ? 0 : 1
    }
    return list
      .map((t, i) => ({ t, i }))
      .sort(
        (a, b) =>
          Number(b.t.id === draft?.id && isNew) - Number(a.t.id === draft?.id && isNew) ||
          rank(a.t) - rank(b.t) ||
          typeRank(a.t) - typeRank(b.t) ||
          Number(a.t.builtIn) - Number(b.t.builtIn) ||
          a.i - b.i
      )
      .map((x) => x.t)
  }

  const counts = useMemo(() => {
    const c: Record<ToolTab, number> = { all: tools.length, flat: 0, ball: 0, drill: 0, vbit: 0, corn: 0 }
    for (const t of tools) c[t.type]++
    return c
  }, [tools])

  const draftCompat = draft ? compat(draft) : { ok: true, message: '' }

  const title = stepInfo ? `Choose a tool for “${stepInfo.label}”` : 'Tool library'
  const description = stepInfo
    ? 'Pick one of the recommended tools, any other tool that fits, or create your own. Double-click a tool to use it.'
    : 'All the cutters you own. Start from the starter kit, duplicate a tool to match your own bits, or create one from scratch.'

  const footer = (
    <>
      <div className="mr-auto min-w-0 flex-1 text-xs">
        {blocked ? (
          <span className="flex items-start gap-1.5 text-rose-300" role="alert">
            <Ban className="mt-px size-3.5 shrink-0" />
            {blocked}
          </span>
        ) : stepKind && draft && !draftCompat.ok ? (
          <span className="flex items-start gap-1.5 text-amber-300">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {`"${draft.name}" can't be used here. ${stepNeedsText(stepKind)}.`}
          </span>
        ) : stepKind && draft ? (
          <span className="text-slate-400">{draftCompat.message}</span>
        ) : null}
      </div>
      <Button variant="secondary" data-testid="tool-cancel" onClick={close}>
        {stepKind ? (
          <>
            <ArrowLeft /> Back to step
          </>
        ) : (
          'Close'
        )}
      </Button>
      {stepKind && onSelect && (
        <Tooltip content={draft && !draftCompat.ok ? stepNeedsText(stepKind) : undefined}>
          <span>
            <Button
              data-testid="tool-use"
              variant="success"
              disabled={!draft || !draftCompat.ok || (dirty && errors.length > 0)}
              onClick={() => draft && pick(draft)}
            >
              <Wrench /> {dirty ? 'Save & use this tool' : 'Use this tool'}
            </Button>
          </span>
        </Tooltip>
      )}
    </>
  )

  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? undefined : close())}
      title={
        <span className="flex items-center gap-2">
          <Library className="size-5 text-sky-400" /> {title}
        </span>
      }
      description={description}
      footer={footer}
      className="h-[86vh] max-h-[86vh] w-[min(96vw,1200px)]"
    >
      <div data-testid="tool-library" className="flex h-full min-h-0 flex-col gap-3">
        {stepInfo && stepKind && (
          <div className="flex items-start gap-2 rounded-lg border border-sky-800/70 bg-sky-950/40 px-3 py-2 text-xs text-sky-100">
            <Info className="mt-px size-4 shrink-0 text-sky-400" />
            <div className="flex flex-1 items-center gap-1.5">
              <b>{stepNeedsText(stepKind)}.</b>
              <HelpTip title="Tools for this step">
                Best results: {typeList(stepInfo.preferredToolTypes)}. Tools marked Recommended suit this step
                best; greyed-out tools cannot be used for it.
              </HelpTip>
            </div>
          </div>
        )}

        <Tabs.Root
          value={tab}
          onValueChange={(v) => setTab(v as ToolTab)}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <Tabs.List className="flex flex-wrap gap-1 border-b border-slate-800 pb-2" aria-label="Tool types">
            {TOOL_TABS.map((t) => {
              const allowed = !stepInfo || t.value === 'all' || stepInfo.allowedToolTypes.includes(t.value)
              return (
                <Tabs.Trigger
                  key={t.value}
                  value={t.value}
                  data-testid={`tool-tab-${t.value}`}
                  className={cn(
                    'flex items-center gap-2 rounded-md border border-transparent px-3 py-1.5 text-[13px] font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100',
                    'data-[state=active]:border-sky-600 data-[state=active]:bg-sky-600/15 data-[state=active]:text-sky-100',
                    !allowed && 'opacity-50'
                  )}
                >
                  {t.label}
                  <span className="rounded bg-slate-800 px-1 text-[10px] tabular-nums text-slate-400">
                    {counts[t.value]}
                  </span>
                </Tabs.Trigger>
              )
            })}
          </Tabs.List>
          <div className="flex min-h-0 flex-1 gap-4">
            {/* ── left: list */}
            <div className="flex w-[420px] shrink-0 flex-col gap-2">
              {TOOL_TABS.map((t) => (
                <Tabs.Content
                  key={t.value}
                  value={t.value}
                  className="flex min-h-0 flex-1 flex-col gap-2 outline-none"
                >
                  {t.value !== 'all' && stepInfo && !stepInfo.allowedToolTypes.includes(t.value) && (
                    <p className="text-[11px] text-amber-300/90">Not usable for “{stepInfo.label}”.</p>
                  )}
                  <div className="flex items-center gap-2">
                    <HelpTip title={t.value === 'all' ? 'All tools' : TOOL_TYPE_INFO[t.value].label}>
                      {t.value === 'all'
                        ? 'Every tool in this project. Use the tabs to see one kind of tool at a time.'
                        : TOOL_TYPE_INFO[t.value].description}
                    </HelpTip>
                    <label className="relative flex-1">
                      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name, size, angle…"
                        aria-label="Search tools"
                        className="h-8 w-full rounded-md border border-slate-700 bg-slate-950 pl-7 pr-2 text-sm text-slate-100 outline-none focus:border-sky-500"
                      />
                    </label>
                    {t.value === 'all' ? (
                      <CreateMenu onCreate={createOfType} stepKind={stepKind} />
                    ) : (
                      <Button
                        data-testid="tool-create"
                        size="default"
                        onClick={() => createOfType(t.value as ToolType)}
                      >
                        <Plus /> Create my own tool
                      </Button>
                    )}
                  </div>
                  <ToolList
                    list={listFor(t.value)}
                    activeId={draft?.id ?? null}
                    chosenId={selectedToolId}
                    isNewId={isNew ? (draft?.id ?? null) : null}
                    stepKind={stepKind}
                    recs={recs}
                    onClick={selectTool}
                    onDoubleClick={pick}
                    emptyText={
                      search
                        ? 'No tool matches your search.'
                        : 'No tools of this kind yet. Press “Create my own tool” to add one.'
                    }
                  />
                </Tabs.Content>
              ))}
            </div>

            {/* ── right: editor */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-slate-800 bg-slate-950/40">
              {draft ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-100">
                        {draft.name || 'Unnamed tool'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {draft.builtIn
                          ? 'Starter kit · read-only'
                          : isNew
                            ? 'New tool · not saved yet'
                            : dirty
                              ? 'You have unsaved changes'
                              : 'My tool · saved'}
                      </div>
                    </div>
                    {draft.builtIn ? (
                      <Button data-testid="tool-duplicate" onClick={duplicate}>
                        <Copy /> Duplicate to customise
                      </Button>
                    ) : (
                      <>
                        {dirty && !isNew && (
                          <Button variant="ghost" size="sm" onClick={discard}>
                            <Undo2 /> Discard changes
                          </Button>
                        )}
                        {!isNew && (
                          <Button variant="ghost" size="sm" data-testid="tool-duplicate" onClick={duplicate}>
                            <Copy /> Duplicate
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-300 hover:bg-rose-950/60 hover:text-rose-200"
                          data-testid="tool-delete"
                          onClick={askDelete}
                        >
                          <Trash2 /> {isNew ? 'Discard' : 'Delete'}
                        </Button>
                        <Tooltip
                          content={errors.length ? 'Fix the problems shown in red before saving.' : undefined}
                        >
                          <span>
                            <Button
                              data-testid="tool-save"
                              size="sm"
                              disabled={!dirty || errors.length > 0}
                              onClick={save}
                            >
                              <Save /> Save
                            </Button>
                          </span>
                        </Tooltip>
                      </>
                    )}
                  </div>
                  {errors.length > 0 && !draft.builtIn && (
                    <div className="border-b border-rose-900/60 bg-rose-950/40 px-3 py-1.5 text-[11px] text-rose-300">
                      {errors.length === 1 ? errors[0] : `${errors.length} problems: ${errors.join(' ')}`}
                    </div>
                  )}
                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    <ToolEditor
                      draft={draft}
                      onChange={(t) => {
                        setDraft(withAutoName(draft, t))
                        setBlocked(null)
                      }}
                      readOnly={draft.builtIn}
                      errors={errors}
                      otherTools={tools}
                      previewDepth={previewDepth}
                      stepKind={stepKind}
                    />
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-400">
                  <Library className="size-8 text-slate-600" />
                  No tool selected. Pick one on the left or create your own.
                </div>
              )}
            </div>
          </div>
        </Tabs.Root>
      </div>

      {confirm?.kind === 'unsaved' && (
        <Dialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Unsaved changes"
          description={
            draft?.name
              ? `You changed "${draft.name}" but did not save it.`
              : 'You changed this tool but did not save it.'
          }
          className="w-[min(92vw,460px)]"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Keep editing
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const p = confirm.proceed
                  setConfirm(null)
                  setIsNew(false)
                  setDraft(stored ? cloneTool(stored) : null)
                  p()
                }}
              >
                Discard changes
              </Button>
              <Button
                disabled={errors.length > 0}
                onClick={() => {
                  const p = confirm.proceed
                  setConfirm(null)
                  if (save()) p()
                }}
              >
                <Save /> Save and continue
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-300">
            Save your changes before moving on, or discard them to go back to the last saved version.
          </p>
          {errors.length > 0 && (
            <p className="mt-2 text-xs text-rose-300">It can&apos;t be saved yet: {errors.join(' ')}</p>
          )}
        </Dialog>
      )}

      {confirm?.kind === 'delete' && (
        <Dialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={`Delete "${confirm.tool.name}"?`}
          description="This removes the tool from this project. You can undo it with Ctrl+Z."
          className="w-[min(92vw,460px)]"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                data-testid="tool-delete-confirm"
                onClick={() => {
                  const t = confirm.tool
                  setConfirm(null)
                  doDelete(t)
                }}
              >
                <Trash2 /> Delete tool
              </Button>
            </>
          }
        >
          {confirm.usedBy.length ? (
            <p className="flex items-start gap-2 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <span>
                It is used by {confirm.usedBy.length === 1 ? 'the step' : 'these steps'}{' '}
                <b>{confirm.usedBy.join(', ')}</b>. After deleting, you will need to choose another tool
                there.
              </span>
            </p>
          ) : (
            <p className="text-sm text-slate-300">No step uses this tool.</p>
          )}
        </Dialog>
      )}
    </Dialog>
  )
}

/** Keeps an auto-generated name ("Flat end mill 1.0 mm") in sync with the size while the user edits. */
function withAutoName(prev: Tool, next: Tool): Tool {
  const pg = prev.geometry
  const ng = next.geometry
  if (next.builtIn || prev.type !== next.type || prev.name !== next.name) return next
  const before = defaultToolName(prev.type, pg.diameter, pg.tipAngle, pg.tipDiameter)
  const after = defaultToolName(next.type, ng.diameter, ng.tipAngle, ng.tipDiameter)
  if (prev.name === before) return { ...next, name: after }
  if (prev.name.startsWith(`${before} (`)) return { ...next, name: after + prev.name.slice(before.length) }
  return next
}

function matches(t: Tool, q: string): boolean {
  const g = t.geometry
  const hay = [
    t.name,
    TOOL_NOUN[t.type],
    TOOL_TYPE_INFO[t.type].label,
    `${g.diameter}`,
    `${g.diameter}mm`,
    g.tipAngle !== undefined ? `${g.tipAngle}°` : '',
    `t${t.number}`,
    t.notes
  ]
    .join(' ')
    .toLowerCase()
  return q.split(/\s+/).every((w) => hay.includes(w))
}

function ToolList({
  list,
  activeId,
  chosenId,
  isNewId,
  stepKind,
  recs,
  onClick,
  onDoubleClick,
  emptyText
}: {
  list: Tool[]
  activeId: string | null
  chosenId: string | null
  isNewId: string | null
  stepKind: StepKind | null
  recs: Map<string, { recommended: boolean; reason: string }>
  onClick: (t: Tool) => void
  onDoubleClick: (t: Tool) => void
  emptyText: string
}): React.JSX.Element {
  if (!list.length)
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">
        {emptyText}
      </div>
    )
  return (
    <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
      <div className="flex flex-col gap-1.5 pb-2">
        {list.map((t) => {
          const allowed = stepKind ? isToolAllowed(stepKind, t) : null
          const rec = recs.get(t.id)
          const card = (
            <ToolCard
              key={t.id}
              tool={t}
              active={t.id === activeId}
              chosen={t.id === chosenId}
              unsaved={t.id === isNewId}
              recommended={!!rec?.recommended}
              incompatible={allowed ? !allowed.ok : false}
              reason={stepKind ? (rec?.reason ?? undefined) : undefined}
              onClick={() => onClick(t)}
              onDoubleClick={() => onDoubleClick(t)}
            />
          )
          if (allowed && !allowed.ok && stepKind)
            return (
              <Tooltip key={t.id} side="right" content={`${stepNeedsText(stepKind)}.`}>
                {card}
              </Tooltip>
            )
          return card
        })}
      </div>
    </div>
  )
}

function CreateMenu({
  onCreate,
  stepKind
}: {
  onCreate: (type: ToolType) => void
  stepKind: StepKind | null
}): React.JSX.Element {
  const allowed = stepKind ? STEP_KIND_INFO[stepKind].allowedToolTypes : TOOL_TYPES
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button data-testid="tool-create">
          <Plus /> Create my own tool <ChevronDown className="opacity-70" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[80] w-80 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-2xl"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            What kind of tool?
          </DropdownMenu.Label>
          {TOOL_TYPES.map((type) => (
            <DropdownMenu.Item
              key={type}
              data-testid={`tool-create-${type}`}
              onSelect={() => onCreate(type)}
              className="flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-slate-800"
            >
              <span className="flex items-center gap-2 text-sm text-slate-100">
                {TOOL_TYPE_INFO[type].label}
                {stepKind && !allowed.includes(type) && (
                  <span className="text-[10px] text-amber-300">not for this step</span>
                )}
              </span>
              <span className="text-[11px] leading-snug text-slate-500">{TOOL_TYPE_INFO[type].usedFor}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
