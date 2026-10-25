import { XIcon } from 'lucide-react'
import { Dialog as SheetPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A slide-over built on Radix Dialog. It has no overlay: the Sheetfit print options slide over the
 * image list while the preview beside it stays visible and interactive, so the sheet is
 * non-modal and dismisses only through its close button, Escape, or the control that opened it.
 */
function Sheet({ modal = false, ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" modal={modal} {...props} />
}

function SheetContent({
  className,
  children,
  container,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  /** Where to render the sheet. Defaults to the document body. */
  container?: HTMLElement | null
}) {
  return (
    <SheetPrimitive.Portal container={container ?? undefined}>
      <SheetPrimitive.Content
        data-slot="sheet-content"
        onInteractOutside={(event) => {
          event.preventDefault()
          onInteractOutside?.(event)
        }}
        className={cn(
          'overlay-motion z-40 flex flex-col bg-card text-card-foreground shadow-xl outline-none animate-in slide-in-from-left data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left',
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex items-start justify-between gap-3 border-b p-4', className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('font-display text-lg leading-tight font-semibold tracking-tight', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

function SheetClose({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return (
    <SheetPrimitive.Close
      data-slot="sheet-close"
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:size-11 [&_svg]:size-4',
        className,
      )}
      {...props}
    >
      <XIcon />
      <span className="sr-only">Close</span>
    </SheetPrimitive.Close>
  )
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle }
