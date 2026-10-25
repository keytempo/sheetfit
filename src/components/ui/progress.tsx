import { Progress as ProgressPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="size-full origin-left bg-primary transition-transform duration-100 ease-linear"
        style={{ transform: `scaleX(${(value ?? 0) / 100})` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
