const THUMBNAIL_MAX_SIDE = 384

export interface DecodedImage {
  /** Pixel size with EXIF orientation applied. */
  width: number
  height: number
  /** A small copy for the list and the preview, so hundreds of pieces stay cheap to draw. */
  thumbnail: Blob
}

/**
 * Decodes a file once, off the main thread where the browser allows it, and returns its
 * orientation-corrected size plus a downscaled thumbnail. Throws an Error with a
 * user-readable message when the file cannot be decoded.
 */
export async function decodeImage(file: File): Promise<DecodedImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('This browser cannot decode the file')
  }

  try {
    const { width, height } = bitmap
    const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))

    // The pixels are read back straight away to encode them. A CPU-backed canvas avoids a round
    // trip to the GPU process, which otherwise stalls for hundreds of milliseconds per thumbnail.
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Could not create a thumbnail')
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const thumbnail = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not create a thumbnail'))),
        'image/webp',
        0.86,
      )
    })
    return { width, height, thumbnail }
  } finally {
    bitmap.close()
  }
}
