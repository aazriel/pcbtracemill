import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

export const TooltipProvider = TooltipPrimitive.Provider

export function Tooltip({
  content,
  children,
  side = 'top',
  className
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}): React.JSX.Element {
  if (!content) return <>{children}</>
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-[100] max-w-xs rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs leading-relaxed text-slate-200 shadow-xl',
            className
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-slate-700" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
