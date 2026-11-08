import { useEffect } from 'react'
import { escapeClearsSelection } from '@/lib/escape-rule'
import { useAppStore } from '@/store'
import { clearSelection } from './clear-selection'

/** Anything that, while it is open, already uses Escape to close or cancel itself. */
const OWNS_ESCAPE =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-roledescription="sortable"][aria-pressed="true"]'

const isEditing = (element: Element | null) =>
  element instanceof HTMLElement &&
  (element.isContentEditable || element.matches('input, textarea, select'))

/**
 * Escape deselects. The listener runs in the capture phase, before any dialog or menu has handled
 * the key, so what it sees on the page is what the person saw when they pressed it: an open dialog
 * (the print options included), a menu, a list box, a field being edited or a keyboard drag keeps
 * its Escape, and the selection stays.
 */
export function useEscapeDeselect() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const clears = escapeClearsSelection({
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        isComposing: event.isComposing,
        hasSelection: useAppStore.getState().selectedImageId !== null,
        editing: isEditing(document.activeElement),
        overlayOpen: document.querySelector(OWNS_ESCAPE) !== null,
      })
      if (clears) clearSelection()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])
}
