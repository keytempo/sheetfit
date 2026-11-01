import { CircleAlertIcon, CircleCheckIcon, FileTextIcon, TriangleAlertIcon } from 'lucide-react'
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
import { downloadBlob } from '@/lib/download'
import type { ExportInput, ExportResult } from '@/lib/export-types'
import { formatFileSize, pluralize } from '@/lib/format'
import { fadeSlide } from '@/lib/motion'
import { exportPdf } from '@/pdf/client'

type RunState =
  | { status: 'running'; fraction: number; label: string }
  | { status: 'success'; result: ExportResult }
  | { status: 'error'; message: string }

const STARTING: RunState = { status: 'running', fraction: 0, label: 'Starting' }

const NOTICE = 'Each photo is embedded once and never recompressed with any loss.'

function Step({ children }: { children: ReactNode }) {
  return (
    <motion.div {...fadeSlide} className="flex flex-col gap-4">
      {children}
    </motion.div>
  )
}

/**
 * Runs one export of the snapshot taken when Download PDF was pressed and shows its progress. Work
 * stops the moment the dialog closes, so Cancel really cancels and no file is saved.
 */
function ExportRun({
  input,
  open,
  onClose,
}: {
  input: ExportInput
  open: boolean
  onClose: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<RunState>(STARTING)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    exportPdf(
      input,
      (progress) => {
        if (!controller.signal.aborted) setState({ status: 'running', ...progress })
      },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return
        downloadBlob(result.blob, result.filename)
        setState({ status: 'success', result })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'The export failed.',
        })
      })
    return () => controller.abort()
  }, [input, open, attempt])

  const retry = () => {
    setState(STARTING)
    setAttempt((count) => count + 1)
  }

  const omitted = input.layout.unplaceable.length

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
            <DialogDescription>If the download didn’t start, use Download again.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
            <FileTextIcon className="size-8 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate font-mono text-sm font-medium">{state.result.filename}</p>
              <p className="font-mono text-xs text-muted-foreground tabular-nums">
                {formatFileSize(state.result.blob.size)}
              </p>
            </div>
          </div>
          {omitted > 0 && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/20 p-3 text-sm text-warning-foreground"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              {pluralize(omitted, 'copy', 'copies')} did not fit on the sheet and{' '}
              {omitted === 1 ? 'was' : 'were'} left out of the PDF.
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => downloadBlob(state.result.blob, state.result.filename)}
            >
              Download again
            </Button>
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

/**
 * One export. The input is kept while the dialog fades out, and each press of Download PDF gets
 * its own `id`, so a new run never starts from the previous run's result.
 */
export interface ExportState {
  id: number
  input: ExportInput
  open: boolean
}

export function ExportDialog({
  id,
  input,
  open,
  onOpenChange,
}: ExportState & { onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <ExportRun key={id} input={input} open={open} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
