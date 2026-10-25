import { GripVerticalIcon } from 'lucide-react'
import * as ResizablePrimitive from 'react-resizable-panels'
import { cn } from '@/lib/utils'

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn('flex size-full', className)}
      {...props}
    />
  )
}

function ResizablePanel(props: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

/**
 * The divider is a 1px line with a visible grip. `data-separator` reports hover, active (dragging)
 * and focus, which drive the highlight bar and the grip colours without any React state.
 */
function ResizableHandle({ className, ...props }: ResizablePrimitive.SeparatorProps) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        'group relative flex w-px items-center justify-center bg-border outline-none before:absolute before:inset-y-0 before:-left-px before:w-[3px] before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity data-[separator=active]:before:opacity-100 data-[separator=focus]:before:opacity-100 data-[separator=hover]:before:opacity-60',
        className,
      )}
      {...props}
    >
      <div className="z-10 flex h-9 w-3.5 items-center justify-center rounded-sm border bg-card text-muted-foreground shadow-xs transition-colors group-data-[separator=active]:border-primary group-data-[separator=active]:bg-primary group-data-[separator=active]:text-primary-foreground group-data-[separator=focus]:border-primary group-data-[separator=hover]:border-primary/60 group-data-[separator=hover]:text-primary">
        <GripVerticalIcon className="size-3" />
      </div>
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
