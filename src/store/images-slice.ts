import type { StateCreator } from 'zustand'
import { LIMITS } from '@/lib/print-options'
import { matchWidths } from '@/lib/sizing'
import { clamp, moveItem } from '@/lib/utils'
import type { AppState, ImageItem, ImagesSlice } from './types'

type Slice = StateCreator<AppState, [['zustand/persist', unknown]], [], ImagesSlice>

const revokeUrls = (item: ImageItem) => {
  URL.revokeObjectURL(item.url)
  URL.revokeObjectURL(item.thumbUrl)
}

const updateImage = (images: ImageItem[], id: string, patch: Partial<ImageItem>) =>
  images.map((image) => (image.id === id ? { ...image, ...patch } : image))

const toCopies = (value: number) => clamp(Math.round(value), LIMITS.copies.min, LIMITS.copies.max)

export const createImagesSlice: Slice = (set, get) => ({
  images: [],
  loadingCount: 0,

  addImages: (items) => set((state) => ({ images: [...state.images, ...items] })),

  changeLoadingCount: (delta) =>
    set((state) => ({ loadingCount: Math.max(0, state.loadingCount + delta) })),

  removeImages: (ids) => {
    const removed = get()
      .images.map((item, index) => ({ item, index }))
      .filter(({ item }) => ids.includes(item.id))
    removed.forEach(({ item }) => revokeUrls(item))
    set((state) => ({
      images: state.images.filter((image) => !ids.includes(image.id)),
      selectedImageId: ids.includes(state.selectedImageId ?? '') ? null : state.selectedImageId,
      hoveredPiece: null,
    }))
    return removed
  },

  restoreImages: (removed) =>
    set((state) => {
      const images = [...state.images]
      for (const { item, index } of [...removed].sort((a, b) => a.index - b.index)) {
        images.splice(Math.min(index, images.length), 0, {
          ...item,
          url: URL.createObjectURL(item.file),
          thumbUrl: URL.createObjectURL(item.thumbnail),
        })
      }
      return { images, selectedImageId: removed[0]?.item.id ?? state.selectedImageId }
    }),

  clearImages: () => {
    get().images.forEach(revokeUrls)
    set({ images: [], selectedImageId: null, hoveredPiece: null, currentSheet: 0 })
  },

  moveImage: (id, toIndex) =>
    set((state) => {
      const from = state.images.findIndex((image) => image.id === id)
      const to = clamp(toIndex, 0, state.images.length - 1)
      if (from < 0 || from === to) return state
      return {
        images: moveItem(state.images, from, to),
        announcement: `Moved ${state.images[from].name} to position ${to + 1} of ${state.images.length}`,
      }
    }),

  setCopies: (id, copies) =>
    set((state) => ({ images: updateImage(state.images, id, { copies: toCopies(copies) }) })),

  setPercent: (id, percent) =>
    set((state) => ({
      images: updateImage(state.images, id, {
        percent: clamp(percent, LIMITS.percent.min, LIMITS.percent.max),
      }),
    })),

  setAllCopies: (copies) =>
    set((state) => ({
      images: state.images.map((image) => ({ ...image, copies: toCopies(copies) })),
    })),

  resetSizes: () =>
    set((state) => ({ images: state.images.map((image) => ({ ...image, percent: 100 })) })),

  matchAllWidths: () => {
    const { images, options } = get()
    const match = matchWidths(images, options)
    if (!match) return null
    set({ images: images.map((image, i) => ({ ...image, percent: match.percents[i] })) })
    return match.target
  },
})
