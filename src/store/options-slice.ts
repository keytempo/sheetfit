import type { StateCreator } from 'zustand'
import { DEFAULT_PRINT_OPTIONS } from '@/lib/print-options'
import type { AppState, OptionsSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/persist', unknown]], [], OptionsSlice>

export const createOptionsSlice: Slice = (set) => ({
  options: DEFAULT_PRINT_OPTIONS,
  setOption: (key, value) => set((state) => ({ options: { ...state.options, [key]: value } })),
  applyOptions: (changes) => set((state) => ({ options: { ...state.options, ...changes } })),
  resetOptions: () => set({ options: DEFAULT_PRINT_OPTIONS }),
})
