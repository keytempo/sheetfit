import { LIMITS, type LayoutOptions } from './print-options'
import type { SheetGeometry } from './sheet'

const MM_PER_INCH = 25.4

/** Printed resolution below this is flagged as likely to look soft. */
export const LOW_DPI_THRESHOLD = 150

interface PixelSize {
  width: number
  height: number
}

/** Millimetres printed per source pixel when an image's size slider sits at 100%. */
function baseMmPerPixel(size: PixelSize, options: LayoutOptions): number {
  switch (options.baseMode) {
    case 'width':
      return options.baseLength / size.width
    case 'height':
      return options.baseLength / size.height
    case 'longest':
      return options.baseLength / Math.max(size.width, size.height)
    case 'native':
      return MM_PER_INCH / options.baseDpi
  }
}

/**
 * The packer rounds the sheet, the margin and every photo to whole micrometres, each by up to half
 * of one. A photo is kept this much smaller than the usable area so that rounding can never turn a
 * size that fits into one the packer cannot place.
 */
const PACKER_SLACK_MM = 0.003

/** The largest percentage at which the image still fits inside the usable sheet area. */
function getMaxPercent(size: PixelSize, options: LayoutOptions, geometry: SheetGeometry) {
  const scale = baseMmPerPixel(size, options)
  const width = size.width * scale
  const height = size.height * scale
  const usableWidth = geometry.usableWidth - PACKER_SLACK_MM
  const usableHeight = geometry.usableHeight - PACKER_SLACK_MM
  let fit = Math.min(usableWidth / width, usableHeight / height)
  if (options.allowRotation) {
    fit = Math.max(fit, Math.min(usableWidth / height, usableHeight / width))
  }
  return Math.floor(fit * 1e4) / 100
}

export interface PrintInfo {
  /** The percentage actually used, after the sheet limit is applied. */
  percent: number
  minPercent: number
  maxPercent: number
  /** True when the size slider is held back by the sheet size rather than by its own range. */
  limited: boolean
  width: number
  height: number
  dpi: number
  lowResolution: boolean
}

/** Everything the UI and the layout need to know about how large one image prints. */
export function getPrintInfo(
  image: PixelSize & { percent: number },
  options: LayoutOptions,
  geometry: SheetGeometry,
): PrintInfo {
  const fitPercent = getMaxPercent(image, options, geometry)
  const maxPercent = Math.min(LIMITS.percent.max, fitPercent)
  const percent = Math.min(image.percent, maxPercent)
  const scale = (baseMmPerPixel(image, options) * percent) / 100
  const dpi = MM_PER_INCH / scale

  return {
    percent,
    minPercent: Math.min(LIMITS.percent.min, maxPercent),
    maxPercent,
    limited: fitPercent < LIMITS.percent.max && image.percent >= fitPercent,
    width: image.width * scale,
    height: image.height * scale,
    dpi,
    lowResolution: dpi < LOW_DPI_THRESHOLD,
  }
}

/**
 * Sizes every image so that all of them print at the same width: the average of their
 * widths at 100%. Returns the target width and the matching percentages in input order.
 */
export function matchWidths(images: readonly PixelSize[], options: LayoutOptions) {
  if (images.length === 0) return null
  const widths = images.map((image) => image.width * baseMmPerPixel(image, options))
  const target = widths.reduce((sum, w) => sum + w, 0) / widths.length
  const percents = widths.map((w) =>
    Math.min(LIMITS.percent.max, Math.max(LIMITS.percent.min, (target / w) * 100)),
  )
  return { target, percents }
}
