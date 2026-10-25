import { Slider as SliderPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

/** `aria-label` goes on the thumb, which is the element assistive technology announces. */
function Slider({
  className,
  'aria-label': ariaLabel,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        'relative flex h-5 w-full touch-none items-center select-none data-[disabled]:opacity-50 pointer-coarse:h-11',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={ariaLabel}
        className="touch-target relative block size-4 shrink-0 rounded-full border-2 border-primary bg-card shadow-sm outline-none transition-[box-shadow,transform] hover:ring-4 hover:ring-ring/20 focus-visible:ring-4 focus-visible:ring-ring/40 active:scale-110 pointer-coarse:size-6"
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }
