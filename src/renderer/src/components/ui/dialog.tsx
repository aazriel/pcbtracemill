import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  dismissable = true
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  dismissable?: boolean
}): React.JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (dismissable || o ? onOpenChange(o) : undefined)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in" />
        <DialogPrimitive.Content
          onInteractOutside={(e) => !dismissable && e.preventDefault()}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[min(92vw,720px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl',
            className
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
            <div>
              <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-sm text-slate-400">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{String(title)}</DialogPrimitive.Description>
              )}
            </div>
            {dismissable && (
              <DialogPrimitive.Close
                className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                aria-label="Close"
              >
                <X className="size-5" />
              </DialogPrimitive.Close>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-3">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
