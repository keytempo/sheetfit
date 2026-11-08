import { EllipsisIcon, KeyboardIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { IconButton } from '@/components/icon-button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { pluralize } from '@/lib/format'
import { formatLength } from '@/lib/units'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useTotalPieces } from '@/store/derived'
import { ListSummary } from './list-summary'
import { SetAllCopiesForm } from './set-all-copies-form'

export function ImageListToolbar({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const imageCount = useAppStore((state) => state.images.length)
  const unit = useAppStore((state) => state.options.unit)
  const resetSizes = useAppStore((state) => state.resetSizes)
  const matchAllWidths = useAppStore((state) => state.matchAllWidths)
  const clearImages = useAppStore((state) => state.clearImages)
  const announce = useAppStore((state) => state.announce)
  const totalPieces = useTotalPieces()

  const [copiesOpen, setCopiesOpen] = useState(false)
  // The popover opens only after the menu has finished closing, because two layers open at
  // once fight over focus and the popover dismisses itself.
  const openCopiesAfterClose = useRef(false)
  const [clearOpen, setClearOpen] = useState(false)
  const disabled = imageCount === 0

  const handleMatchWidths = () => {
    const width = matchAllWidths()
    if (width !== null)
      toast(`Every image now prints about ${formatLength(width, unit)} ${unit} wide`)
  }

  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h2 className="font-display text-base font-semibold tracking-tight">Images</h2>
        <ListSummary />
      </div>

      <IconButton label="Keyboard shortcuts" onClick={onShowShortcuts}>
        <KeyboardIcon />
      </IconButton>

      <Popover open={copiesOpen} onOpenChange={setCopiesOpen}>
        <DropdownMenu>
          <PopoverAnchor asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={disabled}>
                More
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
          </PopoverAnchor>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              if (!openCopiesAfterClose.current) return
              openCopiesAfterClose.current = false
              event.preventDefault()
              setCopiesOpen(true)
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                openCopiesAfterClose.current = true
              }}
            >
              Set all copies to…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                resetSizes()
                toast('Every size is back to 100%')
              }}
            >
              Reset all sizes to 100%
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleMatchWidths}>
              Match all to the same width
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive [&_svg]:text-destructive"
              onSelect={() => setClearOpen(true)}
            >
              Clear all…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <PopoverContent align="end" className="w-64">
          <SetAllCopiesForm onDone={() => setCopiesOpen(false)} />
        </PopoverContent>
      </Popover>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove every image?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {pluralize(imageCount, 'image')} and all{' '}
              {pluralize(totalPieces, 'piece')} from the sheets, and the copy kept on this device.
              Your print options are kept. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep images</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: 'destructive' }))}
              onClick={() => {
                clearImages()
                announce(`Removed all ${pluralize(imageCount, 'image')}`)
              }}
            >
              Clear all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
