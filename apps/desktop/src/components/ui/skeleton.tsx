import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  // Neutral fill, NOT `bg-accent`: accent is a *signal* color in several skins
  // (deepseek-harness seeds it to the saturated DeepSeek blue #4176E6), which
  // turned every loading state into a wall of pulsing blue blocks that read as
  // a rendering bug. `foreground/10` keeps the same contrast on both themes
  // while staying neutral under every skin.
  return (
    <div className={cn('animate-pulse rounded-md bg-foreground/10', className)} data-slot="skeleton" {...props} />
  )
}

/** Inline pulsing chip standing in for a small count/badge while it loads. */
function CountSkeleton({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('inline-block h-2 w-3.5 translate-y-px animate-pulse rounded-sm bg-current/25', className)}
      data-slot="count-skeleton"
      {...props}
    />
  )
}

export { CountSkeleton, Skeleton }
