import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_PRINT_OPTIONS, type PrintOptions } from '@/lib/print-options'
import { createImagesSlice } from './images-slice'
import { createOptionsSlice } from './options-slice'
import { createUiSlice, DEFAULT_PANEL_LAYOUT } from './ui-slice'
import type { AppState } from './types'

interface PersistedState {
  options: PrintOptions
  panelLayout: Record<string, number>
}

/** Print options and panel sizes survive reloads. Images only ever live in memory. */
export const useAppStore = create<AppState>()(
  persist(
    (...args) => ({
      ...createImagesSlice(...args),
      ...createOptionsSlice(...args),
      ...createUiSlice(...args),
    }),
    {
      name: 'sheetfit:v1',
      version: 1,
      partialize: (state): PersistedState => ({
        options: state.options,
        panelLayout: state.panelLayout,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<PersistedState>
        return {
          ...current,
          options: { ...DEFAULT_PRINT_OPTIONS, ...saved.options },
          panelLayout: { ...DEFAULT_PANEL_LAYOUT, ...saved.panelLayout },
        }
      },
    },
  ),
)
