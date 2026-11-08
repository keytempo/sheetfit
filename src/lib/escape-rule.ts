/** What the Escape key needs to know to decide whether it should clear the selection. */
export interface EscapeContext {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  /** True while an input method (an IME) is composing text; Escape then belongs to it. */
  isComposing: boolean
  hasSelection: boolean
  /** Focus is in a text field, where Escape already means "undo my typing". */
  editing: boolean
  /** A dialog, menu, list box or drag already owns Escape. */
  overlayOpen: boolean
}

/** Escape clears the selection only when nothing else is waiting for that same key press. */
export function escapeClearsSelection(context: EscapeContext): boolean {
  return (
    context.key === 'Escape' &&
    !context.altKey &&
    !context.ctrlKey &&
    !context.metaKey &&
    !context.shiftKey &&
    !context.isComposing &&
    context.hasSelection &&
    !context.editing &&
    !context.overlayOpen
  )
}
