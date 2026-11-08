import { describe, expect, it, vi } from 'vitest'
import { CLICK_SLOP_PX, createEmptyClickGesture, type PointerLike } from './empty-click'

const at = (
  x: number,
  y: number,
  target: EventTarget | null = empty,
  isPrimary = true,
): PointerLike => ({
  clientX: x,
  clientY: y,
  target,
  isPrimary,
})
const empty = {} as EventTarget
const control = {} as EventTarget
const setup = () => {
  const onEmpty = vi.fn()
  const gesture = createEmptyClickGesture((target) => target === empty, onEmpty)
  return { gesture, onEmpty }
}

describe('createEmptyClickGesture', () => {
  it('counts a press and release on empty space', () => {
    const { gesture, onEmpty } = setup()
    gesture.onPointerDown(at(10, 10))
    gesture.onClick(at(10, 10))
    expect(onEmpty).toHaveBeenCalledTimes(1)
  })

  it('ignores a click on anything that is not empty space', () => {
    const { gesture, onEmpty } = setup()
    gesture.onPointerDown(at(10, 10, control))
    gesture.onClick(at(10, 10, control))
    expect(onEmpty).not.toHaveBeenCalled()
  })

  it('tolerates a little jitter and rejects a drag that ends in a click', () => {
    const { gesture, onEmpty } = setup()
    gesture.onPointerDown(at(10, 10))
    gesture.onClick(at(10 + CLICK_SLOP_PX, 10))
    expect(onEmpty).toHaveBeenCalledTimes(1)

    gesture.onPointerDown(at(10, 10))
    gesture.onClick(at(10 + CLICK_SLOP_PX + 1, 10))
    expect(onEmpty).toHaveBeenCalledTimes(1)
  })

  it('throws out a gesture that had a second pointer, even when the click follows', () => {
    const { gesture, onEmpty } = setup()
    gesture.onPointerDown(at(10, 10))
    gesture.onPointerDown(at(50, 50, empty, false))
    gesture.onClick(at(10, 10))
    expect(onEmpty).not.toHaveBeenCalled()
  })

  it('throws out a cancelled gesture, which is what the browser sends when it takes over a pan', () => {
    const { gesture, onEmpty } = setup()
    gesture.onPointerDown(at(10, 10))
    gesture.onPointerCancel()
    gesture.onClick(at(10, 10))
    expect(onEmpty).not.toHaveBeenCalled()
  })

  it('recovers: the gesture after a pinch counts again', () => {
    const { gesture, onEmpty } = setup()
    gesture.onPointerDown(at(10, 10))
    gesture.onPointerDown(at(50, 50, empty, false))
    gesture.onPointerDown(at(20, 20))
    gesture.onClick(at(20, 20))
    expect(onEmpty).toHaveBeenCalledTimes(1)
  })

  it('needs a press of its own: a click with no press before it (a keyboard activation) is ignored', () => {
    const { gesture, onEmpty } = setup()
    gesture.onClick(at(0, 0))
    expect(onEmpty).not.toHaveBeenCalled()
  })

  it('counts one click once', () => {
    const { gesture, onEmpty } = setup()
    gesture.onPointerDown(at(10, 10))
    gesture.onClick(at(10, 10))
    gesture.onClick(at(10, 10))
    expect(onEmpty).toHaveBeenCalledTimes(1)
  })
})
