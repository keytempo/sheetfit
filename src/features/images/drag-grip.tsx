import { GripVerticalIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** The grip at the left of an image row. It is the only part of a row that starts a drag. */
export function DragGrip({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-16 w-6 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:w-11',
        className,
      )}
      {...props}
    >
      <GripVerticalIcon className="size-4" />
    </button>
  )
}
