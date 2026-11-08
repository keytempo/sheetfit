import { createEmptyClickGesture } from '@/lib/empty-click'
import { clearSelection } from './clear-selection'

const closest = (target: EventTarget | null, selector: string) =>
  target instanceof Element && target.closest(selector) !== null

/**
 * Clicking the image list anywhere but on a row (the space under the last row, a loading
 * placeholder) deselects. The scroll bar is part of the list's frame but not of its space.
 */
export const listEmptyClick = createEmptyClickGesture(
  (target) => !closest(target, '[data-image-row], [data-slot="scroll-area-scrollbar"]'),
  clearSelection,
)

/**
 * Clicking the preview anywhere but on a piece deselects: the background around the sheets and
 * the blank paper of a sheet alike. Dragging the scroll bars, panning, scrolling, zooming and
 * pinching are not clicks and never get here.
 */
export const previewEmptyClick = createEmptyClickGesture(
  (target) => !closest(target, '[data-piece]'),
  clearSelection,
)
