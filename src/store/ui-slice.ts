import type { StateCreator } from 'zustand'
import type { AppState, UiSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/persist', unknown]], [], UiSlice>

export const DEFAULT_PANEL_LAYOUT: Record<string, number> = { images: 38, preview: 62 }

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
