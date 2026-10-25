import type { ReactNode } from 'react'
import { Kbd } from '@/components/kbd'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Shortcut {
  keys: ReactNode
  action: string
}

const GROUPS: { title: string; shortcuts: Shortcut[] }[] = [
  {
    title: 'Image list',
    shortcuts: [
      {
        keys: [<Kbd key="up">↑</Kbd>, <Kbd key="down">↓</Kbd>],
        action: 'Select the previous or next image',
      },
      {
        keys: [<Kbd key="alt">Alt</Kbd>, <Kbd key="up">↑</Kbd>, <Kbd key="down">↓</Kbd>],
        action: 'Move the selected image up or down the list',
      },
      {
        keys: [<Kbd key="del">Delete</Kbd>],
        action: 'Remove the selected image (Undo is offered)',
      },
      {
        keys: [<Kbd key="plus">+</Kbd>, <Kbd key="minus">−</Kbd>],
        action: 'Add or remove one copy',
      },
      { keys: [<Kbd key="enter">Enter</Kbd>], action: 'Open a larger preview' },
      {
        keys: [<Kbd key="space">Space</Kbd>],
        action: 'On a grip: pick up, then drop. Arrow keys move it, Esc cancels',
      },
    ],
  },
  {
    title: 'Preview',
    shortcuts: [
      {
        keys: [<Kbd key="ctrl">Ctrl</Kbd>, <Kbd key="wheel">Scroll</Kbd>],
        action: 'Zoom the preview (⌘ on a Mac, or pinch on a touchscreen)',
      },
    ],
  },
  {
    title: 'Anywhere',
    shortcuts: [
      {
        keys: [<Kbd key="ctrl">Ctrl</Kbd>, <Kbd key="v">V</Kbd>],
        action: 'Paste images from the clipboard',
      },
      { keys: [<Kbd key="esc">Esc</Kbd>], action: 'Close the print options or a dialog' },
    ],
  },
]

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Click an image in the list, or focus it with Tab, to use its shortcuts.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {group.title}
              </h3>
              <dl className="flex flex-col divide-y rounded-lg border">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.action}
                    className="flex items-center justify-between gap-4 px-3 py-2"
                  >
                    <dt className="text-sm">{shortcut.action}</dt>
                    <dd className="flex shrink-0 items-center gap-1">{shortcut.keys}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
