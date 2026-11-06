/** "New project" with unsaved changes: save them first, throw them away, or stay. */
import { FilePlus, Save } from 'lucide-react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { useUi } from '@renderer/store/ui'
import { useProject } from '@renderer/store/project'
import { saveProject, startNewProject } from '@renderer/store/controller'

export function NewProjectDialog(): React.JSX.Element | null {
  const open = useUi((s) => s.confirmNew)
  const name = useProject((s) => s.name)
  if (!open) return null
  const close = (): void => useUi.getState().set({ confirmNew: false })
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="Start a new project?"
      description={`"${name}" has unsaved changes. A new project starts with no layers and no steps.`}
      className="w-[min(92vw,480px)]"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={close}>
            Cancel
          </Button>
          <Button variant="danger" onClick={startNewProject} data-testid="new-discard">
            <FilePlus /> Discard and start new
          </Button>
          <Button
            onClick={async () => {
              await saveProject()
              if (!useProject.getState().dirty) startNewProject()
            }}
            data-testid="new-save"
            autoFocus
          >
            <Save /> Save, then new
          </Button>
        </>
      }
    >
      <span />
    </Dialog>
  )
}
