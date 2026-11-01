import type { PixelSource } from './raster'

/** A decoded image and the way to let go of its memory. */
export interface DecodedImage {
  source: PixelSource
  close: () => void
}

/** The decoder an environment provides: the browser's, or a stand-in in tests. */
export type DecodeImage = (file: Blob) => Promise<DecodedImage>

/** About how many pixels one strip holds. Small strips keep memory low and stay under canvas limits. */
const STRIP_PIXELS = 1 << 22

/** The largest canvas side the common browsers accept. */
const MAX_SIDE = 32767

/**
 * Decodes any image the browser can read (WebP, GIF, BMP, AVIF, and files a PDF cannot take as they
 * are) at its full native size, with its EXIF orientation applied and its colours rendered the way
 * the preview renders them: in sRGB, which is the browser's own conversion. A file without a colour
 * profile is not changed by that. One with a wide-gamut profile is stored as the sRGB picture the
 * preview shows (colours outside sRGB are clipped), because the raw numbers of such a file mean
 * nothing without the profile, and the browser does not hand the profile over. The picture is never
 * scaled. It stays in one bitmap and is read out strip by strip, so no full-size pixel buffer is
 * ever made.
 */
export const decodeInBrowser: DecodeImage = async (file) => {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
    premultiplyAlpha: 'none',
  })
  const { width, height } = bitmap
  if (width > MAX_SIDE) {
    bitmap.close()
    throw new Error(`it is ${width} pixels wide, more than the ${MAX_SIDE} this browser can read`)
  }

  const stripRows = Math.min(height, Math.max(1, Math.floor(STRIP_PIXELS / width)))
  const canvas = new OffscreenCanvas(width, stripRows)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    bitmap.close()
    throw new Error('this browser cannot read its pixels')
  }
  // "copy" replaces what is on the canvas instead of blending with the previous strip.
  context.globalCompositeOperation = 'copy'

  return {
    close: () => bitmap.close(),
    source: {
      width,
      height,
      kind: 'rgba',
      bits: 8,
      rows: function* () {
        for (let top = 0; top < height; top += stripRows) {
          const rows = Math.min(stripRows, height - top)
          context.drawImage(bitmap, 0, top, width, rows, 0, 0, width, rows)
          const { data } = context.getImageData(0, 0, width, rows)
          yield new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        }
      },
    },
  }
}
