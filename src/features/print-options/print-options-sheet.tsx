import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { PRINT_OPTIONS_BUTTON_ID } from '@/lib/dom-ids'
import { useAppStore } from '@/store'
import { OptionsAccordion } from './options-accordion'
import { ResetDefaultsButton } from './reset-defaults-button'

/**
 * The print options. With a `container` (the image panel on wide screens) the sheet slides over
 * that panel only, leaving the preview beside it visible and live. Without one it fills the screen.
 */
export function PrintOptionsSheet({ container }: { container?: HTMLElement | null }) {
  const open = useAppStore((state) => state.printOptionsOpen)
  const setOpen = useAppStore((state) => state.setPrintOptionsOpen)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        container={container}
        className={container ? 'absolute inset-0' : 'fixed inset-0'}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          document.getElementById(PRINT_OPTIONS_BUTTON_ID)?.focus()
        }}
      >
        <SheetHeader className="pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex flex-col gap-1">
            <SheetTitle>Print options</SheetTitle>
            <SheetDescription>Changes show up in the preview straight away.</SheetDescription>
          </div>
          <SheetClose />
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <OptionsAccordion />
        </ScrollArea>
        <div className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <ResetDefaultsButton />
        </div>
      </SheetContent>
    </Sheet>
  )
}
