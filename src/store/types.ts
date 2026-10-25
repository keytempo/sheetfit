import type { PrintOptions } from '@/lib/print-options'

export interface ImageItem {
  id: string
  name: string
  file: File
  /** A small copy of the image used by the list and the preview. */
  thumbnail: Blob
  /** Object URL of `file`, used for the large preview dialog. */
  url: string
  /** Object URL of `thumbnail`. */
  thumbUrl: string
  /** Pixel size with EXIF orientation applied. */
  width: number
  height: number
  copies: number
  /** Relative print size, 10–300, where 100 is the base print size. */
  percent: number
}

/** An image taken out of the list. Its object URLs are revoked; `restoreImages` makes new ones. */
export interface RemovedImage {
  item: ImageItem
  index: number
}

export type ViewMode = 'scroll' | 'single'

/** `custom.value` is a factor of actual size: 1 is 100%. */
export type Zoom = { kind: 'fit-width' } | { kind: 'fit-page' } | { kind: 'custom'; value: number }

export type MobileTab = 'images' | 'preview'

export interface ImagesSlice {
  images: ImageItem[]
  /** Files still being decoded; the list shows one skeleton row for each. */
  loadingCount: number
  addImages: (items: ImageItem[]) => void
  changeLoadingCount: (delta: number) => void
  removeImages: (ids: string[]) => RemovedImage[]
  restoreImages: (removed: RemovedImage[]) => void
  clearImages: () => void
  moveImage: (id: string, toIndex: number) => void
  setCopies: (id: string, copies: number) => void
  setPercent: (id: string, percent: number) => void
  setAllCopies: (copies: number) => void
  resetSizes: () => void
  /** Returns the shared width in millimetres, or null when there are no images. */
  matchAllWidths: () => number | null
}

export interface OptionsSlice {
  options: PrintOptions
  setOption: <K extends keyof PrintOptions>(key: K, value: PrintOptions[K]) => void
  resetOptions: () => void
}

export interface UiSlice {
  selectedImageId: string | null
  hoveredPiece: { id: string; imageId: string } | null
  viewMode: ViewMode
  /** 0-based; consumers clamp it to the number of sheets that currently exist. */
  currentSheet: number
  zoom: Zoom
  /** Panel id to percentage, as reported by the resizable group. */
  panelLayout: Record<string, number>
  printOptionsOpen: boolean
  mobileTab: MobileTab
  /** The latest message for the polite live region. */
  announcement: string
  selectImage: (id: string | null) => void
  setHoveredPiece: (piece: { id: string; imageId: string } | null) => void
  setViewMode: (mode: ViewMode) => void
  setCurrentSheet: (index: number) => void
  setZoom: (zoom: Zoom) => void
  setPanelLayout: (layout: Record<string, number>) => void
  setPrintOptionsOpen: (open: boolean) => void
  setMobileTab: (tab: MobileTab) => void
  announce: (message: string) => void
}

export type AppState = ImagesSlice & OptionsSlice & UiSlice
