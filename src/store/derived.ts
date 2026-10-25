import { computeLayout } from '@/placeholders'
import type { ExportInput } from '@/lib/export-types'
import type { LayoutInput, LayoutResult, PieceSpec } from '@/lib/layout-types'
import type { PrintOptions } from '@/lib/print-options'
import { getPortraitSize, getSheetGeometry } from '@/lib/sheet'
import { getPrintInfo } from '@/lib/sizing'
import { useAppStore } from './index'
import type { ImageItem } from './types'

/** Expands every image into one piece per copy, each with its printed size. */
function buildLayoutInput(images: readonly ImageItem[], options: PrintOptions): LayoutInput {
  const geometry = getSheetGeometry(options)
  const pieces = images.flatMap((image): PieceSpec[] => {
    const { width, height } = getPrintInfo(image, options, geometry)
    return Array.from({ length: image.copies }, (_, i) => ({
      id: `${image.id}:${i + 1}`,
      imageId: image.id,
      copy: i + 1,
      copies: image.copies,
      width,
      height,
    }))
  })

  return {
    pieces,
    sheetSize: getPortraitSize(options),
    orientation: options.orientation,
    margin: geometry.margin,
    gap: geometry.gap,
    allowRotation: options.allowRotation,
    ordering: options.ordering,
  }
}

/** The layout is always computed from the current images and options, never stored. */
export function useSheetLayout(): LayoutResult {
  const images = useAppStore((state) => state.images)
  const options = useAppStore((state) => state.options)
  return computeLayout(buildLayoutInput(images, options))
}

export function useTotalPieces() {
  return useAppStore((state) => state.images.reduce((sum, image) => sum + image.copies, 0))
}

/**
 * A frozen copy of what an export should contain. Unlike the preview, an export job must not
 * change underneath itself, so it reads the state once, at the moment Download PDF is pressed.
 */
export function snapshotExportInput(): ExportInput {
  const { images, options } = useAppStore.getState()
  return {
    layout: computeLayout(buildLayoutInput(images, options)),
    images: images.map(({ id, name, file, width, height }) => ({ id, name, file, width, height })),
    cutGuides: options.cutGuides,
  }
}
