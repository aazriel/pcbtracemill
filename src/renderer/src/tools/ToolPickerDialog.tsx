/**
 * "Choose a tool" for one step: the compatible tools in two framed groups, "Recommended" and
 * "Also works", with the group name written on the frame line. Picking a tool closes the dialog.
 */
import { useMemo, type ReactNode } from 'react'
import { Library, Sparkles, Wrench } from 'lucide-react'
import type { StepKind, Tool } from '@core/model/types'
import { STEP_KIND_INFO, toolsForStep } from '@core/cam'
import { useProject } from '@renderer/store/project'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { ToolCard } from './ToolCard'
import { stepNeedsText, typeList } from './toolMeta'

function Group({
  label,
  icon,
  tone,
  children
}: {
  label: string
  icon: ReactNode
  tone: 'recommended' | 'other'
  children: ReactNode
}): React.JSX.Element {
  return (
    <fieldset
      className={cn(
        'rounded-xl border px-3 pb-3 pt-1',
        tone === 'recommended' ? 'border-emerald-500/50' : 'border-slate-700'
      )}
      data-testid={`tool-group-${tone}`}
    >
      <legend
        className={cn(
          'flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider [&_svg]:size-3.5',
          tone === 'recommended' ? 'text-emerald-300' : 'text-slate-400'
        )}
      >
        {icon}
        {label}
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

export function ToolPickerDialog({
  open,
  onOpenChange,
  stepKind,
  selectedToolId,
  onSelect,
  onOpenLibrary
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  stepKind: StepKind
  selectedToolId: string | null
  onSelect: (toolId: string) => void
  onOpenLibrary: () => void
}): React.JSX.Element {
  const tools = useProject((s) => s.tools)
  const entries = useMemo(() => toolsForStep(stepKind, tools), [stepKind, tools])
  const info = STEP_KIND_INFO[stepKind]
  const recommended = entries.filter((e) => e.recommended)
  const others = entries.filter((e) => !e.recommended)
  const card = (e: { tool: Tool; reason: string }): React.JSX.Element => (
    <ToolCard
      key={e.tool.id}
      tool={e.tool}
      active={e.tool.id === selectedToolId}
      chosen={e.tool.id === selectedToolId}
      reason={e.reason}
      onClick={() => {
        onSelect(e.tool.id)
        onOpenChange(false)
      }}
    />
  )
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Choose a tool for “${info.label}”`}
      description={`${stepNeedsText(stepKind)}. Only tools that can do this step are listed.`}
      className="w-[min(94vw,760px)]"
      footer={
        <>
          <Button
            variant="secondary"
            className="mr-auto"
            onClick={() => {
              onOpenChange(false)
              onOpenLibrary()
            }}
            data-testid="tool-picker-library"
          >
            <Library /> Open the tool library…
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="tool-picker">
        {recommended.length > 0 && (
          <Group label="Recommended" icon={<Sparkles />} tone="recommended">
            {recommended.map(card)}
          </Group>
        )}
        {others.length > 0 && (
          <Group
            label={recommended.length ? 'Also works' : 'Compatible tools'}
            icon={<Wrench />}
            tone="other"
          >
            {others.map(card)}
          </Group>
        )}
        {entries.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-700 p-4 text-center text-xs text-slate-400">
            You have no {typeList(info.allowedToolTypes)} yet. Open the tool library to create one.
          </div>
        )}
      </div>
    </Dialog>
  )
}
