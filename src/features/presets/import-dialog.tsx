import { FileUpIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { pluralize } from '@/lib/format'
import { PRESETS_BUTTON_ID } from '@/lib/dom-ids'
import { totalSkipped } from '@/lib/presets/read'
import { PRESET_LIMITS } from '@/lib/presets/schema'
import { readImport, type ImportPreview, type ImportProblem } from '@/lib/presets/transfer'
import { presetBook } from '@/store/presets'
import { importEntries } from './actions'
import { IMPORT_PROBLEMS, quoted, SKIP_REASONS } from './messages'

type Step =
  | { kind: 'choose' }
  | { kind: 'reading' }
  | { kind: 'refused'; file: string; problem: ImportProblem }
  | { kind: 'preview'; file: string; preview: ImportPreview }

function Preview({ preview }: { preview: ImportPreview }) {
  const { entries, skipped, counts } = preview
  const skippedTotal = totalSkipped(counts)
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p role="status" className="font-medium">
        {entries.length > 0
          ? `${pluralize(entries.length, 'preset')} will be added.`
          : 'There is nothing to add.'}
        {skippedTotal > 0 && ` ${skippedTotal} will be skipped.`}
      </p>
      {entries.length > 0 && (
        <ul
          aria-label="Presets to add"
          className="max-h-44 divide-y overflow-y-auto rounded-lg border bg-muted/40"
        >
          {entries.map((entry) => (
            <li key={entry.index} className="flex flex-col px-3 py-2">
              <span className="truncate" dir="auto">
                {entry.name}
              </span>
              {entry.renamedFrom !== undefined && (
                <span className="text-xs text-muted-foreground">
                  Renamed: {quoted(entry.renamedFrom)} is already used
                </span>
              )}
              {entry.adjusted && (
                <span className="text-xs text-muted-foreground">
                  Some values were outside their limits and were adjusted
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {skippedTotal > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-medium">Skipped</p>
          <ul
            aria-label="Skipped entries"
            className="flex flex-col gap-0.5 text-xs text-muted-foreground"
          >
            {skipped.map((item) => (
              <li key={item.index} className="truncate">
                {item.name === undefined ? `Entry ${item.index + 1}` : quoted(item.name)}:{' '}
                {SKIP_REASONS[item.reason]}
              </li>
            ))}
            {skippedTotal > skipped.length && <li>and {skippedTotal - skipped.length} more</li>}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Your saved presets are not changed or replaced.
      </p>
    </div>
  )
}

function ImportSteps({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'choose' })
  const inputRef = useRef<HTMLInputElement>(null)

  async function read(file: File) {
    setStep({ kind: 'reading' })
    if (file.size > PRESET_LIMITS.importBytes) {
      setStep({ kind: 'refused', file: file.name, problem: 'too-big' })
      return
    }
    const text = await file.text().catch(() => null)
    presetBook.reload()
    const result =
      text === null
        ? ({ ok: false, problem: 'not-json' } as const)
        : readImport(text, presetBook.store.getState().presets)
    setStep(
      result.ok
        ? { kind: 'preview', file: file.name, preview: result.preview }
        : { kind: 'refused', file: file.name, problem: result.problem },
    )
  }

  const choose = (
    <Button
      type="button"
      autoFocus={step.kind !== 'preview'}
      variant={step.kind === 'preview' ? 'outline' : 'default'}
      onClick={() => inputRef.current?.click()}
    >
      <FileUpIcon />
      {step.kind === 'choose' ? 'Choose a file' : 'Choose another file'}
    </Button>
  )

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Import presets</DialogTitle>
        <DialogDescription>
          Choose a presets file exported from Sheetfit. You see what it holds before anything is
          added.
        </DialogDescription>
      </DialogHeader>

      {step.kind === 'refused' && (
        <p role="alert" className="text-sm text-destructive">
          {step.file}: {IMPORT_PROBLEMS[step.problem]}
        </p>
      )}
      {step.kind === 'preview' && (
        <>
          <p className="truncate font-mono text-xs text-muted-foreground">{step.file}</p>
          <Preview preview={step.preview} />
        </>
      )}
      {step.kind === 'reading' && (
        <p role="status" className="text-sm text-muted-foreground">
          Reading the file…
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void read(file)
        }}
      />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {step.kind !== 'reading' && choose}
        {step.kind === 'preview' && step.preview.entries.length > 0 && (
          <Button
            type="button"
            autoFocus
            onClick={() => {
              if (importEntries(step.preview.entries)) onClose()
            }}
          >
            Add {pluralize(step.preview.entries.length, 'preset')}
          </Button>
        )}
      </DialogFooter>
    </div>
  )
}

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          document.getElementById(PRESETS_BUTTON_ID)?.focus()
        }}
      >
        <ImportSteps onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
