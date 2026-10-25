import { Switch as SwitchPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'touch-target peer relative inline-flex h-[1.35rem] w-10 shrink-0 items-center rounded-full border border-transparent shadow-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input pointer-coarse:h-7 pointer-coarse:w-12',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-card ring-0 transition-transform data-[state=checked]:translate-x-[1.35rem] data-[state=unchecked]:translate-x-0.5 pointer-coarse:size-5 pointer-coarse:data-[state=checked]:translate-x-[1.65rem]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
