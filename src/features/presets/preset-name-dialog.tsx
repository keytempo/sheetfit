import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PRESETS_BUTTON_ID } from '@/lib/dom-ids'
import type { Failure } from '@/lib/presets/operations'
import { PRESET_LIMITS } from '@/lib/presets/schema'
import { FAILURES, WHAT_IS_SAVED } from './messages'

export type NameTarget = { kind: 'save' } | { kind: 'rename'; id: string; name: string }

const COPY = {
  save: {
    title: 'Save current settings',
    description: WHAT_IS_SAVED,
    submit: 'Save preset',
  },
  rename: {
    title: 'Rename preset',
    description: 'The preset keeps its settings.',
    submit: 'Rename',
  },
}

function NameForm({
  target,
  onSubmit,
  onCancel,
}: {
  target: NameTarget
  /** Returns why the name was refused, or null when it was accepted. */
  onSubmit: (name: string) => Failure | null
  onCancel: () => void
}) {
  const [name, setName] = useState(target.kind === 'rename' ? target.name : '')
  const [failure, setFailure] = useState<Failure | null>(null)
  const inputId = useId()
  const messageId = `${inputId}-message`
  const copy = COPY[target.kind]

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        setFailure(onSubmit(name))
      }}
    >
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={inputId}>Name</Label>
        <Input
          id={inputId}
          value={name}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={failure !== null}
          aria-describedby={messageId}
          placeholder="For example, Passport photos on A4"
          onChange={(event) => {
            setName(event.target.value)
            setFailure(null)
          }}
        />
        {failure ? (
          <p id={messageId} role="alert" className="text-xs text-destructive">
            {FAILURES[failure]}
          </p>
        ) : (
          <p id={messageId} className="text-xs text-muted-foreground">
            Up to {PRESET_LIMITS.nameLength} characters. Each name is used once.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{copy.submit}</Button>
      </DialogFooter>
    </form>
  )
}

/** Asks for a name, to save the current settings under or to rename a preset. */
export function PresetNameDialog({
  target,
  open,
  onOpenChange,
  onSubmit,
}: {
  target: NameTarget
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (target: NameTarget, name: string) => Failure | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          document.getElementById(PRESETS_BUTTON_ID)?.focus()
        }}
      >
        <NameForm
          target={target}
          onSubmit={(name) => {
            const failure = onSubmit(target, name)
            if (!failure) onOpenChange(false)
            return failure
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
