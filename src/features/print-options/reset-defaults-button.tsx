import { RotateCcwIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
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
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'

export function ResetDefaultsButton() {
  const [open, setOpen] = useState(false)
  const resetOptions = useAppStore((state) => state.resetOptions)

  return (
    <>
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <RotateCcwIcon />
        Reset to defaults
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset every print option?</AlertDialogTitle>
            <AlertDialogDescription>
              Sheet, size, spacing, layout, preview and unit settings all go back to their defaults.
              Your images, copies and sizes are not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my settings</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                resetOptions()
                toast('Print options reset to defaults')
              }}
            >
              Reset to defaults
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
