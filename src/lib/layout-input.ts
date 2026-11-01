import type { LayoutInput, PieceSpec } from './layout-types'
import type { LayoutOptions } from './print-options'
import { getPortraitSize, getSheetGeometry } from './sheet'
import { getPrintInfo } from './sizing'

/** What the layout needs to know about one image. */
export interface LayoutImage {
  id: string
  /** Pixel size with EXIF orientation applied. */
  width: number
  height: number
  copies: number
  /** Relative print size, 10–300. */
  percent: number
}

/**
 * Expands every image into one piece per copy. Each piece carries the size the image really prints
 * at: the base size times the image's percent, limited to what the sheet can hold. That is the
 * size the list and the preview show, so the packer and the PDF use exactly the same numbers.
 */
export function buildLayoutInput(
  images: readonly LayoutImage[],
  options: LayoutOptions,
): LayoutInput {
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
