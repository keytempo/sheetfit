import {
  CircleCheckIcon,
  DownloadIcon,
  FileTextIcon,
  PrinterIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { downloadBlob } from '@/lib/download'
import type { ExportResult } from '@/lib/export-types'
import { formatFileSize, pluralize } from '@/lib/format'
import { browserPrintHost } from '@/lib/print-host'
import { createPrintSession, type PrintOutcome, type PrintSession } from '@/lib/print-pdf'
import { cn } from '@/lib/utils'

/** What to tell the person when printing did not simply open the browser's print dialog. */
const NOTES: Record<PrintOutcome, { text: string; problem: boolean } | null> = {
  dialog: null,
  tab: { text: 'The PDF opened in a new tab. Print it from there.', problem: false },
  blocked: {
    text: 'Your browser blocked the new tab. Download the PDF and print it from a PDF viewer.',
    problem: true,
  },
  unsupported: {
    text: 'This browser can’t print a PDF from here. Download it and print it from a PDF viewer.',
    problem: true,
  },
}

interface ReadyStepProps {
  result: ExportResult
  /** Copies that fit on no sheet and so are not in the PDF. */
  omitted: number
  onClose: () => void
}

/**
 * The finished PDF. Nothing has been saved or printed yet: Download PDF saves it and Print sends it
 * to the printer from memory, each as often as wanted and in any order. The print session lives as
 * long as this step does, so its object URL and hidden frame are released when the dialog closes.
 */
export function ReadyStep({ result, omitted, onClose }: ReadyStepProps) {
  const session = useRef<PrintSession | null>(null)
  const [printing, setPrinting] = useState(false)
  const [outcome, setOutcome] = useState<PrintOutcome>('dialog')

  useEffect(() => {
    const created = createPrintSession(result.blob, browserPrintHost)
    session.current = created
    return () => {
      created.dispose()
      session.current = null
    }
  }, [result])

  const print = async () => {
    if (!session.current) return
    setPrinting(true)
    setOutcome('dialog')
    const next = await session.current.print()
    setPrinting(false)
    setOutcome(next)
  }

  const note = NOTES[outcome]

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2 text-primary">
          <CircleCheckIcon className="size-5" />
          <DialogTitle>Your PDF is ready</DialogTitle>
        </div>
        <DialogDescription>Download it, or print it straight from here.</DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
        <FileTextIcon className="size-8 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium">{result.filename}</p>
          <p className="font-mono text-xs text-muted-foreground tabular-nums">
            {formatFileSize(result.blob.size)}
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        When you print, choose “Actual size” or 100% in the print dialog, not “Fit to page”, so
        every photo prints at its exact size.
      </p>
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
      {/* Always in the page, so a note that appears later is announced. */}
      <div
        role="status"
        className={cn(
          note ? 'flex items-start gap-2 rounded-lg border p-3 text-sm' : 'sr-only',
          note?.problem ? 'border-warning/40 bg-warning/20 text-warning-foreground' : 'bg-muted/50',
        )}
      >
        {note?.problem && <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />}
        {note?.text}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
        {/* Not disabled while it works: a disabled button drops the keyboard focus. Pressing it again
            during a print shares that print's result instead of starting another. */}
        <Button variant="outline" aria-busy={printing} onClick={() => void print()}>
          <PrinterIcon />
          Print
        </Button>
        <Button onClick={() => downloadBlob(result.blob, result.filename)}>
          <DownloadIcon />
          Download PDF
        </Button>
      </DialogFooter>
    </>
  )
}
