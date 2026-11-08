import { describe, expect, it } from 'vitest'
import { escapeClearsSelection, type EscapeContext } from './escape-rule'

const base: EscapeContext = {
  key: 'Escape',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  isComposing: false,
  hasSelection: true,
  editing: false,
  overlayOpen: false,
}

describe('escapeClearsSelection', () => {
  it('clears a selection when Escape is pressed with nothing else open', () => {
    expect(escapeClearsSelection(base)).toBe(true)
  })

  it.each([
    ['another key', { key: 'Enter' }],
    ['Alt held', { altKey: true }],
    ['Ctrl held', { ctrlKey: true }],
    ['Cmd held', { metaKey: true }],
    ['Shift held', { shiftKey: true }],
    ['an input method composing', { isComposing: true }],
    ['nothing selected', { hasSelection: false }],
    ['focus in a text field', { editing: true }],
    ['a dialog, menu or drag open', { overlayOpen: true }],
  ])('leaves the selection alone with %s', (_name, change) => {
    expect(escapeClearsSelection({ ...base, ...change })).toBe(false)
  })
})
