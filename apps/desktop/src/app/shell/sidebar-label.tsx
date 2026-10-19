import type * as React from 'react'

import { cn } from '@/lib/utils'

interface SidebarPanelLabelProps extends React.ComponentProps<'span'> {
  dotClassName?: string
}

export function SidebarPanelLabel({ children, className, dotClassName, ...props }: SidebarPanelLabelProps) {
  return (
    <span
      className={cn('flex min-w-0 items-center gap-2 pl-2 text-xs font-medium text-(--ui-text-tertiary)', className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn('block size-1 shrink-0 rounded-full bg-(--ui-text-quaternary)', dotClassName)}
      />
      <span className="min-w-0 truncate leading-none">{children}</span>
    </span>
  )
}
