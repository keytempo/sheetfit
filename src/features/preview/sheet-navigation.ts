import { scrollBehavior } from '@/lib/scroll'
import { useAppStore } from '@/store'

/**
 * Looks inside the scroll column only: while the view cross-fades, the outgoing one-sheet view is
 * still in the page and carries the same sheet index.
 */
export function scrollToSheet(index: number, behavior: ScrollBehavior) {
  document
    .querySelector(`[data-sheet-column] [data-sheet-index="${index}"]`)
    ?.scrollIntoView({ block: 'start', behavior })
}

/** Shows a sheet: in scroll mode by scrolling to it, in one-sheet mode by switching to it. */
export function goToSheet(index: number) {
  const { viewMode, setCurrentSheet } = useAppStore.getState()
  setCurrentSheet(index)
  if (viewMode === 'scroll') scrollToSheet(index, scrollBehavior())
}
