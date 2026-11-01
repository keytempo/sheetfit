import { createContext, useContext } from 'react'
import type { SheetLayoutState } from './packing'

export const LayoutContext = createContext<SheetLayoutState | null>(null)

/** The layout on screen. It is packed once, by `LayoutProvider`, and shared by everything below. */
export function useSheetLayout(): SheetLayoutState {
  const state = useContext(LayoutContext)
  if (!state) throw new Error('useSheetLayout must be used inside a LayoutProvider')
  return state
}
