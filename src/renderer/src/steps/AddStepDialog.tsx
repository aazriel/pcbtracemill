/** "Add step" picker: six large tiles, one per step kind. Choosing one opens the Step editor. */
import { STEP_KIND_INFO } from '@core/cam'
import { useProject } from '@renderer/store/project'
import { Dialog } from '@renderer/components/ui/dialog'
import { useStepEditor } from './editorStore'
import { STEP_KIND_ORDER, stepIcon } from './stepUtils'

export function AddStepDialog(): React.JSX.Element {
  const open = useStepEditor((s) => s.pickerOpen)
  const closePicker = useStepEditor((s) => s.closePicker)
  const openNew = useStepEditor((s) => s.openNew)
  const layers = useProject((s) => s.layers)
  const has = (types: string[]): boolean => !types.length || layers.some((l) => types.includes(l.type))
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && closePicker()}
      title="Add a step"
      description="What should the machine do? Pick one; you can fine-tune everything on the next screen."
      className="w-[min(94vw,860px)]"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="add-step-dialog">
        {STEP_KIND_ORDER.map((kind) => {
          const info = STEP_KIND_INFO[kind]
          const Icon = stepIcon(kind)
          const missing = !has(info.allowedLayerTypes)
          return (
            <button
              key={kind}
              type="button"
              data-testid={`step-kind-${kind}`}
              onClick={() => openNew(kind)}
              className="group flex flex-col gap-2 rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-left transition-colors hover:border-sky-500 hover:bg-sky-500/5"
            >
              <span className="flex size-11 items-center justify-center rounded-lg bg-slate-800 text-sky-400 transition-colors group-hover:bg-sky-500/20">
                <Icon className="size-6" />
              </span>
              <span className="text-sm font-semibold text-slate-100">{info.label}</span>
              <span className="text-[11.5px] leading-snug text-slate-400">{info.description}</span>
              {missing && (
                <span className="text-[10.5px] text-amber-400">
                  No {info.allowedLayerTypes.join(' / ')} layer imported yet.
                </span>
              )}
            </button>
          )
        })}
      </div>
    </Dialog>
  )
}
