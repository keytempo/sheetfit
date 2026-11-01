import type { StateCreator } from 'zustand'
import type { AppState, UiSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/persist', unknown]], [], UiSlice>

export const DEFAULT_PANEL_LAYOUT: Record<string, number> = { images: 38, preview: 62 }

/** Saved panel sizes are used only when each is a real percentage and together they fill the window. */
export function sanitizePanelLayout(saved: unknown): Record<string, number> {
  const layout =
    typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {}
  const sizes = Object.keys(DEFAULT_PANEL_LAYOUT).map((id) => layout[id])
  const valid =
    sizes.every(
      (size) => typeof size === 'number' && Number.isFinite(size) && size > 0 && size < 100,
    ) && Math.abs(sizes.reduce<number>((sum, size) => sum + (size as number), 0) - 100) < 0.5
  return valid ? { images: sizes[0] as number, preview: sizes[1] as number } : DEFAULT_PANEL_LAYOUT
}

export const createUiSlice: Slice = (set) => ({
  selectedImageId: null,
  hoveredPiece: null,
  viewMode: 'scroll',
  currentSheet: 0,
  zoom: { kind: 'fit-width' },
  panelLayout: DEFAULT_PANEL_LAYOUT,
  printOptionsOpen: false,
  mobileTab: 'images',
  announcement: '',

  selectImage: (id) => set({ selectedImageId: id }),
  setHoveredPiece: (hoveredPiece) => set({ hoveredPiece }),
  setViewMode: (viewMode) => set({ viewMode }),
  setCurrentSheet: (currentSheet) => set({ currentSheet }),
  setZoom: (zoom) => set({ zoom }),
  setPanelLayout: (panelLayout) => set({ panelLayout }),
  setPrintOptionsOpen: (printOptionsOpen) => set({ printOptionsOpen }),
  setMobileTab: (mobileTab) => set({ mobileTab }),
  announce: (announcement) => set({ announcement }),
})
