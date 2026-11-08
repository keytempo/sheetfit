/** How far a pointer may travel between pressing and releasing and still count as a click. */
export const CLICK_SLOP_PX = 5

/** The part of a pointer event the gesture needs; a real `PointerEvent` fits. */
interface ClickLike {
  clientX: number
  clientY: number
  target: EventTarget | null
}

export interface PointerLike extends ClickLike {
  /** False for the second and later fingers of a touch. */
  isPrimary: boolean
}

/** The handlers to put on a surface. They follow whole gestures, not single events. */
interface EmptyClickHandlers {
  onPointerDown: (event: PointerLike) => void
  onPointerCancel: () => void
  onClick: (event: ClickLike) => void
}

/**
 * Tells a click on empty space from everything else that ends in a click event: a drag that
 * happens to end where it began, a text selection, a pinch or a second finger. A click counts
 * only when it is the whole gesture: one pointer, which stayed within `CLICK_SLOP_PX`, and which
 * landed on a target `isEmpty` accepts. Scrolling, panning and zooming never get that far, because
 * the browser sends no click for them, and a gesture that did involve a second pointer or was
 * cancelled by the browser is thrown out even if a click follows.
 */
export function createEmptyClickGesture(
  isEmpty: (target: EventTarget | null) => boolean,
  onEmptyClick: () => void,
): EmptyClickHandlers {
  let down: { x: number; y: number } | null = null
  let disturbed = false

  return {
    onPointerDown(event) {
      // The first pointer starts a gesture; any other one while it lasts spoils it. Nothing counts
      // pointers going up, so a pointer released outside the surface leaves nothing behind.
      if (event.isPrimary) {
        down = { x: event.clientX, y: event.clientY }
        disturbed = false
      } else {
        disturbed = true
      }
    },
    onPointerCancel() {
      disturbed = true
    },
    onClick(event) {
      const start = down
      down = null
      if (disturbed || start === null || !isEmpty(event.target)) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX) return
      onEmptyClick()
    },
  }
}
