import { CircleAlertIcon, CircleCheckIcon, FileTextIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import type { ExportResult } from '@/lib/export-types'
import { formatFileSize } from '@/lib/format'
import { fadeSlide } from '@/lib/motion'
import { exportPdf } from '@/placeholders'
import { snapshotExportInput } from '@/store/derived'

type RunState =
  | { status: 'running'; fraction: number; label: string }
  | { status: 'success'; result: ExportResult }
  | { status: 'error'; message: string }

const STARTING: RunState = { status: 'running', fraction: 0, label: 'Starting' }

const NOTICE = 'UI preview only, no file produced.'

function Step({ children }: { children: ReactNode }) {
  return (
    <motion.div {...fadeSlide} className="flex flex-col gap-4">
      {children}
    </motion.div>
  )
}

/** Runs one export and shows its progress. It exists only while the dialog is open. */
function ExportRun({ onClose }: { onClose: () => void }) {
  const [input] = useState(snapshotExportInput)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<RunState>(STARTING)

  useEffect(() => {
    const controller = new AbortController()
    exportPdf(
      input,
      (progress) => {
        if (!controller.signal.aborted) setState({ status: 'running', ...progress })
      },
      controller.signal,
    )
      .then((result) => setState({ status: 'success', result }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'The export failed.',
        })
      })
    return () => controller.abort()
  }, [input, attempt])

  const retry = () => {
    setState(STARTING)
    setAttempt((count) => count + 1)
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {state.status === 'running' && (
        <Step key="running">
          <DialogHeader>
            <DialogTitle>Preparing your PDF</DialogTitle>
            <DialogDescription>{NOTICE}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Progress aria-label="Export progress" value={state.fraction * 100} />
            <div className="flex justify-between font-mono text-xs text-muted-foreground tabular-nums">
              <span aria-live="polite">{state.label}…</span>
              <span>{Math.round(state.fraction * 100)}%</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </DialogFooter>
        </Step>
      )}

      {state.status === 'success' && (
        <Step key="success">
          <DialogHeader>
            <div className="flex items-center gap-2 text-primary">
              <CircleCheckIcon className="size-5" />
              <DialogTitle>Your PDF is ready</DialogTitle>
            </div>
            <DialogDescription>{NOTICE}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
            <FileTextIcon className="size-8 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate font-mono text-sm font-medium">{state.result.filename}</p>
              <p className="font-mono text-xs text-muted-foreground tabular-nums">
                {formatFileSize(state.result.sizeBytes)}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </Step>
      )}

      {state.status === 'error' && (
        <Step key="error">
          <DialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <CircleAlertIcon className="size-5" />
              <DialogTitle>The export didn’t finish</DialogTitle>
            </div>
            <DialogDescription>{NOTICE}</DialogDescription>
          </DialogHeader>
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            {state.message}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button onClick={retry}>Try again</Button>
          </DialogFooter>
        </Step>
      )}
    </AnimatePresence>
  )
}

export function ExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <ExportRun onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
